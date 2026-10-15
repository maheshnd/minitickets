import { describe, expect, it } from "vitest";
import { pendingMigrations } from "./data-checks.ts";
import { portResult } from "./port-checks.ts";

describe("pendingMigrations", () => {
  const journal = [
    { tag: "0000_first", when: 100 },
    { tag: "0001_second", when: 200 },
    { tag: "0002_third", when: 300 },
  ];

  it("lists the journal entries Postgres has no record of, in order", () => {
    expect(pendingMigrations(journal, [100])).toEqual(["0001_second", "0002_third"]);
  });

  it("nothing applied yet (fresh database): all of them", () => {
    expect(pendingMigrations(journal, [])).toEqual(["0000_first", "0001_second", "0002_third"]);
  });

  it("all applied: none", () => {
    expect(pendingMigrations(journal, [300, 100, 200])).toEqual([]);
  });
});

describe("portResult", () => {
  it("pnpm stack:check (running): ours is ok, free is a warning, another program fails", () => {
    expect(portResult("api", 4000, "ours", "running").status).toBe("ok");
    expect(portResult("api", 4000, "free", "running").status).toBe("warn");
    const other = portResult("api", 4000, "other", "running", "java, pid 42");
    expect(other.status).toBe("fail");
    expect(other.title).toBe("api: something else listens on :4000 (java, pid 42)");
  });

  it("pnpm dev (starting): free is ok, a running copy of ours fails (address in use)", () => {
    expect(portResult("web", 3000, "free", "starting").status).toBe("ok");
    expect(portResult("web", 3000, "ours", "starting").status).toBe("fail");
    expect(portResult("web", 3000, "other", "starting").status).toBe("fail");
  });
});
