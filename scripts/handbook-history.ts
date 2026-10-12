// Shows the change history of the handbook (docs/handbook/). Run with: pnpm docs:history
// Like check-concepts.ts, Node runs this TypeScript file directly (it strips the types).
//
// Two modes:
//   pnpm docs:history                   one row per handbook file: when it last changed, in which
//                                       commit, and that commit's subject.
//   pnpm docs:history --since <commit>  only the files changed after <commit>, each with the
//                                       section headings that changed. "After" includes changes
//                                       that are not committed yet, so you can run it while you
//                                       write the CHANGELOG.md entry for your own commit.
//
// Every value comes from git (git log, git diff, git show, git ls-files). Nothing is typed by hand,
// so the output can never drift from the real history.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HANDBOOK = "docs/handbook";

type Commit = { hash: string; date: string; subject: string };

// 1. Run git in the repo root and return what it prints. git's own error text is not shown
//    (stdio "pipe"): where a failure is expected, the caller prints a clearer message.
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// 2. Every handbook file git knows about or would add (tracked + untracked, minus .gitignore'd ones).
function listHandbookFiles(): string[] {
  const output = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", HANDBOOK]);
  return output
    .split("\n")
    .filter((file) => file !== "" && existsSync(path.join(ROOT, file)))
    .sort();
}

// 3. The last commit that touched each handbook file, from ONE `git log` run.
//    git log lists the newest commit first, so the first time we see a file is its last change.
//    Each commit starts with a line "\0<hash>\t<date>\t<subject>", followed by the files it changed.
function lastCommitPerFile(): Map<string, Commit> {
  const output = git(["log", "--date=short", "--format=%x00%h%x09%ad%x09%s", "--name-only", "--", HANDBOOK]);
  const last = new Map<string, Commit>();
  for (const block of output.split("\0").slice(1)) {
    const [header, ...files] = block.split("\n");
    const [hash, date, ...subjectParts] = header.split("\t");
    const commit = { hash, date, subject: subjectParts.join("\t") };
    for (const file of files) {
      if (file !== "" && !last.has(file)) last.set(file, commit);
    }
  }
  return last;
}

// 4. Print rows as a table with padded columns.
function printTable(header: string[], rows: string[][]) {
  const widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
}

// 5. Short file name for the output: "concepts/alb.md" instead of "docs/handbook/concepts/alb.md".
function short(file: string): string {
  return file.slice(HANDBOOK.length + 1);
}

// 6. For every line of a Markdown file, the section it belongs to, as "Heading › Sub-heading".
//    The "# Title" (level 1) is left out: every line is under it. Lines in fenced code blocks
//    (```) are never headings, because "# comment" in a bash block is not a heading.
function sectionPerLine(text: string): string[] {
  const sections: string[] = [];
  const stack: { level: number; title: string }[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: heading[2] });
    }
    sections.push(stack.length > 0 ? stack.map((s) => s.title).join(" › ") : "(top of file)");
  }
  return sections;
}

// 7. The changed line numbers of one file, from the hunk headers of `git diff -U0`.
//    A hunk header looks like "@@ -12,3 +12,5 @@": 3 old lines from line 12 became 5 new lines from
//    line 12. A count of 0 means nothing on that side (a pure insert or a pure delete); the line
//    number then points to the line just BEFORE the change, so for a pure delete we use that line
//    (the deleted text sat at the end of its section).
function changedLines(diff: string): { oldLines: number[]; newLines: number[] } {
  const oldLines: number[] = [];
  const newLines: number[] = [];
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [oldStart, oldCount, newStart, newCount] = [match[1], match[2] ?? "1", match[3], match[4] ?? "1"].map(Number);
    for (let i = 0; i < oldCount; i++) oldLines.push(oldStart + i);
    for (let i = 0; i < newCount; i++) newLines.push(newStart + i);
    if (newCount === 0) newLines.push(Math.max(newStart, 1));
  }
  return { oldLines, newLines };
}

