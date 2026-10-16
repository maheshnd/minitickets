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
// 3. CI checks freshness without writing. The owner rebuilds after changing anchored source.
if (check && stale) { console.error("Generated code tours are stale: run pnpm docs:build"); process.exit(1); }
console.log(`docs:${check ? "fresh" : "build"}: ${snippets.length} snippets from ${new Set(snippets.map(s => s.file)).size} files`);
