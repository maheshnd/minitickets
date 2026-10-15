# AGENTS.md

Instructions for coding agents (OpenAI Codex and others) working in this repo. This file is short on
purpose: it points to the sources of truth instead of copying them.

## Read these first

1. [CLAUDE.md](CLAUDE.md): the full rule book. **All its rules apply to you too**, not only to
   Claude. If this file and `CLAUDE.md` ever disagree, follow the stricter one.
2. [docs/handbook/ROADMAP.md](docs/handbook/ROADMAP.md): what is done, where we are now, what comes
   next, in order.
3. [docs/handbook/PENDING.md](docs/handbook/PENDING.md): finished steps whose docs are not written
   yet. Its entries hold the real details (files, measured numbers, open questions).
4. [docs/00-architecture.md](docs/00-architecture.md) and
   [docs/handbook/00-big-picture.md](docs/handbook/00-big-picture.md): the system as it is today.

## What this is

**minitickets** is a small ticketing app (events list, sign up, log in, book tickets), built as
a **learning project to prepare for senior / lead engineer interviews**. The owner must understand
every file, so clarity beats cleverness. It is built in small numbered steps; each one is explained
in plain English in `docs/`.

**Stack:** pnpm monorepo, Node 24, TypeScript 5.9 strict (pinned; do not upgrade to 7).
Web: Next.js 16 (App Router), React 19, Tailwind 4, TanStack Query, tRPC client.
API: Fastify 5 + tRPC v11, Drizzle + Postgres, Redis (ioredis; Valkey on AWS).
Shared: Zod 4. Tests: Vitest (unit), Playwright (e2e).
Infra: Pulumi (TypeScript) on AWS: VPC, RDS, ElastiCache, ECR, ECS Fargate (arm64), ALB, ACM,
optional CloudFront. CI/CD: GitHub Actions, AWS access through OIDC (no stored keys).

**Layout and layer rules** (details in `CLAUDE.md`, "Layout"):

```
apps/web         Next.js. UI only. app/ = routing only; features/<feature>/{components,hooks}
apps/api         Fastify + tRPC. All server logic.
apps/worker      Background worker: reads the jobs queue (same handler locally and on Lambda)
packages/shared  Zod schemas + inferred types used by both apps. No other code.
infra/           Pulumi. index.ts only imports layer files from src/.
docs/            One file per step (docs/NN-*.md) + the handbook (docs/handbook/).
```

- API layers: `procedures/<feature>.ts` → `services/<feature>.ts` → `queries/<feature>.ts` → Postgres
  / Redis, or `queues/<feature>.ts` → the message queue (SQS; ElasticMQ locally). Each layer calls only the layer below. Procedures validate and call a service (no logic);
  services hold business logic (no HTTP, no SQL); queries are the ONLY code that touches a data store; queues are the ONLY code that touches the message queue (only services call either).
- No file suffixes like `.router` or `.service`: the folder names the layer.
- Web components never call tRPC directly; they use a hook from their feature.
- Web imports only `type AppRouter` from `@minitickets/api/router`, never runtime code.

## The most important rules from CLAUDE.md

- Build only what the current step asks for, then stop. Don't build ahead.
- Small files, one job each. No clever abstractions, no DI container.
- Add short numbered comments (1., 2., 3. …) that say WHAT each part does and WHY.
- No new libraries, data stores or Docker services unless the step asks for them. Ask the owner
  before any `pnpm add`.
- TypeScript strict; validate every external input (requests, env) with Zod. Shared input schemas
  live in `packages/shared`.
- UI changes: check them in a headless browser before you say "done". Say what was and wasn't
  checked.
- The environment's shape (`dataEnabled`, `computeEnabled`, `entryEnabled`, `cdnEnabled`,
  `domainName`) is the COMMITTED `infra/Pulumi.dev.yaml`. The deployed image tag lives in SSM
  `/minitickets/dev/image-tag`, written only by CD. Never put `apiImageTag`, `webImageTag` or
  `migrationImageTag` in that file.
- Leave `apps/web/AGENTS.md` alone: `next dev` generates it. It holds Next.js notes, not this
  project's rules.

## Agent permissions

- Claude Code sessions in this repo run without approval prompts (`bypassPermissions`).
- A guard hook (`.claude/hooks/guard-bash.sh`) checks every shell command first and blocks the
  risky ones listed under "SAFETY" below. Other agents are not behind that hook: follow the same
  list yourself.
- If a command is blocked (or would be), do NOT try to work around it: no other spelling, wrapper,
  script or tool that does the same thing. Continue without it and list it, with the exact command,
  under **"Manual steps for me"** in your report.

## SAFETY: hard rules

Claude Code enforces some of these through `.claude/settings.json`. You do not read that file, so
these are rules you follow yourself. No exceptions. If a task seems to need one of them, stop and
ask the owner.

**Processes**
- Never use `pkill`, `killall`, or kill anything by name or pattern: no `kill $(lsof …)`,
  `kill $(pgrep …)`, `xargs kill`.
