import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBootstrapArgs } from "./args.ts";
import { nameInZone, sameName } from "./dns.ts";
import { accountOf, githubVariables } from "./github-variables.ts";
import { bootstrapTargets } from "./targets.ts";

// The pure parts of `pnpm infra:bootstrap`. The parts that talk to AWS, Pulumi and GitHub are
// checked by running it: `pnpm infra:bootstrap --stack dev --profile <profile> --dry-run`.

const infraFile = (file: string) => readFileSync(path.join(import.meta.dirname, "../../infra/src", file), "utf8");

describe("parseBootstrapArgs", () => {
  // 1. The normal case, and --dry-run.
  it("reads --stack, --profile, --region and --dry-run", () => {
    expect(parseBootstrapArgs(["--stack", "prod", "--profile", "work", "--region", "eu-west-1", "--dry-run"])).toEqual({
      stack: "prod",
      profile: "work",
      region: "eu-west-1",
      dryRun: true,
    });
    expect(parseBootstrapArgs(["--stack", "dev", "--profile", "ticketlite"])).toMatchObject({ dryRun: false, region: undefined });
  });

  // 2. No guessing: both names are required, and nothing unknown is accepted.
  it("refuses missing names, unknown options and names AWS would refuse", () => {
    expect(parseBootstrapArgs(["--stack", "dev"])).toHaveProperty("error");
    expect(parseBootstrapArgs(["--profile", "x"])).toHaveProperty("error");
    expect(parseBootstrapArgs(["--stack", "dev", "--profile", "x", "--yes"])).toHaveProperty("error");
    for (const bad of ["Dev", "d", "a--b", "dev-", "1dev", "a-very-long-stack-name-x"]) {
      expect(parseBootstrapArgs(["--stack", bad, "--profile", "x"]), bad).toHaveProperty("error");
    }
    expect(parseBootstrapArgs(["--stack", "dev", "--profile", "x", "--region", "useast1"])).toHaveProperty("error");
  });
});

describe("bootstrapTargets", () => {
  const targets = bootstrapTargets("dev");

  // 3. The 14 resources CD needs first, with dev's exact URNs (the same as docs/20-deploy-day.md 3.11).
  it("lists the 14 resources CD needs before its first run", () => {
    expect(targets).toHaveLength(14);
    expect(targets.map((target) => target.urn)).toContain(
      "urn:pulumi:dev::minitickets::aws:iam/rolePolicy:RolePolicy::minitickets-dev-gh-deploy-policy",
    );
    expect(targets.map((target) => target.urn)).toContain(
      "urn:pulumi:dev::minitickets::aws:ecr/repositoryPolicy:RepositoryPolicy::minitickets-dev-worker-lambda-pull",
    );
    expect(new Set(targets.map((target) => target.urn)).size).toBe(14);
  });

  // 4. Another stack gets its own names everywhere.
  it("builds every URN from the stack name", () => {
    for (const target of bootstrapTargets("prod")) {
      expect(target.urn).toMatch(/^urn:pulumi:prod::minitickets::[^:]+:[^:]+:[^:]+::minitickets-prod-/);
    }
  });

  // 5. Each Pulumi name really exists in the infra code (as `${prefix}-<rest>`), so a renamed
  //    resource fails here instead of in the bootstrap ("not in the stack after pulumi up").
  it("names only resources the infra code creates", () => {
    const code = ["cicd.ts", "registry.ts", "release.ts"].map(infraFile).join("\n");
    for (const target of targets) {
      const rest = target.urn.split("::").at(-1)!.replace(/^minitickets-dev-/, "");
      const repo = /^(api|web|worker)(-lifecycle)?$/.exec(rest);
      if (repo) {
        expect(code, rest).toContain(repo[2] ? "`${name}-lifecycle`" : "new aws.ecr.Repository(name,");
      } else if (rest === "gh-publish" || rest === "gh-deploy") {
        expect(code, rest).toContain(rest === "gh-publish" ? "names.publishRoleName" : "names.deployRoleName");
      } else {
        expect(code, rest).toContain(`\`\${prefix}-${rest}\``);
      }
    }
  });
});

describe("githubVariables", () => {
  const vars = githubVariables("dev", "258237553751", "us-east-1");

  // 6. Exactly the values the dev stack had hard-coded in cd.yml before.
  it("gives cd.yml the dev stack's names", () => {
    expect(vars.repo).toEqual({
      AWS_REGION: "us-east-1",
      AWS_PUBLISH_ROLE_ARN: "arn:aws:iam::258237553751:role/minitickets-dev-gh-publish",
      API_REPO_NAME: "minitickets-dev-api",
      WEB_REPO_NAME: "minitickets-dev-web",
      WORKER_REPO_NAME: "minitickets-dev-worker",
      DEPLOY_ENVIRONMENT: "dev",
    });
    expect(vars.environment).toMatchObject({
      PULUMI_STACK: "dev",
      AWS_DEPLOY_ROLE_ARN: "arn:aws:iam::258237553751:role/minitickets-dev-gh-deploy",
      WORKER_FUNCTION_NAME: "minitickets-dev-worker",
      TICKET_FUNCTION_NAME: "minitickets-dev-tickets",
      IMAGE_TAG_PARAMETER: "/minitickets/dev/image-tag",
      DEPLOYED_COMMIT_PARAMETER: "/minitickets/dev/deployed-commit",
    });
  });

  // 7. Every variable cd.yml reads is one the bootstrap sets (and the other way round).
  it("covers every vars.* that cd.yml reads", () => {
    const cdYml = readFileSync(path.join(import.meta.dirname, "../../.github/workflows/cd.yml"), "utf8");
    const used = new Set([...cdYml.matchAll(/vars\.([A-Z_]+)/g)].map((match) => match[1]));
    const set = new Set([...Object.keys(vars.repo), ...Object.keys(vars.environment)]);
    expect([...used].sort()).toEqual([...set].sort());
  });

  it("reads the account out of an ARN", () => {
    expect(accountOf("arn:aws:iam::258237553751:role/x")).toBe("258237553751");
    expect(accountOf(undefined)).toBeUndefined();
  });
});

describe("DNS names in Cloudflare's format", () => {
  // 8. Cloudflare's Name field is relative to the zone; the zone itself is "@".
  it("drops the zone, the final dot and the case", () => {
    expect(nameInZone("_abc.minitickets.theversehub.in.", "theversehub.in")).toBe("_abc.minitickets");
    expect(nameInZone("Minitickets.TheVerseHub.in", "theversehub.in")).toBe("minitickets");
    expect(nameInZone("theversehub.in.", "theversehub.in")).toBe("@");
    expect(nameInZone("other.example.com", "theversehub.in")).toBe("other.example.com");
    expect(sameName("A.example.com.", "a.example.com")).toBe(true);
  });
});
