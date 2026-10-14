# CLAUDE.md

Guidance for Claude (and humans) working in this repo.

## What this is

**minitickets** is a learning project. The owner must understand every file, so the code
favours clarity over cleverness. It is built in small numbered steps, and each step is
documented in `docs/NN-*.md`.

## Layout

```
apps/web         Next.js (App Router, src/, Tailwind). UI only.
apps/api         Fastify 5 + tRPC v11. All server logic.
packages/shared  Zod schemas + inferred types used by both apps. No other code.
infra/           Pulumi (TypeScript) AWS infrastructure. index.ts only imports layer files from src/.
docs/            One file per step, in plain English.
```

- **api:** `server.ts` (listen) → `app.ts` (build Fastify) → `trpc/` (tRPC setup) → layer folders:
  `procedures/<feature>.ts` → `services/<feature>.ts` → `queries/<feature>.ts`.
  No suffixes like `.router` or `.service`; the folder says the layer.

  procedures -> services -> queries -> data store (Postgres / Redis). Each layer only calls the layer below.
  - **Procedures:** validate input + call a service, no logic.
  - **Services:** business logic, no HTTP or SQL.
  - **Queries:** the only code that touches ANY data store (Postgres or Redis).
- **web:** `app/` is routing only. Feature code lives in `features/<feature>/{components,hooks}`.
  Components never call tRPC directly; they use a hook from their feature.
- **Types across apps:** web imports only `type AppRouter` from `@minitickets/api/router`, never runtime code.

## Commands

```
pnpm install      install everything
pnpm dev          run web (:3000) and api (:4000) together
pnpm typecheck    tsc --noEmit in every package
pnpm docs:check   handbook and code agree (@concept anchors <-> cards <-> concept map)
pnpm docs:history handbook files with last change (from git); --since <commit> for changed sections
pnpm db:up        start Postgres + Redis in Docker (waits until healthy); db:down stops it
pnpm --filter @minitickets/api db:generate / db:migrate   create / apply SQL migrations
pnpm user:make-admin <email>   make an existing (signed-up) user an admin (no UI for roles)
export AWS_PROFILE=ticketlite  once per terminal, before any aws / pulumi / infra:* command
cd infra && pulumi preview   show what infra would change (read-only). The owner runs `pulumi up`.
```

AWS credentials come from the environment (`AWS_PROFILE`), never from `infra/Pulumi.dev.yaml`: a
profile name there exists only on one laptop and breaks CD.

Env files: root `.env` (Docker), `apps/api/.env` and `apps/web/.env.local`, both copied from their `.env.example`.

## Code rules

- Small files, one job each.
- Add short step-wise inline comments (1., 2., 3. …) explaining WHAT each part does and WHY.
- No clever abstractions; prefer obvious code, even if it is a little longer.
- Add NO extra libraries, NO DI container, NO Docker, NO database or data store unless the current step asks for it.
- TypeScript strict everywhere; validate all external input (requests, env) with Zod.
- Shared input schemas live in `packages/shared`, not in the apps.
- Build only what the current step asks for, then stop. Don't build ahead.
- Each step gets a `docs/NN-<name>.md`, written later in a handbook catch-up step (see "Workflow"
  below). See "Docs rule" below for how to write it.
- For UI changes, verify in a headless browser before reporting done. Say clearly what was and wasn't verified.

## Workflow: feature steps, then a handbook catch-up

Docs are written in batches, not in every feature step.

**During a feature step:**
- Write code + tests + clear numbered inline comments (1., 2., 3. …: WHAT each part does and WHY).
- Do NOT update the handbook (`docs/handbook/`), the step docs (`docs/NN-*.md`,
  `docs/00-architecture.md`), and do NOT add `@concept` anchors.
  ONE exception: a step that adds or changes infrastructure updates the infra guide and the
  explorer in the same step (see "Living guide rule" below).
- Instead, append ONE entry to `docs/handbook/PENDING.md` (create it if missing). Max ~10 lines:
  step name, concepts covered, key files (path + function), real measured numbers, anything unsure.

**During the ticketing + serverless series** (F2a, F2b, S1-S4 in `docs/handbook/ROADMAP.md`):
- Do NOT update the handbook, the infra guide or the explorer, not even in a step that adds or
  changes infrastructure. This pauses the "Living guide rule" exception below for the series.
