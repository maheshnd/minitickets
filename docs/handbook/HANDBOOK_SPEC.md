# Handbook spec: interview-ready docs tied to our code

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

GOAL
Build docs/handbook/: a living handbook that explains every concept in
MiniTickets (app + AWS) so I can give real senior/lead interview answers
based on code I built, not buzzwords. It must stay accurate and grow as we
add features. Do not change app or infra behaviour.

AUDIENCE
Me: an experienced full-stack engineer who knows the names of most things
but not always the depth. Write so I can PICTURE each concept, find it in
our code, and explain it at simple, senior and lead level.

────────────────────────────────────────
ACCURACY RULES (most important)
- Before writing about anything, READ the real code. Use real names,
  values, ports, settings.
- Reference code as: file path + function/symbol name (never line numbers).
- Every claim about "our app" must exist in the code. Anything we don't
  have is labelled: "Not in our app yet (planned)" or "Explain-only".
- If unsure about an AWS or library fact, say so. Never guess.
- Never invent metrics or numbers we haven't measured.

WRITING RULES
- Simple English, short sentences. Define every technical word the first
  time it appears and add it to glossary.md.
- A real-life comparison for each major concept.
- A Mermaid diagram for each concept/chapter (max ~8 boxes; several small
  diagrams beat one big one). Validate all diagrams with mermaid-cli.
- Every buzzword must be tied to a concrete mechanism in our code or
  labelled not built.
- Prefer "here is what happens, step by step" over definitions alone.

────────────────────────────────────────
CODE ANCHORS
- Add comment tags at the exact place a concept lives in code:
    // @concept: <slug>        (TS/JS)
    # @concept: <slug>         (Dockerfile, YAML, shell)
  Only add comments; never change behaviour.
- One concept can have several anchors (e.g. graceful-shutdown in
  server.ts AND the Dockerfile CMD).
- scripts/check-concepts.ts + root script "docs:check":
  - every anchor slug has a card in concepts/
  - every card's "Where in our code" anchors exist in the code
  - concept-map.md lists every card
  Fails with a clear message. Add it to the CI quality job.

────────────────────────────────────────
FILES AND WHAT EACH CONTAINS

README.md
- What the handbook is, how to use it, reading paths:
  "first full read", "1 hour before an interview", "system design round",
  "security round", "AWS round", "frontend round".

concept-map.md (the hub)
- Table grouped by area (Frontend, API, Data, Auth & Security,
  Performance & Caching, Async & Events, Reliability, DevOps & CI/CD,
  AWS Network, AWS Compute, AWS Data, Observability, Testing):
  concept | status (✅ built / 🟡 partial / 📋 planned / 📖 explain-only)
  | where in our code | card link
- Include planned/explain-only topics a senior backend interview covers,
  using docs/handbook/reference-topics.md as a checklist (I will add my
  notes there; it is an example list, not complete). Add other important
  topics you know are missing.

00-big-picture.md
- One diagram of the whole system today (app + AWS), planned parts marked.
- The life of one request in ~10 lines.
- Life of a login request as a sequence diagram naming every component.

aws-foundations.md
- Regions, AZs, accounts, ARNs (how to read one).
- The 3 separate questions for any connection, as a table:
  REACH (network: subnets, routes, security groups),
  ALLOWED (IAM), PASSWORD (credentials inside the service).
  Show API -> RDS answering all three.
- IAM: principal, action, resource, condition; identity vs resource
  policies; default deny, allow, explicit deny wins.
- Roles: trust policy (who can wear it) vs permission policy (what it can
  do) vs where it is attached; STS temporary credentials; confused deputy.
- How one AWS service calls another (ECS -> STS -> Secrets Manager),
  sequence diagram.
- Service-linked roles.
- Debugging checklist: reach -> allowed -> password.

infra-story.md
- Chapters in the order a request meets each resource:
  CloudFront -> ALB (security group, listener, rules, secret header) ->
  target groups -> ECS (cluster, service, task definition, task, Spot) ->
  IAM roles -> Secrets Manager -> RDS -> ElastiCache Valkey -> CloudWatch,
  then the ground: VPC, subnets, route tables, IGW, security groups, ECR,
  budget, Pulumi switches.
