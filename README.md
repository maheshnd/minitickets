# minitickets

A small learning project: a Next.js web app talking to a Fastify + tRPC API, with
fully shared types, in a pnpm monorepo.

## Quick start

Requires Node 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install

# Local settings (defaults work as-is)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm dev
```

- Web: http://localhost:3000 shows an input box and "Hello, <name>" from the API.
- API health check: http://localhost:4000/health returns `{ "status": "ok" }`.

## Scripts (run from the repo root)

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm dev`       | Runs `dev` in `apps/web` and `apps/api` in parallel     |
| `pnpm typecheck` | Runs `tsc --noEmit` in every package                    |
| `pnpm lint`      | Runs ESLint on every package                            |
| `pnpm test`      | Runs the unit tests (Vitest)                            |

## Folders

```
apps/web         Next.js frontend (App Router, Tailwind)
apps/api         Fastify + tRPC backend
packages/shared  Zod schemas and types shared by both apps
docs/            Step-by-step explanations
```

## Docs

1. [docs/01-setup.md](docs/01-setup.md): how a request travels from the input box to the API and back,
   and how the API's types reach the web app.
- [docs/handbook/cicd-story.md](docs/handbook/cicd-story.md): the CI/CD story for beginners. What
  happens between `git push` and the new version running on AWS, and how to read `ci.yml` and
  `cd.yml` (GitHub Actions, bash and Pulumi explained from zero).

## Notes

- `pnpm install` may warn "Ignored build scripts: esbuild". That's safe to ignore:
  esbuild (used by `tsx`) ships a prebuilt binary and works without its install script.
- `apps/web/AGENTS.md` is generated automatically by `next dev`.
