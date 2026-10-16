# The MiniTickets handbook

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

**In one line:** a living handbook that explains every concept in MiniTickets (app + AWS), tied to
the exact code that implements it, so interview answers come from things we built.

The step docs (`docs/01` … `docs/20`) tell the story **in the order we built it**. This handbook
tells it **by concept**: what it is, where it lives in the code, how to show it working, its
trade-offs, and how to explain it at three levels (simple, senior, lead).

```mermaid
flowchart LR
    steps["docs/NN-*.md<br/>build order"] --> hb["handbook<br/>by concept"]
    hb --> map["concept-map.md<br/>the hub"]
    map --> cards["concepts/*.md<br/>one card each"]
    cards <-->|"@concept anchors<br/>pnpm docs:check"| code["the code"]
```

## The files

| File | What it holds | Status |
| ---- | ------------- | ------ |
| [README.md](README.md) | This page: how to use the handbook | written |
| [ROADMAP.md](ROADMAP.md) | The whole plan: what is built, where things stand now, what comes next in order, known small fixes | written, updated in each catch-up |
| [concept-map.md](concept-map.md) | Every concept, grouped by area, with status and code location | written |
| [00-big-picture.md](00-big-picture.md) | The whole system, the life of one request, the life of a login | written |
| [aws-foundations.md](aws-foundations.md) | Regions, ARNs, Reach / Allowed / Password, IAM, roles, debugging | written |
| [glossary.md](glossary.md) | Every technical word used in the handbook | written, grows with every phase |
| [reference-topics.md](reference-topics.md) | The owner's checklist of interview topics | the owner's notes |
| [HANDBOOK_SPEC.md](HANDBOOK_SPEC.md) | The spec this handbook is built from | fixed |
| [infra-story.md](infra-story.md) | The AWS resources, in the order a request meets them; deploy, security and cost stories | written |
| [app-story.md](app-story.md) | Our code, in the order a request travels through it; monorepo, validation, tests, Docker, CI; the app security story | written |
| [guides/cicd-story.md](guides/cicd-story.md) | Guide. CI/CD for someone who has never seen GitHub Actions, bash or Pulumi: from `git push` to the new version on AWS, chapter by chapter, then how to read `ci.yml` and `cd.yml` line by line | written |
| [guides/infra-build-along.md](guides/infra-build-along.md) | Guide. Our AWS setup for someone who knows the app but not AWS: we move the app from the laptop to AWS one piece at a time, as one growing city map. Every setting traced from the code to the AWS console and the CLI | 25 chapters written; optional/inactive and explain-only services are labelled explicitly |
| [guides/infra-explorer.html](guides/infra-explorer.html) | Guide. The interactive city map that goes with the build-along: step through the chapters, click any piece to see its settings, code, console path, CLI and debug tip. One file: download or open it locally and double-click it (GitHub only shows its source) | chapters 0-2 |
| `concepts/<slug>.md` | One card per concept | AWS / infra cards (Phase 2) and app cards (Phase 3) written; planned and explain-only Phase 5 |
| [CHANGELOG.md](CHANGELOG.md) | What changed in the handbook, commit by commit, and why | written, one entry per handbook commit |
| `decisions/NNNN-<title>.md` | Architecture Decision Records (why we chose X over Y) | Phase 4 |
| `system-design.md` | Classic system design questions, answered from our app | Phase 4 |
| `interview-drills.md` | Question bank by interview round | Phase 5 |

## How to use it

1. Start at the [concept map](concept-map.md). Find the concept, check its status.
2. Open its card (once written). Read "In one line", "Picture it" and "Where in our code".
3. Open the code at the anchor (search for `@concept: <slug>`). Read the step-wise comments there.
4. Do "See it yourself": run the command or test, then break it on purpose.
5. Say the three interview answers out loud. Then the 30-second version.

## Reading paths

Files that are not written yet are shown without a link and with their phase.

**First full read (a few evenings)**

1. [00-big-picture.md](00-big-picture.md)
2. New to AWS? First [guides/infra-build-along.md](guides/infra-build-along.md) with
   [the explorer](guides/infra-explorer.html) open next to it: our AWS setup, one piece at a time.
3. [aws-foundations.md](aws-foundations.md)
4. [infra-story.md](infra-story.md), then [app-story.md](app-story.md)
5. [guides/cicd-story.md](guides/cicd-story.md): how a push becomes a running version on AWS
6. `decisions/` (Phase 4)
7. `system-design.md` (Phase 4)
8. Skim the [concept map](concept-map.md) for anything you skipped.

