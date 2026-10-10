# Step 11: Dockerfiles for the API and the web app

Until now the app ran on your laptop with `pnpm dev`. This step packs each app into a Docker
**image**: a sealed bundle with the app, the exact Node version and the packages it needs. A
running copy of an image is a **container**. If it runs in a container on your laptop, it runs the
same way on a server.

Nothing is deployed yet. We only build the images and run the whole app in containers locally.

## What was added

| File                         | Job                                                              |
| ---------------------------- | ---------------------------------------------------------------- |
| `apps/api/Dockerfile`        | Recipe for the API image                                         |
| `apps/web/Dockerfile`        | Recipe for the web image                                         |
| `.dockerignore`              | Files that are never sent to Docker                              |
| `apps/api/build.mjs`         | Bundles the API into plain JavaScript with esbuild               |
| `apps/api/src/db/migrate.ts` | Applies the SQL migrations (run as a separate container)         |
| `docker-compose.yml`         | New services `migrate`, `api`, `web` (profile `app`)             |
| `.github/workflows/ci.yml`   | New job `docker` that builds both images                         |

Two small code changes: the API got a `HOST` setting (explained below), and `next.config.ts`
got `output: "standalone"`.

## The API Dockerfile, stage by stage

A **multi-stage build** has several `FROM` lines. Each is a separate stage with its own files.

1. **base**: Node 24.13.0 "slim" (the version in `.nvmrc`) plus pnpm.
2. **deps**: copies the lockfile and the `package.json` files, then runs `pnpm install`.
3. **build**: copies the source code and runs esbuild. Result: `dist/server.js` and `dist/migrate.js`.
4. **prod**: runs `pnpm deploy --prod`, which makes a `node_modules` with only production packages.
5. **runtime**: starts again from a clean Node image and copies in only `dist/`, the production
   `node_modules` and the SQL files. This is the image we run.

### Multi-stage builds and why images get smaller

Everything a stage creates stays in that stage. The final image contains only what we `COPY --from`
another stage. TypeScript, esbuild, tsx, drizzle-kit, the source code and the pnpm download cache
are used while building, then left behind. Fewer files means a smaller image, faster downloads and
less to attack.

(Both images are still a few hundred MB. Most of that is the Node base image itself.)

### Layer caching and why COPY order matters

Every instruction creates a **layer**. Docker keeps layers and reuses one if the instruction and
its input files are unchanged. The first changed layer, and every layer after it, is rebuilt.

That is why we copy `package.json` and the lockfile first, run the slow `pnpm install`, and copy
the source code later. A code edit then only rebuilds layers after the install. The install layer
comes from the cache and the build takes seconds. If we copied everything first, each code edit
would reinstall every package. The same idea explains the runtime stage: `node_modules` is copied
before `dist/`, because code changes more often than dependencies.

The pnpm download store is also kept in a **cache mount**. Even when the install does have to run
again, packages already downloaded are not downloaded again.

### Why compiled JavaScript instead of tsx

`tsx` turns TypeScript into JavaScript every time the app starts, in memory. That is fine for
development, but in production it means a slower start, more memory, and shipping TypeScript and
dev tools in the image. Instead we compile once, at build time, with esbuild. Production runs
plain JavaScript with plain `node`.

`@minitickets/shared` is raw TypeScript, so Node cannot load it. esbuild compiles it into the
bundle. All other packages stay as normal `node_modules` (`build.mjs` lists them as external).
That is required for `@node-rs/argon2`, which contains a native binary that cannot be bundled.

### Why non-root

By default a container process is root. If an attacker finds a bug in the app, root inside the
container is worth much more to them than a normal user. The official Node image already has a
user called `node`, and `USER node` switches to it. The app files stay owned by root, so even
the app itself cannot change its own code. Check it: `docker compose exec api whoami` prints `node`.

### Why `node` as PID 1 receives SIGTERM

The first process in a container is PID 1. `docker stop` sends the signal SIGTERM to PID 1 and,
after 10 seconds, kills it with SIGKILL. Our `server.ts` handles SIGTERM: it finishes running
requests and closes the database and Redis.

`CMD ["node", "dist/server.js"]` (the "exec form", a JSON list) makes node itself PID 1, so it
gets SIGTERM directly. If we used `pnpm start`, or the string form `CMD node dist/server.js`, a
shell or pnpm would be PID 1, and they do not pass the signal on. The graceful shutdown would
never run and Docker would kill the app after 10 seconds. Try it: `docker compose stop api` takes
a fraction of a second and the log shows `shutting down` then `shutdown complete`.

