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
cd infra && pulumi preview   show what infra would change (read-only). The owner runs `pulumi up`.
```

Env files: root `.env` (Docker), `apps/api/.env` and `apps/web/.env.local`, both copied from their `.env.example`.

## Code rules

- Small files, one job each.
- Add short step-wise inline comments (1., 2., 3. …) explaining WHAT each part does and WHY.
- No clever abstractions; prefer obvious code, even if it is a little longer.
- Add NO extra libraries, NO DI container, NO Docker, NO database or data store unless the current step asks for it.
- TypeScript strict everywhere; validate all external input (requests, env) with Zod.
- Shared input schemas live in `packages/shared`, not in the apps.
- Build only what the current step asks for, then stop. Don't build ahead.
- Each step gets a `docs/NN-<name>.md`. See "Docs rule" below.
- For UI changes, verify in a headless browser before reporting done. Say clearly what was and wasn't verified.

## Docs rule

Every `docs/NN-*.md` is written for a beginner.

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
For every future feature or infra step, in the SAME commit:
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
- Never add a standalone story file. The stories are `app-story.md`, `infra-story.md` and
  `00-big-picture.md`.
- `pnpm docs:check` fails if a ✅ or 🟡 card is linked from no story chapter, if a card's story link
  is broken or not mirrored by the chapter, or if a ✅ AWS card is missing from the "Components"
  table in `00-big-picture.md`.

## Handbook changelog rule

Every commit that changes anything in `docs/handbook/` adds an entry at the TOP of
`docs/handbook/CHANGELOG.md` (newest first):
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
