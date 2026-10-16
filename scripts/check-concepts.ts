// Checks that the handbook (docs/handbook/) and the code agree. Run with: pnpm docs:check
// Node runs this TypeScript file directly (it strips the types), so it needs no build step.
// The root package.json has no "type", so Node warns that it guessed "ES module"; the
// docs:check script turns that one warning off (--disable-warning=MODULE_TYPELESS_PACKAGE_JSON).
//
// What it checks:
//   1. Every `@concept: <slug>` anchor in the code has a card: docs/handbook/concepts/<slug>.md.
//   2. Every "- Anchor: `<file>`" line in a card's "Where in our code" section points to a file
//      that exists AND holds an anchor for that card's slug.
//   3. Every file that holds an anchor is listed in its card (so cards never miss a place).
//   4. concept-map.md links to every card.
//   5. Every link to a concepts/<slug>.md card, in any handbook file, points to a card that exists.
//   6. Every handbook page (except CHANGELOG.md and PENDING.md) has the history line right under its title:
//      History: see [CHANGELOG.md](…) or run `pnpm docs:history`
//   7. Story placement. Every card has a "Where it appears in the story" section, and:
//      - each link in it points to a real chapter (a "## " heading) of app-story.md,
//        infra-story.md or 00-big-picture.md, and that chapter links back to the card;
//      - a ✅ or 🟡 card is linked from at least one story chapter (no orphan cards);
//      - a ✅ AWS card appears in the "components" table of 00-big-picture.md.
//   8. Guides (docs/handbook/guides/: teaching guides, not request-path stories).
//      - no "*-story.md" other than the stories sits in docs/handbook/ (guides go in guides/);
//      - every guide file is linked from docs/handbook/README.md;
//      - every relative link in a guide points to a file that exists;
//      - every code path in a guide (`infra/src/network.ts`) exists, and in "`file` → `symbol`"
//        pairs the symbol appears in that file;
//      - the explorer (guides/infra-explorer.html): its JSON block parses, every code reference
//        names an existing file that contains the symbol, every connection joins two known
//        components, and every written chapter's title is a "## Chapter N: Title" heading in
//        guides/infra-build-along.md.
// It prints every problem it finds, then exits with code 1 if there was at least one.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkExplorerContent } from "./explorer-content.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HANDBOOK = path.join(ROOT, "docs/handbook");
const CARDS = path.join(HANDBOOK, "concepts");
const THIS_FILE = "scripts/check-concepts.ts";

// 1. Which files may hold anchors: code and config, not docs.
//    `//` comments: TS/JS files. `#` comments: Dockerfiles, YAML and shell scripts.
const CODE_FILE = /\.(ts|tsx|js|mjs|cjs|mts|cts|ya?ml|sh)$|(^|\/)Dockerfile[^/]*$/;

// 2. An anchor is a comment marker (//, /* or #), then "@concept:", then a slug.
//    We capture any word there (not only valid characters), so a typo like "Graceful_Shutdown"
//    is reported instead of silently ignored. The "@" is joined from two parts so this line is
//    not itself an anchor.
const ANCHOR = new RegExp("(?://|/\\*|#)\\s*" + "@" + "concept:\\s*([^\\s*]+)", "g");
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const problems: string[] = [];

// 3. All files git knows about or would add (tracked + untracked, minus .gitignore'd ones).
//    WHY git: it already skips node_modules, .next, dist and other build output.
function listRepoFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\n").filter((file) => file !== "" && existsSync(path.join(ROOT, file)));
}

// 4. Collect the anchors: slug -> the files that hold it.
function findAnchors(): Map<string, Set<string>> {
  const anchors = new Map<string, Set<string>>();
  const codeFiles = listRepoFiles().filter(
    (file) => CODE_FILE.test(file) && !file.startsWith("docs/") && file !== THIS_FILE,
  );

  for (const file of codeFiles) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of text.matchAll(ANCHOR)) {
      const slug = match[1];
      if (!SLUG.test(slug)) {
        problems.push(`${file}: anchor "${slug}" is not a kebab-case slug (like "graceful-shutdown")`);
        continue;
      }
      if (!anchors.has(slug)) anchors.set(slug, new Set());
      anchors.get(slug)!.add(file);
    }
  }
  return anchors;
}