### The HOST setting

By default the API listened only on `127.0.0.1`. Inside a container that means "only the container
itself". The published port would reach nothing. So the API reads a new `HOST` variable: the default
stays `127.0.0.1` for local development, and the image sets `HOST=0.0.0.0` (all addresses).

### Why migrations are a separate step

If the API ran migrations when it starts, then three API containers starting together would run
the same migration three times at once, and they could collide. A migration is also a different
job: it must run once per release, change the database, and then finish. So it is its own
container, the `migrate` service. It uses the **same image** as the API, so the code and the SQL
files always match. The image gets a different command: `node dist/migrate.js`. Compose makes the
API wait until `migrate` finished successfully. If a migration fails, the API does not start.

The runner is `src/db/migrate.ts`, not `drizzle-kit`, because `drizzle-kit` is a dev tool and is
not in the production image. It uses the same Drizzle migration table, so both ways are
compatible.

## The web Dockerfile, stage by stage

1. **base**: same as the API.
2. **deps**: copy the package files, install the web app's dependencies.
3. **build**: set `NEXT_PUBLIC_API_URL`, copy the sources, run `next build`.
4. **runtime**: copy only the standalone server, the static files and `public/`, then `node server.js`.

### Next.js standalone output

With `output: "standalone"`, `next build` follows the imports and writes `.next/standalone`: a
`server.js` plus only the few `node_modules` files the app really uses. It does not need the full
`next` package or the dev dependencies. Two things are not copied automatically, so the Dockerfile
copies them: `.next/static` (the browser JavaScript and CSS) and `public/` (we have none yet, the
`public*` wildcard makes that copy harmless).

In a monorepo the app also uses files outside `apps/web` (`packages/shared`, the root
`node_modules`). `outputFileTracingRoot` points Next at the repo root so it finds them. This is also
why `server.js` ends up in `apps/web/server.js` inside the standalone folder, and why the Dockerfile
sets `WORKDIR /app/apps/web` before `node server.js`.

`HOSTNAME=0.0.0.0` has the same reason as `HOST` above.

### Build once, run anywhere

The idea: build the image one time, then run that exact image on your laptop, in CI or on a server.
Nothing is installed or compiled on the server, so there is no "works on my machine".

For the API this is fully true. The settings (`DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`) are given
when the container runs, so one image works in every environment. **No secrets are in the image.**
`.dockerignore` keeps every `.env` file out, and passwords only enter through `environment:` in
compose.

The web app is the honest exception. Next.js copies `NEXT_PUBLIC_API_URL` into the browser
JavaScript during `next build`. So it is a build argument, and the image only works with the API
address it was built with. For now we need one web image per environment. (We will revisit this
for AWS, for example by having the browser ask the server for its settings at runtime.)

## Running it: `pnpm app:up`

The script is `docker compose --profile app up -d --build --wait`. In order:

1. **Build.** `--build` builds the `minitickets-api` and `minitickets-web` images. (`migrate`
   uses the API image.) Unchanged layers come from the cache.
2. **Postgres and Redis.** They are already running from `pnpm db:up`, or start now. Compose waits
   until their healthchecks pass.
3. **migrate** starts, applies the SQL files to Postgres and exits with code 0.
4. **api** starts only after migrate succeeded and Redis is healthy. Its healthcheck calls `/health`.
5. **web** starts after the API is healthy.
6. `--wait` returns when everything that should keep running is healthy.

Then open http://localhost:3100. The ports are 3100 (web) and 4100 (api), so the stack can run
next to `pnpm dev` (3000 and 4000). `WEB_ORIGIN` is `http://localhost:3100` and
`NEXT_PUBLIC_API_URL` is `http://localhost:4100`: both are the addresses the **browser** uses.
Inside the compose network the containers find each other by service name (`postgres`, `redis`).

`pnpm app:down` stops and removes `api`, `web` and `migrate`. Postgres and Redis keep running.

To run the end-to-end tests against the containers:

```bash
E2E_BASE_URL=http://localhost:3100 pnpm test:e2e
```

## CI

The new `docker` job runs after `quality`. It builds both images with Buildx and does not push.
Layers are stored in the GitHub Actions cache, so later runs are faster.
