import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Tests for scripts/deploy-guard.sh, the CD guard against deploying old infrastructure code.
// Each test runs the REAL script against a small throw-away git repository:
//
//   c1 ── c2 ── c3 (main)        c1 = oldest, c3 = main's newest
//          \
//           side                  a commit on another line of history (main rewritten, say)

const script = path.join(import.meta.dirname, "deploy-guard.sh");
let repo = "";
const commits: Record<string, string> = {};

// 1. git in the test repo. A fixed name/email so the commits work on any machine (CI too).
function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function commit(name: string): string {
  git("commit", "--allow-empty", "-q", "-m", name);
  return git("rev-parse", "HEAD");
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), "deploy-guard-"));
  git("init", "-q", "-b", "main");
  commits.c1 = commit("c1");
  commits.c2 = commit("c2");
  git("checkout", "-q", "-b", "side");
  commits.side = commit("side");
  git("checkout", "-q", "main");
  commits.c3 = commit("c3");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

// 2. Run the guard with the given inputs; returns its exit code and everything it printed.
function guard(input: { checked: string; recorded: string; mainTip?: string; allowOlder?: boolean }) {
  const result = spawnSync("bash", [script], {
    cwd: repo,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      CHECKED: input.checked,
      RECORDED: input.recorded,
      MAIN_TIP: input.mainTip ?? "",
      ALLOW_OLDER: input.allowOlder ? "true" : "false",
    },
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

describe("deploy guard, rule 2: never apply infrastructure code OLDER than the deployed commit", () => {
  it("THE INCIDENT: an old commit approved after a newer one was deployed is refused", () => {
    const run = guard({ checked: commits.c1, recorded: commits.c3 });
    expect(run.code).toBe(1);
    expect(run.output).toContain("::error::");
    expect(run.output).toContain("OLDER than the deployed commit");
  });

  it("a newer commit than the deployed one goes ahead (the normal deploy)", () => {
    expect(guard({ checked: commits.c3, recorded: commits.c1 }).code).toBe(0);
  });

  it("the deployed commit itself goes ahead (a redeploy; short ids count as the same commit)", () => {
    expect(guard({ checked: commits.c3.slice(0, 7), recorded: commits.c3 }).code).toBe(0);
  });

  it("nothing recorded yet (the first deploy with the guard) goes ahead", () => {
    expect(guard({ checked: commits.c1, recorded: "none" }).code).toBe(0);
  });

  it("allow_older_infra turns the refusal into a warning (a deliberate infra rollback)", () => {
    const run = guard({ checked: commits.c1, recorded: commits.c3, allowOlder: true });
    expect(run.code).toBe(0);
    expect(run.output).toContain("::warning::");
  });

  it("a recorded commit on a separate line of history is refused (cannot tell which is newer)", () => {
    expect(guard({ checked: commits.c3, recorded: commits.side }).code).toBe(1);
  });

  it("a recorded commit that is not in the history at all is refused", () => {
    expect(guard({ checked: commits.c3, recorded: "0123456789abcdef0123456789abcdef01234567" }).code).toBe(1);
  });
});

describe("deploy guard, rule 1: a run CI started must be main's newest commit", () => {
  it("superseded: main has a newer commit, so the older run is refused", () => {
    const run = guard({ checked: commits.c2, recorded: commits.c1, mainTip: commits.c3 });
    expect(run.code).toBe(1);
    expect(run.output).toContain("Superseded");
  });

  it("main's newest commit goes ahead", () => {
    expect(guard({ checked: commits.c3, recorded: commits.c2, mainTip: commits.c3 }).code).toBe(0);
  });

  it("a commit that is no longer on main is refused", () => {
    expect(guard({ checked: commits.side, recorded: "none", mainTip: commits.c3 }).code).toBe(1);
  });

  it("a manual run (no main tip given) skips rule 1, so an app rollback on main's newest commit works", () => {
    expect(guard({ checked: commits.c3, recorded: commits.c3 }).code).toBe(0);
  });
});