- Record every concept, file and infra change in that step's `PENDING.md` entry instead (for infra:
  every resource, IAM permission, security group rule, secret and CD step, with real names). A
  detailed guide + explorer update is done in ONE batch after the series.
- Still update `ROADMAP.md` every step: its status, in one or two lines.
- Each step's prompt is saved in `docs/handbook/prompts/<step>.md` (one file each, e.g. `f2a.md`),
  and `ROADMAP.md` links each "next" item to its prompt file once there is one.

**In a "handbook catch-up" step** (its own step, when the owner asks for it):
- Read `PENDING.md` and the git changes since the last catch-up.
- Do everything the "Docs rule", "Living handbook rule" and "Handbook changelog rule" below ask
  for, for all pending steps at once (step docs, `00-architecture.md`, anchors, cards, stories,
  ADRs, glossary, CHANGELOG).
- Then clear `PENDING.md` (leave only its title and intro).

## Docs rule

Every `docs/NN-*.md` is written for a beginner (written in a handbook catch-up step).

- Short sentences, simple everyday words. Explain any technical word the first time it appears.
- Every important concept gets a diagram. Use Mermaid code blocks (they render on GitHub): flowchart
  or sequence diagrams. Keep each diagram small (max ~8 boxes). Several small diagrams beat one big one.
- Use a real-life comparison where it helps (e.g. VPC = a private office building, subnets = floors,
  route table = the signboard saying where each corridor leads).
- Every doc follows this structure:
  1. In one sentence: what this step builds
  2. The big picture (diagram)
  3. Each concept: what it is -> diagram -> why we need it
  4. Dependency order: what must exist before what (diagram)
  5. What breaks if this is wrong or missing
  6. Interview questions with short answers (5-8)
  7. Check yourself: 3 questions without answers
- Check that every Mermaid diagram has valid syntax before committing.
- `docs/00-architecture.md` is the living big picture. UPDATE it in every step:
  - one Mermaid diagram of the whole system as it exists today (browser, web, api, postgres,
    redis, and the AWS layers built so far); mark not-yet-built parts as "planned"
  - a table: each layer/doc, what it creates, what it depends on
- Every new doc has a section "How this connects": what it uses from earlier layers (with links
  to those docs) and what later layers will use from it.
- For any IAM permission (from Step 11e on), always explain it with a diagram of:
  (a) the TRUST POLICY: who is allowed to use this role
  (b) the PERMISSION POLICY: what the role is allowed to do
  (c) which resource the role is attached to

## Living handbook rule

`docs/handbook/` explains every concept, tied to the code (spec: `docs/handbook/HANDBOOK_SPEC.md`).
This is done in the handbook catch-up step (see "Workflow" above), NOT in each feature step.
In the catch-up step, for every pending feature or infra step:
- add `@concept: <slug>` anchors to the new code (`//` in TS/JS, `#` in Dockerfile, YAML, shell);
  comments only, never a behaviour change
- add or update the concept cards in `docs/handbook/concepts/` (status 📋 -> 🟡 -> ✅)
- update `concept-map.md`, the relevant story chapter (`infra-story.md` / `app-story.md`) and
  `00-big-picture.md`
- add an ADR in `docs/handbook/decisions/` if a design decision was made
- add new words to `docs/handbook/glossary.md`
- every concept card has a "Where it appears in the story" section linking the exact chapter(s)
  in `app-story.md` / `infra-story.md` / `00-big-picture.md`
- `pnpm docs:check` must pass

### Story placement rule

- New features go in the story **where a request meets them**, in the chapter for that stop.
- Something off the main path (a background job, a webhook, a retry queue) becomes a **side path**
  chapter right after the step where it branches off, with a diagram of the branch point.
- Never add a standalone REQUEST-PATH story file. The request-path stories are `app-story.md`,
  `infra-story.md` and `00-big-picture.md`; new features go into them.
- Teaching GUIDES are different: a guide teaches one topic from zero, in its own order (for example
  the CI/CD story, or the infra build-along). Guides live ONLY in `docs/handbook/guides/`, and every
  guide is linked from `docs/handbook/README.md`. `pnpm docs:check` enforces both.
- `pnpm docs:check` fails if a ✅ or 🟡 card is linked from no story chapter, if a card's story link
  is broken or not mirrored by the chapter, or if a ✅ AWS card is missing from the "Components"
  table in `00-big-picture.md`. For guides it fails if a `*-story.md` other than the two stories
  sits in `docs/handbook/`, a guide is not linked from the handbook README, a guide's relative link
  is broken, or the explorer names a code file / symbol that does not exist or a chapter title
  that differs from the guide.