- Then: deploy story, security story (every defense layer + the attack it
  stops), cost story, "what we'd change for production".

app-story.md
- Chapters in the order a request travels through OUR code:
  browser -> Next.js (layout, server vs client components, proxy guard)
  -> TanStack Query (cache, retries, invalidation) -> tRPC client ->
  Fastify (CORS, trustProxy, cookie) -> tRPC context -> middleware
  (errorMapper, protectedProcedure) -> procedure -> service -> query ->
  Postgres / Redis -> error path back to the UI.
- Then: monorepo + shared types, validation at boundaries, testing
  pyramid (unit / e2e), Docker, CI.

STRUCTURE OF EVERY CHAPTER AND EVERY CONCEPT CARD (same headings always)
1. In one line
2. Real-life comparison
3. Picture it (diagram)
4. Where in our code (anchors: file + symbol) and what the code does,
   step by step
5. See it yourself (a command, test, curl, or DevTools step that shows
   it working, and one way to break it on purpose)
6. How it connects (uses <- / gives ->, links to other cards)
7. Our settings and WHY
8. Trade-offs: pros / cons
9. Alternatives and when to choose them
10. What breaks / failure modes, and how we'd notice
11. Reach / Allowed / Password (AWS resources only)
12. Cost (AWS resources only, our numbers)
13. Interview answers at 3 levels:
    - Simple (what it is)
    - Senior (how it works + trade-offs, using our code as the example)
    - Lead (design choices, failure modes, scale, cost, team impact)
14. Follow-up questions interviewers ask (with short answers)
15. Say it in 30 seconds
16. Status + "to make it production-grade" (if partial)
    Cards only: then an unnumbered last heading "Where it appears in the story" (links to the
    chapter(s) that cover the concept).

concepts/<slug>.md
- One card per concept, same 16 headings (skip ones that truly don't
  apply). Planned/explain-only cards keep sections 4-5 as
  "Not in our app yet" + what we would build and where.

decisions/NNNN-<title>.md (Architecture Decision Records)
- Context, options considered, decision, consequences, when we'd revisit.
- Write ADRs for decisions already made, e.g.: monorepo + tRPC,
  layered API, sessions in Redis vs JWT, argon2id, unique constraint vs
  check-then-insert, no mutation retries, same-origin routing,
  Pulumi, Fargate Spot vs EC2/EKS, no NAT gateway, single-AZ RDS in dev,
  RDS-managed password, CloudFront for HTTPS, trustProxy hops, on/off
  cost switches.

system-design.md
- 8-12 classic questions answered using our app as the base, e.g.:
  "scale login to 1M users", "zero-downtime deploys", "secure the API",
  "handle a traffic spike", "add caching", "add background jobs",
  "make it multi-region", "reduce cost".
  Each: current state (with links) -> bottlenecks -> design -> trade-offs
  -> what we'd measure.

guides/<name>.md (and guides/infra-explorer.html)
- Teaching guides: one topic from zero, in the order a newcomer needs it. Today:
  guides/cicd-story.md (from git push to the new version on AWS) and guides/infra-build-along.md
  + guides/infra-explorer.html (our AWS setup, built one piece at a time as a growing city map).
- Same accuracy and writing rules as every other page; history line under the title.

interview-drills.md
- Question bank grouped by round (frontend, backend, security, AWS,
  DevOps, system design), each linking to its card. Mark which ones I can
  answer from built code.

glossary.md
- Every technical word used anywhere in the handbook.

────────────────────────────────────────
PHASES (do ONLY the phase I ask for; commit at the end of each)

Phase 1: Skeleton + foundations
- README.md, concept-map.md (full table, statuses), 00-big-picture.md,
  aws-foundations.md, glossary.md (start), reference-topics.md (empty
  placeholder for my notes if missing), check script + CI step.