// 8. The sections of one file that changed between <since> and the working tree.
//    A section counts as changed when one of its lines was added, changed or removed.
//    A heading that exists only in the old file is reported as "removed: <heading>".
function changedSections(since: string, file: string): string[] {
  const oldText = git(["show", `${since}:${file}`]);
  const newText = readFileSync(path.join(ROOT, file), "utf8");
  const diff = git(["diff", "-U0", "--no-color", "--no-renames", since, "--", file]);
  const { oldLines, newLines } = changedLines(diff);

  const newSections = sectionPerLine(newText);
  const oldSections = sectionPerLine(oldText);
  const found = new Set<string>();
  for (const line of newLines) {
    const section = newSections[Math.min(line, newSections.length) - 1];
    if (section) found.add(section);
  }
  const stillThere = new Set(newSections);
  for (const line of oldLines) {
    const section = oldSections[line - 1];
    if (section && !stillThere.has(section)) found.add(`removed: ${section}`);
  }
  return [...found];
}

// 9. Default mode: one row per handbook file.
function showAll() {
  const last = lastCommitPerFile();
  const rows = listHandbookFiles().map((file) => {
    const commit = last.get(file);
    return commit
      ? [short(file), commit.date, commit.hash, commit.subject]
      : [short(file), "-", "-", "(not committed yet)"];
  });
  console.log(`Handbook files (${rows.length}), newest change from git log:\n`);
  printTable(["File", "Last changed", "Commit", "Subject"], rows);
}

// 10. --since mode: only the files changed after <since>, with their changed sections.
function showSince(since: string) {
  // 10a. Fail with a clear message if <since> is not a commit.
  let sinceLabel: string;
  try {
    sinceLabel = git(["log", "-1", "--date=short", "--format=%h %ad %s", `${since}^{commit}`]).trim();
  } catch {
    console.error(`docs:history: "${since}" is not a commit. Try a hash from: git log --oneline -- ${HANDBOOK}`);
    process.exit(1);
  }

  // 10b. Changed files: tracked ones from git diff (commit vs working tree), plus new untracked ones.
  //      Status letters: A added, M modified, D deleted.
  const status = new Map<string, string>();
  for (const line of git(["diff", "--name-status", "--no-renames", since, "--", HANDBOOK]).split("\n")) {
    const [letter, file] = line.split("\t");
    if (file) status.set(file, letter);
  }
  const untracked = new Set(git(["ls-files", "--others", "--exclude-standard", "--", HANDBOOK]).split("\n"));
  for (const file of untracked) {
    if (file) status.set(file, "A");
  }
  const uncommitted = new Set(git(["diff", "--name-only", "HEAD", "--", HANDBOOK]).split("\n"));

  const last = lastCommitPerFile();
  const files = [...status.keys()].sort();
  console.log(`Handbook files changed since ${sinceLabel}: ${files.length}\n`);

  // 10c. One block per file: status, last commit, then the changed sections.
  const words: Record<string, string> = { A: "added", M: "changed", D: "deleted" };
  for (const file of files) {
    const letter = status.get(file)!;
    const commit = last.get(file);
    const when =
      !commit || untracked.has(file)
        ? "not committed yet"
        : uncommitted.has(file)
          ? `uncommitted changes; last commit ${commit.date} ${commit.hash}`
          : `last commit ${commit.date} ${commit.hash} ${commit.subject}`;
    console.log(`${short(file)}  (${words[letter] ?? letter} · ${when})`);

    if (letter === "M") {
      for (const section of changedSections(since, file)) console.log(`    - ${section}`);
    } else if (letter === "A" && existsSync(path.join(ROOT, file))) {
      const headings = new Set(sectionPerLine(readFileSync(path.join(ROOT, file), "utf8")));
      headings.delete("(top of file)");
      console.log(`    - new file, ${headings.size} section(s)`);
    }
  }
}

// 11. Read the command line: nothing, or "--since <commit>".
function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length === 0) return showAll();
  if (args[0] === "--since" && args[1] && args.length === 2) return showSince(args[1]);
  console.error("Usage: pnpm docs:history [--since <commit>]");
  process.exit(1);
}

main();