## Living guide rule (infra guide + explorer)

`docs/handbook/guides/infra-build-along.md` (the guide) and `docs/handbook/guides/infra-explorer.html`
(the explorer) teach our AWS setup as one growing city map. They must never fall behind the code.

Whenever a step adds or changes infrastructure (a service, an IAM role or permission, a security
group rule, a secret, a route, a DNS record, a CD step), update the guide AND the explorer in the
SAME step. (Paused during the ticketing + serverless series: see "Workflow" above.) This is the one exception to the "batch docs later" workflow above. Update:
- the right chapter of the guide (or add one, in build order), and its city-story comparison
  (only the city words from the guide's city table);
- for IAM: the WHO / WHAT / ATTACHED picture (trust policy, permission policy, where it is
  attached), marking what is new and why ONLY that permission is needed;
- the who-talks-to-whom chain, and "what breaks without it" as Reach / Allowed / Password;
- the Code -> Console -> CLI rows (file + function + exact value, console click path + field);
- the growing Mermaid diagram (new part highlighted), the "Map so far" diagram and the poster;
- the explorer's JSON data: the component(s), the connection(s) with what allows each one, and
  the chapter's 3-line summary. Content must match the guide.
Then: Mermaid validation (mermaid-cli) and `pnpm docs:check` pass. Real IDs, names and values only;
if unsure about an AWS fact, say so in the text.

## Handbook changelog rule

Every commit that changes anything in `docs/handbook/` adds an entry at the TOP of
`docs/handbook/CHANGELOG.md` (newest first). Exceptions (no entry needed, to avoid noise), as long
as the commit changes nothing else in `docs/handbook/`:
- appending to `PENDING.md` (it is a to-do list, not a handbook page; the catch-up step's entry
  covers it);
- a step's status line(s) in `ROADMAP.md`;
- a new prompt file in `docs/handbook/prompts/`.
- date (YYYY-MM-DD) and the commit subject
- each changed file, one line each: which sections were added or changed, and why
  (`pnpm docs:history --since <previous handbook commit>` lists the files and changed headings)
- `Commit:` is left as "filled in by the next handbook commit", because a commit can't contain its
  own hash. In the same edit, fill in the hash of the PREVIOUS entry
  (`git log -1 --format=%h -- docs/handbook`).
- Handbook pages hold no hand-written dates; under each title is the line
  "History: see [CHANGELOG.md](…) or run `pnpm docs:history`" (`pnpm docs:check` enforces it).

## Safety rules

- Never commit or stage. Leave changes for the user to review, and suggest a commit message.
- AWS / Pulumi: use the owner's existing AWS CLI profile and Pulumi login. Never print credentials.
  You may run `pulumi preview`. NEVER run `pulumi up` or `pulumi destroy`: the owner runs those.
- The environment's shape (dataEnabled, computeEnabled, entryEnabled, cdnEnabled, domainName) is the
  COMMITTED `infra/Pulumi.dev.yaml`; the deployed image tag is SSM `/minitickets/dev/image-tag`,
  written only by CD. Never run `pulumi up` locally with uncommitted config: the next CD deploy
  applies the committed file and undoes it. To turn the environment on or off: change the file,
  commit, push, approve the CD deploy job. Never commit `apiImageTag`/`webImageTag` (emergency
  overrides) or `migrationImageTag` (set only by CD with `--config`). `pulumi preview --config ...`
  also WRITES that config into the file: back it up and restore it afterwards.

- Never kill or restart processes you did not start. If a port is busy, use another port
  for your own test instance.
- Never stop or restart Docker or other projects' containers.
- When you start a process for testing, record its PID right away (e.g. `$!` after starting it
  in the background) and stop only that PID with `kill <pid>`. Never stop a process by name or
  pattern: no `pkill`, `killall`, `kill $(lsof ...)`, `kill $(pgrep ...)` or `xargs kill`.
  A pattern can match the owner's own dev servers. `.claude/settings.json` denies these commands.

## Notes

- `apps/web/AGENTS.md` is auto-generated by `next dev`. Leave it alone; Next re-creates it if deleted.
- TypeScript is pinned to 5.9 (the classic JS compiler). Next.js tooling uses its JS API,
  which the native TypeScript 7 doesn't fully provide yet.