**1 hour before an interview**

1. 10 min: [00-big-picture.md](00-big-picture.md), sections 2 and 3 (one request, one login).
2. 15 min: [aws-foundations.md](aws-foundations.md), chapter 3 (Reach / Allowed / Password) and
   chapter 8 (the debugging table).
3. 25 min: "Say it in 30 seconds" of every ✅ card in the areas the role cares about.
4. 10 min: `interview-drills.md` (Phase 5) for that round.

**System design round**

[00-big-picture.md](00-big-picture.md) → `system-design.md` (Phase 4) → `decisions/` (Phase 4) →
cards from the concept map's Reliability, Performance & Caching, Data and Async & Events areas.
Know which parts are ✅ and which are 📖: say "here is what we built, here is what I'd add".

**Security round**

[aws-foundations.md](aws-foundations.md) chapters 3 to 5 → the "security story" in
[infra-story.md](infra-story.md#the-security-story) → the
[app security story](app-story.md#the-app-security-story) → the Auth & Security cards:
[`password-hashing`](concepts/password-hashing.md), [`sessions-vs-jwt`](concepts/sessions-vs-jwt.md),
[`session-cookie`](concepts/session-cookie.md), [`user-enumeration`](concepts/user-enumeration.md),
[`csrf`](concepts/csrf.md), [`xss`](concepts/xss.md), [`open-redirect`](concepts/open-redirect.md),
[`origin-protection`](concepts/origin-protection.md), [`least-privilege`](concepts/least-privilege.md),
[`secrets-management`](concepts/secrets-management.md).

**Backend round**

[app-story.md](app-story.md) chapters 4-11 → the API, Data and Reliability cards, starting with
[`layered-api`](concepts/layered-api.md), [`error-handling`](concepts/error-handling.md),
[`trpc-context`](concepts/trpc-context.md), [`unique-constraint-race`](concepts/unique-constraint-race.md),
[`connection-pooling`](concepts/connection-pooling.md), [`graceful-shutdown`](concepts/graceful-shutdown.md)
and [`fail-fast`](concepts/fail-fast.md).

**AWS round**

New to AWS: [guides/infra-build-along.md](guides/infra-build-along.md) first (each chapter ends
with a 30-second answer and likely questions). Then:
[aws-foundations.md](aws-foundations.md) (all of it) → [infra-story.md](infra-story.md) → the AWS
Network, AWS Compute and AWS Data cards → the [cost story](infra-story.md#the-cost-story).

**Frontend round**

Chapters 1-3 and 11 of [app-story.md](app-story.md) → the Frontend cards:
[`server-client-components`](concepts/server-client-components.md),
[`route-guard-proxy`](concepts/route-guard-proxy.md), [`tanstack-query`](concepts/tanstack-query.md),
[`query-invalidation`](concepts/query-invalidation.md), [`trpc-client`](concepts/trpc-client.md),
[`accessible-forms`](concepts/accessible-forms.md), [`ui-error-handling`](concepts/ui-error-handling.md)
→ [`end-to-end-types`](concepts/end-to-end-types.md) and [`retry-policy`](concepts/retry-policy.md).

## Conventions

**Status marks** (used everywhere):

| Mark | Meaning |
| ---- | ------- |
| ✅ built | In our code. |
| 🟡 partial | Partly in our code. The card says what production would add. |
| 📋 planned | Not in our app yet (planned). A step doc says we will build it. |
| 📖 explain-only | Not in our app and not planned. We explain it and say where it would go. |

**Code references** are a file path plus a symbol (function, variable or setting name), never a
line number.

**Code anchors** are comments at the exact place a concept lives. They only add comments; they
never change behaviour.

```ts
// @concept: graceful-shutdown        (TypeScript / JavaScript)
```

```dockerfile
# @concept: graceful-shutdown         (Dockerfile, YAML, shell)
```

One concept can have anchors in several files.

**Card format.** Every card (`concepts/<slug>.md`) and every story chapter uses these 16 headings,
in this order. A heading is left out only when it truly does not apply.

1. In one line
2. Real-life comparison
3. Picture it (diagram)
4. Where in our code
5. See it yourself
6. How it connects
7. Our settings and WHY
8. Trade-offs
9. Alternatives and when to choose them
10. What breaks, and how we'd notice
11. Reach / Allowed / Password (AWS resources only)
12. Cost (AWS resources only)
13. Interview answers at 3 levels
14. Follow-up questions interviewers ask
15. Say it in 30 seconds
16. Status (+ "to make it production-grade" if partial)

In a card, heading 4 is written exactly `## 4. Where in our code`, and each anchor is listed on its
own line in this form, which the check script reads:

```markdown
- Anchor: `apps/api/src/server.ts` · `shutdown`: stops accepting requests, then closes the pools.
```

Planned and explain-only cards write "Not in our app yet" under headings 4 and 5, plus what we would
build and where.

## Keeping it true: `pnpm docs:check`

`scripts/check-concepts.ts` runs in CI (the `quality` job) and locally with `pnpm docs:check`. It fails
with a clear message when:

1. a `@concept: <slug>` anchor in the code has no card `concepts/<slug>.md`;
2. a card's `- Anchor:` line names a file that does not exist or has no anchor for that card;
3. a file holds an anchor that its card does not list;
4. `concept-map.md` does not link to a card;
5. any handbook file links to a card that does not exist;
6. a handbook page is missing the history line under its title;
7. story placement is broken (an orphan ✅/🟡 card, a story link that is not mirrored, a ✅ AWS card
   missing from the components table of [00-big-picture.md](00-big-picture.md));
8. guides are out of place or out of date: a `*-story.md` other than the two stories sits in the
   handbook root (guides belong in `guides/`), a guide is not linked from this README, a guide has a
   broken relative link, or the [explorer](guides/infra-explorer.html) names a code file or symbol
   that does not exist, or a chapter title that differs from the build-along guide.

## Guides: `guides/`

A **guide** teaches one topic from zero, in the order a newcomer needs it. The stories above follow
a request; guides follow a learner. New features never go into a guide instead of a story: a guide
links to the cards and stories, it does not replace them.

| Guide | Order it follows |
| ----- | ---------------- |
| [guides/infra-build-along.md](guides/infra-build-along.md) + [guides/infra-explorer.html](guides/infra-explorer.html) | Build order: we move the app from the laptop to AWS one piece at a time. Kept up to date in the SAME step as every infra change (the living guide rule in `CLAUDE.md`). |
| [guides/cicd-story.md](guides/cicd-story.md) | Push order: from `git push` to the new version answering on AWS. |

## Change history: `CHANGELOG.md` and `pnpm docs:history`

Pages hold **no hand-written dates**. Under each title, one line points to the history:

```mermaid
flowchart LR
    page["any handbook page<br/>'History: see CHANGELOG.md…'"] --> cl["CHANGELOG.md<br/>what changed and WHY<br/>(written by hand)"]
    page --> hist["pnpm docs:history<br/>when, which commit<br/>(read from git)"]
```

- [CHANGELOG.md](CHANGELOG.md): one entry per commit that touches the handbook, newest first: date,
  subject, each changed file with its sections, and why. A commit can't contain its own hash, so
  each new entry fills in the hash of the **previous** entry.
- `pnpm docs:history`: a table of every handbook file with its last change date, commit and subject,
  straight from `git log` (`scripts/handbook-history.ts`).
- `pnpm docs:history --since <commit>`: only the files changed after that commit (including
  uncommitted changes), each with its changed section headings. Run it with the previous handbook
  commit's hash to write a new CHANGELOG entry.

Mermaid diagrams are checked separately with mermaid-cli (it is not a project dependency):

```bash
npx -y @mermaid-js/mermaid-cli -i docs/handbook/<file>.md -o /tmp/out.md
```

## The living handbook rule

For every future feature or infra step, in the **same commit**: add `@concept` anchors to the new
code, add or update the cards (status 📋 → 🟡 → ✅), update the concept map, the story chapter
and [00-big-picture.md](00-big-picture.md), add an ADR if a design decision was made, add new
words to the [glossary](glossary.md), and make sure `pnpm docs:check` passes. The same rule is in
the repo's `CLAUDE.md`.

## How this connects

- **Uses:** the step docs in [docs/](..) and the code.
- **Gives:** the entry point for every reader of the handbook.

- [Generated code tours](guides/code-tours.html): searchable source bookmarks, rebuilt with `pnpm docs:build`.
