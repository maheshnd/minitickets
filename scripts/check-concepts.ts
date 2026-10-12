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
// It prints every problem it finds, then exits with code 1 if there was at least one.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

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

// 5. The "Where in our code" section of a card: from its "## 4." heading to the next "## " heading.
function whereInCodeSection(cardText: string): string {
  const start = cardText.search(/^## 4\. Where in our code/m);
  if (start === -1) return "";
  const rest = cardText.slice(start + 1);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

// 6. The files a card says hold its anchor: lines like "- Anchor: `apps/api/src/server.ts` ...".
function cardAnchorFiles(cardText: string): string[] {
  const section = whereInCodeSection(cardText);
  return [...section.matchAll(/^- Anchor: `([^`]+)`/gm)].map((match) => match[1]);
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