// 5. Cards keep their machine-readable anchors, including in folded source notes.
//    Read the whole card so both the original and interview formats work during the two batches.
function cardAnchorFiles(cardText: string): string[] {
  return [...cardText.matchAll(/^- Anchor: `([^`]+)`/gm)].map((match) => match[1]);
}

// 6. The interview batch is explicit: old cards remain valid until their own rewrite.
const INTERVIEW_CARDS = [
  "vpc", "subnets", "route-tables", "security-groups", "execution-vs-task-role", "secrets-manager",
  "alb", "target-groups", "health-checks", "ecs-cluster", "ecs-service", "task-definition", "fargate",
  "ecr", "rds-postgres", "elasticache-valkey", "cloudfront", "sqs", "dead-letter-queue", "sns",
  "aws-lambda", "dynamodb", "presigned-urls", "ses-email", "cloudwatch-logs", "alerting", "outbox",
  "idempotency", "row-locks", "cache-aside", "rate-limiting", "sessions-vs-jwt", "ci-pipeline",
  "cd-oidc", "zero-downtime-deploys", "csr-vs-ssr",
];
const INTERVIEW_HEADINGS = [
  "In one line", "Where it sits", "How it works", "What happens in MiniTickets",
  "Reach / Allowed / Password", "In our code", "In the AWS console", "Good / Bad", "Other choices",
  "Connected to", "When it breaks", "Say it in 30 seconds", "Likely follow-ups", "Remember it", "More detail",
];

function checkInterviewCards(cardSlugs: string[]) {
  const explorer = JSON.parse(readFileSync(path.join(HANDBOOK, "generated/explorer-v3.json"), "utf8")) as {
    chapters: { n: number }[]; components: { id: string }[]; codePieces: { id: string }[];
  };
  const pieces = new Set([...explorer.components, ...explorer.codePieces].map(piece => piece.id));
  const chapters = new Set(explorer.chapters.map(chapter => String(chapter.n)));
  const glossary = readFileSync(path.join(HANDBOOK, "glossary.md"), "utf8");
  const glossaryIds = new Set([
    ...[...glossary.matchAll(/^#+ (.*)/gm)].map(match => headingId(match[1])),
    ...[...glossary.matchAll(/<a id="([^"]+)"/g)].map(match => match[1]),
  ]);
  for (const slug of new Set([...INTERVIEW_CARDS, ...cardSlugs.filter(slug =>
    readFileSync(path.join(CARDS, `${slug}.md`), "utf8").includes("<!-- interview-card: v1 -->"))])) {
    const name = `concepts/${slug}.md`;
    if (!cardSlugs.includes(slug)) { problems.push(`${name}: missing interview card`); continue; }
    const text = readFileSync(path.join(CARDS, `${slug}.md`), "utf8");
    if (!text.includes("<!-- interview-card: v1 -->")) problems.push(`${name}: missing interview format marker`);
    if (!/^# .+: .+/m.test(text)) problems.push(`${name}: title needs a city nickname after a colon`);
    if (!/^Area: .+ · Status: /m.test(text)) problems.push(`${name}: missing area/status line`);
    // 6a. Compare all visible headings in order, then require content under each one.
    const visible = text.replace(/<details>[\s\S]*?<\/details>/g, "");
    const expected = INTERVIEW_HEADINGS.map((heading, index) => `${index + 1}. ${heading}`);
    const actual = [...visible.matchAll(/^## (.*)/gm)].map(match => match[1]);
    if (JSON.stringify(actual) !== JSON.stringify([...expected, "Where it appears in the story"])) {
      problems.push(`${name}: needs the 15 interview sections in order, then story placement`);
    }
    const sections = new Map([...text.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
      .map(match => [match[1], match[2].trim()]));
    for (const heading of expected) if (!sections.get(heading)) problems.push(`${name}: empty section ${heading}`);
    // 6b. Two readable pictures: a highlighted neighborhood and one chronological flow.
    const diagrams = [...visible.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(match => match[1]);
    if (diagrams.length !== 2 || !sections.get("2. Where it sits")?.includes("```mermaid\nflowchart ") ||
        !sections.get("3. How it works")?.includes("```mermaid\nsequenceDiagram")) {
      problems.push(`${name}: needs a flowchart in Where it sits and sequence diagram in How it works`);
    }
    const flow = diagrams[0] ?? "";
    const shapes = flow.replace(/"[^"\n]*"/g, '""').replace(/\|[^|\n]*\|/g, "||");
    const boxes = new Set([...shapes.matchAll(/\b([A-Za-z][\w-]*)\s*(?:\[|\(|\{)/g)].map(match => match[1]));
    if (boxes.size > 8) problems.push(`${name}: Where it sits has ${boxes.size} boxes; maximum 8`);
    const highlighted = [...flow.matchAll(/^\s*class\s+([\w, -]+?)\s+focus\b/gm)]
      .flatMap(match => match[1].split(",").map(id => id.trim()));
    if (!/classDef\s+focus\b/.test(flow) || !highlighted.length || highlighted.some(id => !boxes.has(id))) {
      problems.push(`${name}: highlight the focal piece with classDef focus and class … focus`);
    }
    for (const line of flow.split("\n").filter(line => /-->|-\.->|==>/.test(line))) {
      for (const arrow of line.matchAll(/-->|-\.->|==>/g)) {
        if (!/^\s*\|[^|]+\|/.test(line.slice(arrow.index + arrow[0].length))) {
          problems.push(`${name}: label every flowchart arrow with |what allows it|: ${line.trim()}`);
        }
      }
    }
    // 6c. A real map piece and chapter are required; app concepts also open their source notes.
    const links = [...visible.matchAll(/\]\(\.\.\/guides\/infra-explorer\.html\?concept=([^#)]+)#([^)]*)\)/g)];
    if (links.length !== 1) problems.push(`${name}: needs one focused explorer link with ?concept=${slug}#chapter=…&piece=…`);
    for (const link of links) {
      const params = new URLSearchParams(link[2]);
      if (link[1] !== slug || !chapters.has(params.get("chapter") ?? "") || !pieces.has(params.get("piece") ?? "")) {
        problems.push(`${name}: explorer link names a wrong concept, missing chapter or missing piece`);
      }
    }
    // 6d. This is a word budget, not an exact printer-page guarantee. Diagrams and folded notes
    //     have their own space; 550 words keeps the first read short at normal handbook type size.
    const prose = visible.replace(/```[\s\S]*?```/g, "").replace(/^#+ .*$/gm, "")
      .replace(/^(?:History:|Area:|<!--|\|\s*---).*$/gm, "");
    const words = prose.match(/[\p{L}\p{N}][^\s]*/gu)?.length ?? 0;
    const allWords = text.match(/[\p{L}\p{N}][^\s]*/gu)?.length ?? 0;
    if (words > 550) problems.push(`${name}: ${words} first-read words; maximum 550 (diagrams/folded notes excluded)`);
    if (allWords > 2200) problems.push(`${name}: ${allWords} total words; maximum 2200 including folded notes`);
    if (!/<details>\s*<summary>[^<]+<\/summary>[\s\S]+<\/details>/.test(sections.get("15. More detail") ?? "")) {
      problems.push(`${name}: More detail needs folded useful source notes`);
    }
    for (const link of text.matchAll(/\]\(\.\.\/glossary\.md#([^)]*)\)/g)) {
      if (!glossaryIds.has(link[1])) problems.push(`${name}: broken glossary term #${link[1]}`);
    }
    // Source pairs remain easy to check without requiring app code changes or new anchors.
    for (const ref of text.matchAll(/`([\w./-]+\.[a-z]+)` → `([\w.:-]+)`/g)) {
      const full = path.join(ROOT, ref[1]);
      const source = existsSync(full) ? readFileSync(full, "utf8") : "";
      // A class method is written as DynamoTickets.reserve in prose, but declared in two parts.
      if (!source || !ref[2].split(".").every(symbol => source.includes(symbol))) problems.push(`${name}: invalid source pair ${ref[1]} → ${ref[2]}`);
    }
  }
  // 6e. Every existing card gets a place and an answer goal in the six-part reading path.
  const learning = path.join(HANDBOOK, "learning-path.md");
  if (!existsSync(learning)) { problems.push("learning-path.md: missing concept reading path"); return; }
  const text = readFileSync(learning, "utf8");
  const ordered = [...text.matchAll(/^- \[[^\n]+\]\(concepts\/([a-z0-9-]+)\.md\).*after this you can answer: .+/gm)].map(match => match[1]);
  for (const slug of cardSlugs) if (ordered.filter(item => item === slug).length !== 1) problems.push(`learning-path.md: ${slug} needs exactly one reading entry with an answer goal`);
  if ((text.match(/^## Part [1-6]: /gm) ?? []).length !== 6 || (text.match(/```mermaid\n/g) ?? []).length !== 6) problems.push("learning-path.md: needs six parts and six big-picture Mermaid diagrams");
  if (!readFileSync(path.join(HANDBOOK, "README.md"), "utf8").includes("(learning-path.md)")) problems.push("README.md: link learning-path.md as the concepts starting point");
}

// 7. Story chapters: file -> chapter id -> the card slugs that chapter links.
//    A chapter is everything under a "## " heading, up to the next one. WHY "## " only: the
//    sub-headings inside a chapter (### 1. In one line …) repeat in every chapter.
const STORY_FILES = ["app-story.md", "infra-story.md", "00-big-picture.md"];
type Chapter = { text: string; cards: Set<string> };

// GitHub's heading id: lower-case, drop punctuation, each space becomes a hyphen.
function headingId(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-");
}

function readChapters(): Map<string, Map<string, Chapter>> {
  const result = new Map<string, Map<string, Chapter>>();
  for (const file of STORY_FILES) {
    const chapters = new Map<string, Chapter>();
    let current: Chapter | undefined;
    for (const line of readFileSync(path.join(HANDBOOK, file), "utf8").split("\n")) {
      const heading = line.match(/^## (.*)/);
      if (heading) {
        current = { text: heading[1].trim(), cards: new Set() };
        chapters.set(headingId(current.text), current);
        continue;
      }
      if (!current) continue;
      for (const link of line.matchAll(/\(concepts\/([a-z0-9-]+)\.md\)/g)) current.cards.add(link[1]);
    }
    result.set(file, chapters);
  }
  return result;
}

function checkStoryPlacement(cardSlugs: string[]) {
  const chapters = readChapters();
  const linkedFromStory = new Set<string>();
  for (const byId of chapters.values()) {
    for (const chapter of byId.values()) for (const card of chapter.cards) linkedFromStory.add(card);
  }

  // The "components" table of the big picture: table rows under a heading that contains "components".
  const bigPicture = readFileSync(path.join(HANDBOOK, "00-big-picture.md"), "utf8");
  const componentsStart = bigPicture.search(/^## .*components/im);
  const componentsRest = componentsStart === -1 ? "" : bigPicture.slice(componentsStart + 1);
  const componentsEnd = componentsRest.search(/^## /m);
  const componentsSection = componentsEnd === -1 ? componentsRest : componentsRest.slice(0, componentsEnd);
  const inComponentsTable = new Set(
    [...componentsSection.matchAll(/^\|.*\(concepts\/([a-z0-9-]+)\.md\)/gm)].map((match) => match[1]),
  );
  if (componentsStart === -1) problems.push('00-big-picture.md: there is no "## … Components" section with a table');

  for (const slug of cardSlugs) {
    const cardFile = `docs/handbook/concepts/${slug}.md`;
    const text = readFileSync(path.join(CARDS, `${slug}.md`), "utf8");
    const status = text.match(/^Area: (.*?) · Status: (\S+)/m);
    const area = status?.[1] ?? "";
    const symbol = status?.[2] ?? "";
    const built = symbol === "✅" || symbol === "🟡";

    // 7a. The card has the section, and its links are real and point back.
    const start = text.search(/^## Where it appears in the story/m);
    if (start === -1) {
      problems.push(`${cardFile}: missing the heading "## Where it appears in the story"`);
    } else {
      const rest = text.slice(start + 1);
      const end = rest.search(/^## /m);
      const section = end === -1 ? rest : rest.slice(0, end);
      const links = [...section.matchAll(/\]\(\.\.\/([^)#\s]+\.md)#([^)\s]+)\)/g)];
      if (built && links.length === 0) problems.push(`${cardFile}: "Where it appears in the story" has no chapter link`);
      for (const link of links) {
        const chapter = chapters.get(link[1])?.get(link[2]);
        if (!chapter) problems.push(`${cardFile}: links to ${link[1]}#${link[2]}, but that chapter does not exist`);
        else if (!chapter.cards.has(slug)) {
          problems.push(`${cardFile}: links to ${link[1]} "${chapter.text}", but that chapter does not link back to this card`);
        }
      }
    }

    // 7b. No orphan cards.
    if (built && !linkedFromStory.has(slug)) {
      problems.push(`${cardFile}: ${symbol} card is not linked from any story chapter (app-story, infra-story or 00-big-picture)`);
    }

    // 7c. ✅ AWS cards appear in the components table.
    if (symbol === "✅" && area.startsWith("AWS ") && !inComponentsTable.has(slug)) {
      problems.push(`${cardFile}: ✅ AWS card is missing from the components table in 00-big-picture.md`);
    }
  }
}

// 8. Guides. WHY a check: a guide quotes file paths, functions and chapter titles. When the code
//    moves on, those quotes are the first thing to go stale, and a beginner can't tell.
const GUIDES = path.join(HANDBOOK, "guides");
const EXPLORER_FILE = "infra-explorer.html";
const BUILD_ALONG_FILE = "infra-build-along.md";
// A repo path in backticks, e.g. `infra/src/network.ts`. No "*" or "<…>": those are patterns.
const CODE_PATH = /^(?:infra|apps|packages|scripts|\.github|docs)\/[\w./-]+$|^[\w.-]+\.(?:ya?ml|json)$/;

// A path as a guide writes it: from the repo root, or a bare name like `Pulumi.dev.yaml` (infra/)
// or `cd.yml` (.github/workflows/). Returns the full path, or undefined if there is no such file.
function findCodeFile(quoted: string): string | undefined {
  const candidates = quoted.includes("/") ? [quoted] : [quoted, `infra/${quoted}`, `.github/workflows/${quoted}`];
  return candidates.map((candidate) => path.join(ROOT, candidate)).find((full) => existsSync(full));
}

function checkGuides() {
  // 8a. Request-path stories live in the handbook root; any other "*-story.md" there is a guide.
  for (const name of readdirSync(HANDBOOK)) {
    if (name.endsWith("-story.md") && !STORY_FILES.includes(name)) {
      problems.push(`docs/handbook/${name}: a story file that is not a request-path story. Move it to docs/handbook/guides/`);
    }
  }
  if (!existsSync(GUIDES)) return;

  // 8b. Every guide is linked from the handbook README, so a reader can find it.
  const readme = readFileSync(path.join(HANDBOOK, "README.md"), "utf8");
  const guideFiles = readdirSync(GUIDES).filter((name) => name.endsWith(".md") || name.endsWith(".html"));
  for (const name of guideFiles) {
    if (!readme.includes(`(guides/${name})`)) {
      problems.push(`docs/handbook/README.md: no link to the guide guides/${name}`);
    }
  }

  for (const name of guideFiles.filter((file) => file.endsWith(".md"))) {
    const file = `docs/handbook/guides/${name}`;
    const text = readFileSync(path.join(GUIDES, name), "utf8");

    // 8c. Relative links resolve (web links like https://… are skipped).
    for (const match of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^[a-z]+:/i.test(target)) continue;
      if (!existsSync(path.join(GUIDES, target.split("?")[0]))) problems.push(`${file}: links to ${target}, but that file does not exist`);
    }

    // 8d. Code paths in backticks exist. Only whole paths count (`infra/src/network.ts`), and a bare
    //     file name only for YAML / JSON files we name a lot (`Pulumi.dev.yaml` is looked up in infra/).
    for (const match of text.matchAll(/`([^`\s]+)`/g)) {
      const quoted = match[1];
      if (!CODE_PATH.test(quoted) || quoted.includes("*")) continue;
      // Local-only env files (apps/api/.env, apps/web/.env.local) are git-ignored copies of the
      // committed .env.example files, so they never exist in CI.
      if (/\/\.env(\.local)?$/.test(quoted)) continue;
      // A bare "x.json" that is not one of our files is just a word (e.g. `foo.json` in an
      // example is not a reference), so only full paths are reported.
      if (!findCodeFile(quoted) && quoted.includes("/")) problems.push(`${file}: names \`${quoted}\`, but that file does not exist`);
    }

    // 8e. "`file` → `symbol`" pairs: the symbol is really in that file.
    for (const match of text.matchAll(/`([\w./-]+\.[a-z]+)` → `([\w.:-]+)`/g)) {
      const [, codeFile, symbol] = match;
      const full = findCodeFile(codeFile);
      if (!full) continue; // already reported by 8d
      if (!readFileSync(full, "utf8").includes(symbol)) {
        problems.push(`${file}: says \`${codeFile}\` → \`${symbol}\`, but "${symbol}" is not in that file`);
      }
    }
  }

  // 8f. The explorer's data.
  const explorerPath = path.join(GUIDES, EXPLORER_FILE);
  if (!existsSync(explorerPath)) return;
  const explorerName = `docs/handbook/guides/${EXPLORER_FILE}`;
  const html = readFileSync(explorerPath, "utf8");
  const block = html.match(/<script type="application\/json" id="city-data">([\s\S]*?)<\/script>/);
  if (!block) {
    problems.push(`${explorerName}: no <script type="application/json" id="city-data"> block`);
    return;
  }
  type FlowReference = { file: string; symbol: string };
  type ConnectionCheck = { name: string; line: string; pass: boolean; rule: string; code: FlowReference[]; console: string };
  type FlowStep = { title: string; line: string; component?: string; connection?: string; reverse?: boolean; code: FlowReference[]; console: string };
  type Explorer = {
    chapters: { n: number; title: string; status: string }[];
    components: { id: string; name: string; lifecycle?: string; code?: { file: string; symbol?: string }[] }[];
    connections: { id: string; from: string; to: string; label: string; kind: string; checks: ConnectionCheck[] }[];
    codePieces: { id: string; name: string; file: string; symbol: string }[];
    tours: { id: string; steps: { title: string; pieces: string[]; console: { path: string; expect: string; question: string }; cli: string }[] }[];
    flows: { id: string; title: string; steps?: FlowStep[]; checks?: boolean; defaultConnection?: string }[];
  };
  let data: Explorer;
  try {
    data = JSON.parse(block[1]) as Explorer;
  } catch (error) {
    problems.push(`${explorerName}: the city-data JSON does not parse (${(error as Error).message})`);
    return;
  }

  const ids = new Set<string>();
  // Content belongs to the piece the reader clicked: require complete, unique explanations and service-correct tools.
  problems.push(...checkExplorerContent(data.components).map(problem => `${explorerName}: ${problem}`));
  for (const component of data.components) {
    if (ids.has(component.id)) problems.push(`${explorerName}: component id "${component.id}" is used twice`);
    ids.add(component.id);
    for (const ref of component.code ?? []) {
      const full = path.join(ROOT, ref.file);
      if (!existsSync(full)) {
        problems.push(`${explorerName}: component "${component.id}" names ${ref.file}, but that file does not exist`);
      } else if (ref.symbol && !readFileSync(full, "utf8").includes(ref.symbol)) {
        problems.push(`${explorerName}: component "${component.id}" names ${ref.file} → ${ref.symbol}, but that symbol is not in the file`);
      }
    }
  }
  const componentIds = new Set(ids);
  const connectionIds = new Set<string>();
  for (const connection of data.connections) {
    if (connectionIds.has(connection.id)) problems.push(`${explorerName}: connection id "${connection.id}" is used twice`);
    connectionIds.add(connection.id);
    for (const end of [connection.from, connection.to]) {
      if (!ids.has(end)) problems.push(`${explorerName}: connection "${connection.id}" joins "${end}", which is not a component`);
    }
  }

  // 8g. Tours must stay usable when the map grows: labels, targets and coverage are required.
  const catalogue = path.join(HANDBOOK, "generated/explorer-v3.json");
  if (!existsSync(catalogue) || JSON.stringify(JSON.parse(readFileSync(catalogue, "utf8"))) !== JSON.stringify(data)) {
    problems.push(`${explorerName}: generated/explorer-v3.json differs from city-data`);
  }
  const validLabel = (label: string | undefined) => !!label?.trim() && !label.includes("undefined");
  for (const piece of [...data.components, ...data.codePieces]) {
    if (!validLabel(piece.name)) problems.push(`${explorerName}: missing label for ${piece.id}`);
  }
  for (const piece of data.codePieces) {
    ids.add(piece.id);
    const full = path.join(ROOT, piece.file);
    if (!existsSync(full) || !readFileSync(full, "utf8").includes(piece.symbol)) {
      problems.push(`${explorerName}: invalid code piece ${piece.id}: ${piece.file} → ${piece.symbol}`);
    }
  }
  for (const connection of data.connections) {
    if (!validLabel(connection.label) || !validLabel(connection.kind)) problems.push(`${explorerName}: missing connection label ${connection.id}`);
  }
  const covered = new Set<string>();
  for (const tour of data.tours) {
    if (tour.id.startsWith("chapter-") && (tour.steps.length < 5 || tour.steps.length > 10)) problems.push(`${explorerName}: ${tour.id} needs 5–10 steps`);
    for (const step of tour.steps) {
      if (![step.title, step.console.path, step.console.expect, step.console.question, step.cli].every(validLabel)) problems.push(`${explorerName}: incomplete tour step in ${tour.id}`);
      for (const id of step.pieces) {
        if (!ids.has(id)) problems.push(`${explorerName}: ${tour.id} points at missing piece ${id}`);
        covered.add(id);
      }
    }
  }
  for (const component of data.components) {
    if (component.lifecycle !== "explain-only" && !covered.has(component.id)) problems.push(`${explorerName}: built piece ${component.id} is in no tour`);
  }

  // 8h. A flow can only visit real map pieces, with code and console evidence for every stop.
  const checkFlowReferences = (owner: string, refs: FlowReference[] | undefined) => {
    if (!Array.isArray(refs) || !refs.length) {
      problems.push(`${explorerName}: ${owner} needs code references`);
      return;
    }
    for (const ref of refs) {
      if (!validLabel(ref.file) || !validLabel(ref.symbol)) {
        problems.push(`${explorerName}: ${owner} has a blank code file or symbol`);
        continue;
      }
      const full = path.join(ROOT, ref.file);
      if (!existsSync(full) || !readFileSync(full, "utf8").includes(ref.symbol)) {
        problems.push(`${explorerName}: ${owner} has invalid code reference ${ref.file} → ${ref.symbol}`);
      }
    }
  };
  if (!Array.isArray(data.flows) || !data.flows.length) problems.push(`${explorerName}: flows must be a nonempty array`);
  const flowIds = new Set<string>();
  for (const flow of data.flows ?? []) {
    if (!validLabel(flow.id) || !validLabel(flow.title)) problems.push(`${explorerName}: flow needs an id and title`);
    if (flowIds.has(flow.id)) problems.push(`${explorerName}: flow id "${flow.id}" is used twice`);
    flowIds.add(flow.id);
    if (flow.checks === true) {
      if (!flow.defaultConnection || !connectionIds.has(flow.defaultConnection)) problems.push(`${explorerName}: ${flow.id} points at missing default connection ${flow.defaultConnection}`);
      if (flow.steps !== undefined) problems.push(`${explorerName}: ${flow.id} must use connection checks instead of fixed steps`);
      continue;
    }
    if (!Array.isArray(flow.steps) || !flow.steps.length) problems.push(`${explorerName}: ${flow.id} needs nonempty steps`);
    for (const [index, step] of (flow.steps ?? []).entries()) {
      const owner = `flow ${flow.id} step ${index + 1}`;
      if (![step.title, step.line, step.console].every(validLabel)) problems.push(`${explorerName}: ${owner} needs a title, narration and console path`);
      if ((step.component !== undefined) === (step.connection !== undefined)) problems.push(`${explorerName}: ${owner} needs exactly one component or connection`);
      if (step.component !== undefined && !componentIds.has(step.component)) problems.push(`${explorerName}: ${owner} points at missing component ${step.component}`);
      if (step.connection !== undefined && !connectionIds.has(step.connection)) problems.push(`${explorerName}: ${owner} points at missing connection ${step.connection}`);
      if (step.reverse !== undefined && (typeof step.reverse !== "boolean" || step.connection === undefined)) problems.push(`${explorerName}: ${owner} may reverse only a connection`);
      checkFlowReferences(owner, step.code);
    }
  }

  // 8i. Every road explains all three gates in order, including gates that do not apply.
  for (const connection of data.connections) {
    const checks = connection.checks;
    if (!Array.isArray(checks) || checks.map(check => check.name).join(",") !== "REACH,ALLOWED,PASSWORD") {
      problems.push(`${explorerName}: connection ${connection.id} needs ordered REACH, ALLOWED, PASSWORD checks`);
      continue;
    }
    for (const check of checks) {
      const owner = `connection ${connection.id} ${check.name}`;
      if (typeof check.pass !== "boolean" || ![check.line, check.rule, check.console].every(validLabel)) problems.push(`${explorerName}: ${owner} needs narration, a result, exact rule and console path`);
      checkFlowReferences(owner, check.code);
    }
  }

  // 8j. Every scenario has a decision, a real tour and a three-choice quiz.
  const scenarioFile = path.join(HANDBOOK, "generated/scenarios.json");
  if (existsSync(scenarioFile)) {
    const scenarios = JSON.parse(readFileSync(scenarioFile, "utf8")) as { id: string; question: string; area: string; status: string; tour: string; answer: string; how: string; why: string; trade: string; scale: string; counter: string; quiz: string; correct: string; wrong: string[]; flow: string[] }[];
    const tourIds = new Set(data.tours.map(t => t.id));
    const scenarioIds = new Set<string>();
    for (const scenario of scenarios) {
      if (scenarioIds.has(scenario.id)) problems.push(`Duplicate scenario ${scenario.id}`);
      scenarioIds.add(scenario.id);
      if (!tourIds.has(scenario.tour)) problems.push(`Scenario ${scenario.id} has missing tour ${scenario.tour}`);
      if (![scenario.question, scenario.area, scenario.answer, scenario.how, scenario.why, scenario.trade, scenario.scale, scenario.counter, scenario.quiz, scenario.correct].every(validLabel) || scenario.flow.length < 2 || scenario.wrong.length !== 2 || new Set([scenario.correct, ...scenario.wrong]).size !== 3) problems.push(`Incomplete scenario ${scenario.id}`);
      if (!["built", "partly", "explain-only"].includes(scenario.status)) problems.push(`Invalid scenario status ${scenario.id}`);
      if (scenario.status === "explain-only" && !scenario.how.includes("WHERE IN MINITICKETS:")) problems.push(`Scenario ${scenario.id} needs a proposed MiniTickets location`);
    }
    for (const question of ['typing "a" then "ap" in search: can the old response override the new one?', 'many requests at the same time: how does the DB handle it?', 'no cache and many requests: how to lock and get the latest?', 'caching Next pages that must not be shared (Next server, CloudFront)', 'how to check LCP and other vitals', 'idempotency', 'how Postgres caches', 'rendering 10k events', 'sale day with row locks.']) {
      if (!scenarios.some(s => s.question === question)) problems.push(`Missing required question: ${question}`);
    }
  }

  const guidePath = path.join(GUIDES, BUILD_ALONG_FILE);
  const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : "";
  for (const chapter of data.chapters.filter((c) => c.status === "written")) {
    const heading = `## Chapter ${chapter.n}: ${chapter.title}`;
    if (!guide.split("\n").includes(heading)) {
      problems.push(`${explorerName}: chapter ${chapter.n} "${chapter.title}" has no heading "${heading}" in guides/${BUILD_ALONG_FILE}`);
    }
  }
}

// 9. The completed catch-up must remain navigable, including offline HTML and archived step docs.
function checkLearningCoverage() {
  const files = listRepoFiles().filter(file => file.startsWith("docs/") && /\.(md|html)$/.test(file));
  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const links = file.endsWith(".html") ? [...text.matchAll(/href="([^"#]+)"/g)] : [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)];
    for (const link of links) {
      const target = link[1].split("?")[0].split("#")[0];
      if (/^[a-z]+:/i.test(target) || target.includes("<") || target.includes("$") || target === "…") continue;
      if (!existsSync(path.resolve(ROOT, path.dirname(file), decodeURIComponent(target)))) problems.push(`${file}: broken learning link ${target}`);
    }
  }
  const coverage = JSON.parse(readFileSync(path.join(HANDBOOK, "generated/catchup-coverage.json"), "utf8")) as { entries: { entry: string; stepDoc: string; decisions: string[]; conceptCards: string[]; scenarios: string[] }[] };
  for (const entry of coverage.entries) {
    if (!entry.decisions.length || !entry.conceptCards.length || !entry.scenarios.length) problems.push(`Incomplete catch-up coverage: ${entry.entry}`);
    for (const file of [entry.stepDoc, ...entry.decisions, ...entry.conceptCards]) if (!existsSync(path.join(ROOT, file))) problems.push(`Missing catch-up destination: ${file}`);
  }
  const start = readFileSync(path.join(GUIDES, "index.html"), "utf8");
  for (const file of readdirSync(GUIDES).filter(file => /\.(md|html)$/.test(file))) {
    if (!start.includes(`href="${file}"`)) problems.push(`Start here omits guide ${file}`);
  }
}

function main() {
  const anchors = findAnchors();

  const cardSlugs = existsSync(CARDS)
    ? readdirSync(CARDS)
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.slice(0, -".md".length))
    : [];
  const cardSet = new Set(cardSlugs);

  // Check 1: every anchor slug has a card.
  for (const [slug, files] of anchors) {
    if (!cardSet.has(slug)) {
      problems.push(
        `anchor "${slug}" (in ${[...files].join(", ")}) has no card. Create docs/handbook/concepts/${slug}.md`,
      );
    }
  }

  for (const slug of cardSlugs) {
    const cardFile = `docs/handbook/concepts/${slug}.md`;
    if (!SLUG.test(slug)) problems.push(`${cardFile}: the file name is not a kebab-case slug`);

    const listed = cardAnchorFiles(readFileSync(path.join(CARDS, `${slug}.md`), "utf8"));

    // Check 2: every file the card lists exists and holds this card's anchor.
    for (const file of listed) {
      if (!existsSync(path.join(ROOT, file))) {
        problems.push(`${cardFile}: lists \`${file}\`, but that file does not exist`);
      } else if (!anchors.get(slug)?.has(file)) {
        problems.push(`${cardFile}: lists \`${file}\`, but that file has no "@concept: ${slug}" anchor`);
      }
    }

    // Check 3: every file that holds this anchor is listed in the card.
    for (const file of anchors.get(slug) ?? []) {
      if (!listed.includes(file)) {
        problems.push(`${cardFile}: "Where in our code" is missing the line: - Anchor: \`${file}\``);
      }
    }
  }

  // Check 4: the concept map links to every card.
  const mapFile = path.join(HANDBOOK, "concept-map.md");
  const mapText = existsSync(mapFile) ? readFileSync(mapFile, "utf8") : "";
  if (mapText === "") problems.push("docs/handbook/concept-map.md is missing or empty");
  for (const slug of cardSlugs) {
    if (!mapText.includes(`(concepts/${slug}.md)`)) {
      problems.push(`concept-map.md: no link to the card concepts/${slug}.md`);
    }
  }

  // Check 5: every link to a card, in any handbook file, points to a card that exists.
  //   Handbook files link to cards as "concepts/<slug>.md"; cards link to each other as "<slug>.md".
  const handbookFiles = listRepoFiles().filter((file) => file.startsWith("docs/handbook/") && file.endsWith(".md"));
  for (const file of handbookFiles) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of text.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
      const target = path.join(ROOT, path.dirname(file), match[1]);
      const isCardLink = path.dirname(target) === CARDS;
      if (isCardLink && !existsSync(target)) {
        problems.push(`${file}: links to ${match[1]}, but that card does not exist yet`);
      }
    }
  }

  // Check 6: the history line sits right under the title (line 1 "# …", line 2 empty, line 3 the
  //   history line). WHY: the pages hold no hand-written dates; this line tells readers where the
  //   dates are. CHANGELOG.md is the history itself, so it is skipped. PENDING.md is skipped too:
  //   it is a to-do list for the next handbook catch-up step, not a handbook page.
  for (const file of handbookFiles) {
    if (file === "docs/handbook/CHANGELOG.md" || file === "docs/handbook/PENDING.md") continue;
    const link = path.dirname(file) === "docs/handbook" ? "CHANGELOG.md" : "../CHANGELOG.md";
    const expected = `History: see [CHANGELOG.md](${link}) or run \`pnpm docs:history\``;
    const [title, blank, history] = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    if (!title.startsWith("# ") || blank !== "" || history !== expected) {
      problems.push(`${file}: line 3 (under the title and an empty line) must be: ${expected}`);
    }
  }

  // Check 7: story placement.
  checkStoryPlacement(cardSlugs);
  checkLearningCoverage();
  checkInterviewCards(cardSlugs);

  // Check 8: guides.
  checkGuides();

  // Generated source snippets are committed and must agree with current anchored code.
  try { execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/build-docs.ts", "--check"], { cwd: ROOT, stdio: "pipe" }); }
  catch { problems.push("Generated code tours are stale; run pnpm docs:build"); }

  // Report.
  if (problems.length > 0) {
    console.error(`docs:check found ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const anchorCount = [...anchors.values()].reduce((sum, files) => sum + files.size, 0);
  console.log(`docs:check OK: ${cardSlugs.length} card(s), ${anchors.size} anchor slug(s) in ${anchorCount} place(s).`);
}

main();
