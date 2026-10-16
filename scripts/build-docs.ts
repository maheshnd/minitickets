import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
// 1. Only repo source/config files are inputs. Generated docs never feed back into their generator.
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n").filter(file => /\.(tsx?|[cm]?js|ya?ml|sh)$|(^|\/)Dockerfile[^/]*$/.test(file) && !file.startsWith("docs/")).sort();
const snippets: { id: string; concept: string; file: string; line: number; endLine: number; symbol: string; code: string }[] = [];
const hash = createHash("sha256");
for (const file of files) {
  if (!existsSync(path.join(root, file))) continue;
  const source = readFileSync(path.join(root, file), "utf8");
  const lines = source.split("\n");
  const anchors = [...source.matchAll(/(?:\/\/|\/\*|#)\s*@concept:\s*([a-z0-9-]+)/g)];
  if (!anchors.length) continue;
  hash.update(file).update("\0").update(source).update("\0");
  for (const anchor of anchors) {
    const line = source.slice(0, anchor.index).split("\n").length;
    const start = Math.max(0, line - 2), end = Math.min(lines.length, line + 15);
    const nearby = lines.slice(line - 1, Math.min(lines.length, line + 35)).join("\n");
    const symbol = nearby.match(/(?:export\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/)?.[1] ?? "module";
    snippets.push({ id: `${anchor[1]}:${file}:${line}`, concept: anchor[1], file, line: start + 1, endLine: end,
      symbol, code: lines.slice(start, end).join("\n") });
  }
}
// 2. No timestamps: identical code yields byte-identical offline data. Escape '<' before embedding.
const payload = JSON.stringify({ version: 1, sourceHash: hash.digest("hex"), snippets }, null, 2).replaceAll("<", "\\u003c");
const targets = ["docs/handbook/generated/code-tours.json", "docs/handbook/guides/code-tours.html", "docs/handbook/guides/infra-explorer.html"];
let stale = false;
for (const target of targets) {
  const absolute = path.join(root, target);
  const before = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  let after = payload + "\n";
  if (target.endsWith(".html")) {
    const block = `<script type="application/json" id="generated-code">\n${payload}\n</script>`;
    after = before.includes('id="generated-code"')
      ? before.replace(/<script type="application\/json" id="generated-code">[\s\S]*?<\/script>/, () => block)
      : before.replace("</body>", `${block}\n</body>`);
  }
  if (before !== after) {
    stale = true;
    if (!check) { mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, after); }
  }
}
// 3. Parse the authored scenarios once; both the practice reader and exported data use this text.
const scenarioSource = readFileSync(path.join(root, "docs/handbook/guides/interview-scenarios.md"), "utf8");
const section = (text: string, title: string) => text.split(`### ${title}\n\n`)[1]?.split("\n### ")[0]?.trim() ?? "";
const scenarios = scenarioSource.split(/^## /m).filter(text => /^[-a-z]+\n\nQuestion:/.test(text)).map(text => {
  const id = text.split("\n")[0];
  const question = text.match(/^Question: (.*)$/m)![1];
  const [, area, status, tour] = text.match(/^Area: (.*?) · Status: (.*?) · Tour: (.*?)$/m)!;
  const how = section(text, "How MiniTickets does it / where it would go");
  const files = [...how.matchAll(/`((?:apps|infra|scripts|packages|\.github)\/[\w./-]+)`/g)].map(m => m[1]);
  const bookmark = snippets.find(s => files.includes(s.file));
  const practice = section(text, "Practice");
  return { id, question, area, status, tour, answer: section(text, "30-second answer"), how,
    flow: [...section(text, "Diagram").matchAll(/\["([^"]+)"\]/g)].map(m => m[1]),
    why: section(text, "Why"), trade: section(text, "Trade-offs and alternatives"),
    scale: section(text, "At 10x / 100x"), counter: section(text, "Counter-question and answer"),
    quiz: practice.match(/^Quiz: (.*)$/m)![1], correct: practice.match(/^Correct: (.*)$/m)![1],
    wrong: practice.match(/^Alternatives: (.*)$/m)![1].split(" / "), files,
    source: text.match(/Primary reference: \[official documentation\]\(([^)]+)\)/)?.[1] ?? "",
    codeLink: bookmark ? `code-tours.html#${encodeURIComponent(bookmark.id)}` : `code-tours.html?q=${encodeURIComponent(files[0] ?? id)}` };
});
const scenarioPayload = JSON.stringify(scenarios, null, 2).replaceAll("<", "\\u003c");
for (const target of ["docs/handbook/generated/scenarios.json", "docs/handbook/guides/scenarios.html"]) {
  const absolute = path.join(root, target), before = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const after = target.endsWith(".json") ? scenarioPayload + "\n" : before.replace(/<script type="application\/json" id="scenario-data">[\s\S]*?<\/script>/,
    () => `<script type="application/json" id="scenario-data">\n${scenarioPayload}\n</script>`);
  if (before !== after) { stale = true; if (!check) writeFileSync(absolute, after); }
}
// 4. CI checks freshness without writing. The owner rebuilds after changing anchored source.
if (check && stale) { console.error("Generated learning data is stale: run pnpm docs:build"); process.exit(1); }
console.log(`docs:${check ? "fresh" : "build"}: ${snippets.length} snippets from ${new Set(snippets.map(s => s.file)).size} files`);