- The owner's dev servers run on **:3000 (web)** and **:4000 (api)**. Never stop or restart them,
  and never start your own servers on those ports.
- For your own test servers use other ports (for example web :3101, api :4101; check they are
  free). Record the PID right after starting (`$!`) and stop only that PID with `kill <pid>`.

**Git**
- Never `git add`, `git commit`, `git push`, `git stash`, `git reset --hard`, `git push --force`,
  `git clean`, or anything else that stages, commits, or throws away work (`git checkout -- <file>`,
  `git restore`). The owner often has staged work in progress; leave it exactly as it is.
- Reading is fine: `git status`, `git diff`, `git log`, `git show`.

**Pulumi and AWS**
- Never `pulumi up`, `pulumi destroy`, `pulumi config set`, or any other command that changes the
  stack or its state (`refresh`, `import`, `state …`). The owner runs those, or CD does.
- `pulumi preview` is the only Pulumi command you run. `pulumi preview --config …` WRITES that
  config into `infra/Pulumi.dev.yaml`: ask first, back the file up, and restore it byte for byte.
- `aws` commands: read-only only (`describe-*`, `get-*`, `list-*`, `sts get-caller-identity`,
  `logs tail`). Never a command that creates, changes, or deletes anything.
- Credentials come from the environment: `export AWS_PROFILE=ticketlite` once per terminal. Never
  print credentials, tokens, secret values, or the contents of `.env` files.

**Docker**
- Never stop or restart Docker, and never touch other projects' containers. No `pnpm db:down`,
  `docker compose down / stop / restart`, `docker system prune`.
- `pnpm db:up` (start Postgres + Redis for this repo) is fine when they are not already running.

## Workflow

**Never commit.** At the end of every task, report:
1. A suggested commit message in the style of `git log` (`feat(events): …`, `feat(infra): …`,
   `feat(cd): …`, `docs(handbook): …`, `chore: …`).
2. The changed files, grouped (app code / tests / infra / docs).
3. A reading order for the owner: which file to read first, and why.
4. What you verified (commands and real results, such as test counts or preview +/− counts) and
   what you did not.

**Feature step:** code + tests + numbered comments. Do NOT edit the handbook, the step docs
(`docs/NN-*.md`, `docs/00-architecture.md`) or add `@concept` anchors. Instead append ONE entry
(about 10 lines) to `docs/handbook/PENDING.md`: step name, concepts, key files (path + function),
real measured numbers, anything you are unsure about. Copy the shape of the entries already there.

**TICKETING + SERVERLESS SERIES (F2a, F2b, S1-S4 in `docs/handbook/ROADMAP.md`):** do NOT update
the handbook, the infra guide or the explorer, not even in an infra step (the living guide rule
below is paused for the series). Record every concept, file and infra change (resources, IAM
permissions, security group rules, secrets, CD steps, real names) in `PENDING.md` instead; a
detailed guide + explorer update is done in one batch after the series. Still update the status in
`ROADMAP.md` every step (one or two lines). Each step's prompt is saved in
`docs/handbook/prompts/<step>.md`; `ROADMAP.md` links each "next" item to its prompt file.

**LIVING GUIDE RULE (the one exception):** a step that adds or changes infrastructure (a service, an
IAM role or permission, a security group rule, a secret, a route, a DNS record, a CD step) updates
`docs/handbook/guides/infra-build-along.md` AND `docs/handbook/guides/infra-explorer.html` in the
SAME step. `CLAUDE.md`, "Living guide rule", lists every part to update. Real IDs, names and values
only; if unsure about an AWS fact, say so in the text.

**Handbook catch-up:** only when the owner asks. Follow `CLAUDE.md` ("Workflow", "Docs rule",
"Living handbook rule"), then clear `PENDING.md`.

**Handbook changelog:** any change in `docs/handbook/` adds an entry at the top of
`docs/handbook/CHANGELOG.md`, as `CLAUDE.md` describes. No entry is needed (to avoid noise) when
the only handbook changes are: a `PENDING.md` append, a step's status line(s) in `ROADMAP.md`, or a
new prompt file in `docs/handbook/prompts/`.

## How to verify

```bash
pnpm run doctor   # the local stack: env files, containers, migrations, queues, table, ports
                  # (with "run": `pnpm doctor` is pnpm's own built-in and prints nothing)
pnpm typecheck    # tsc --noEmit in every package
pnpm lint         # ESLint
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright against the owner's running servers (http://localhost:3000)
                  # for your own servers: E2E_BASE_URL=http://localhost:3101 pnpm test:e2e
pnpm docs:check   # handbook and code agree
npx -y @mermaid-js/mermaid-cli -i <file>.md -o /tmp/out.md   # when a Mermaid diagram changed
cd infra && pulumi preview   # read-only; needs AWS_PROFILE=ticketlite
```

If the owner's servers are not running, say so. Do not start servers on :3000 or :4000.
