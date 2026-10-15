// The shape every check returns, and how a list of them is printed.
// Used by `pnpm run doctor`, `pnpm stack:up` (the first half of `pnpm dev`) and `pnpm stack:reset`.

// 1. ok   = fine.
//    warn = works, but something is off or missing that you may want (printed, never stops anything).
//    fail = something the app needs is broken; `fix` says exactly what to do.
export type CheckStatus = "ok" | "warn" | "fail";

export type CheckResult = {
  status: CheckStatus;
  title: string;
  // Extra lines under the title (what was found).
  detail?: string[];
  // Exact commands or lines to fix it, in order.
  fix?: string[];
};

export type Section = { name: string; results: CheckResult[] };

const ICON: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

// 2. Print one section: a heading, then one line per check, with its detail and fix indented.
export function printSection(section: Section) {
  console.log(`\n${section.name}`);
  for (const result of section.results) {
    console.log(`  ${ICON[result.status]} ${result.title}`);
    for (const line of result.detail ?? []) console.log(`      ${line}`);
    if (result.fix && result.fix.length > 0) {
      console.log("      fix:");
      for (const line of result.fix) console.log(`        ${line}`);
    }
  }
}

// 3. Count by status, for the summary line and the exit code.
export function count(sections: Section[], status: CheckStatus): number {
  return sections.flatMap((section) => section.results).filter((result) => result.status === status).length;
}

// 4. The last line: how many problems, and what to do next.
export function printSummary(sections: Section[], nextStep: string) {
  const fails = count(sections, "fail");
  const warns = count(sections, "warn");
  console.log("");
  if (fails === 0) {
    console.log(`All good${warns > 0 ? ` (${warns} warning${warns === 1 ? "" : "s"})` : ""}.`);
  } else {
    console.log(`${fails} problem${fails === 1 ? "" : "s"}${warns > 0 ? `, ${warns} warning${warns === 1 ? "" : "s"}` : ""}. Fix them top to bottom, then ${nextStep}.`);
  }
}