- Commit: "docs(handbook): skeleton, concept map, aws foundations"

Phase 2: infra-story.md + cards and anchors for all ✅ AWS concepts.
- Commit: "docs(handbook): infra story + aws cards"

Phase 3: app-story.md + cards and anchors for all ✅ app concepts.
- Commit: "docs(handbook): app story + app cards"

Phase 4: decisions/ (ADRs) + system-design.md.
- Commit: "docs(handbook): decisions + system design"

Phase 5: cards for 📋 planned and 📖 explain-only topics, and
interview-drills.md.
- Commit: "docs(handbook): planned topics + drills"

At the end of EVERY phase report:
- files created/changed, anchors added (file + slug)
- pnpm docs:check result, Mermaid validation result
- facts you were unsure about
- typecheck, lint and tests still pass (anchors are comments only)

────────────────────────────────────────
LIVING HANDBOOK RULE (add to CLAUDE.md in Phase 1)
For every future feature or infra step, in the SAME commit:
- add @concept anchors to the new code
- add or update the concept cards (status 📋 -> 🟡 -> ✅)
- update concept-map.md, the relevant story chapter, 00-big-picture.md
- add an ADR if a design decision was made
- add new words to glossary.md
- every concept card has a "Where it appears in the story" heading linking the exact chapter(s)
  in app-story.md / infra-story.md / 00-big-picture.md
- pnpm docs:check must pass

STORY PLACEMENT RULES (enforced by docs:check)
- New features go where a request meets them: in the chapter for that stop of the journey.
- Things off the main path (background jobs, webhooks, queues) become a "side path" chapter right
  after the step where they branch, with a diagram of the branch point.
- Never add a standalone REQUEST-PATH story file: features go into app-story.md / infra-story.md
  (and 00-big-picture.md).
- Teaching GUIDES are allowed, but only under docs/handbook/guides/. A guide teaches one topic from
  zero in its own order (build order, or push-to-production order), for a reader who does not know
  the topic yet. Every guide is linked from README.md. Guides link to cards; cards keep linking to
  the stories (a guide is not a "story chapter" for the placement check).
- docs:check fails if: a "*-story.md" file other than app-story.md / infra-story.md sits in
  docs/handbook/ (move it to guides/); a guide is not linked from README.md; a relative link in a
  guide points to a file that does not exist; the explorer's code references point to a missing
  file or a symbol that is not in that file; the explorer's chapter titles do not match the
  guide's chapter headings.
- docs:check fails if: a ✅ or 🟡 card is not linked from at least one story chapter (no orphan
  cards); a card's "Where it appears in the story" link points to a missing chapter or to a chapter
  that does not link back; a story links to a missing card; a ✅ AWS card is missing from the
  "Components" table in 00-big-picture.md.

LIVING GUIDE RULE (infra guide + explorer; also in CLAUDE.md)
- guides/infra-build-along.md (the guide) and guides/infra-explorer.html (the explorer, one
  self-contained HTML file whose map is drawn from ONE JSON block inside it) teach our AWS setup as
  one city that grows chapter by chapter.
- Whenever a step adds or changes infrastructure (a service, an IAM role or permission, a security
  group rule, a secret, a route, a DNS record, a CD step), update the guide AND the explorer in the
  SAME step. This is the one exception to the "batch docs later" workflow. Update: the right
  chapter; its city story; for IAM the WHO / WHAT / ATTACHED picture (trust policy, permission
  policy, where it is attached), marking what is new and why only that permission; the
  who-talks-to-whom chain; the Code -> Console -> CLI rows; "what breaks without it" as Reach /
  Allowed / Password; the growing diagram; the "Map so far" diagram; the poster; and the explorer's
  JSON (components, connections with what allows each one, the chapter summary).
- Every chapter of the guide has the same 13 sections: Last time + the problem; In the city; The
  picture; How it really works; Our code; How it connects; Code -> Console -> CLI; Console mission;
  Follow one thing; When it breaks; The small details; Interview; Check yourself + cliffhanger.
