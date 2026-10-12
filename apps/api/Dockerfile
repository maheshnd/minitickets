# API image. Build it from the repo root: docker build -f apps/api/Dockerfile .
#
# Stages (each starts with FROM; later stages copy only what they need from earlier ones):
#   base    -> Node + pnpm. A shared starting point, produces no files of its own.
#   deps    -> ALL dependencies installed (dev tools too). Produces node_modules for the build.
#   build   -> runs esbuild. Produces dist/server.js and dist/migrate.js (plain JavaScript).
#   prod    -> ONLY production dependencies. Produces a small node_modules for runtime.
#   runtime -> the final image. dist/ + prod node_modules + SQL migrations. Nothing else.
# Only the last stage becomes the image we run. The others are thrown away, which is why it is small.

# 1. WHAT: start from the official Node image, the "slim" (Debian) variant, pinned to an exact version.
#    WHY: the version matches .nvmrc (24.13.0), so laptop, CI and production run the same Node.
#    "slim" has Node and little else (small), and it is glibc-based, which the prebuilt
#    @node-rs/argon2 binary needs (Alpine uses musl and is a common source of native-package trouble).
FROM node:24.13.0-slim AS base

# 2. WHAT: turn on corepack and activate the pnpm version written in the root package.json.
#    WHY: the image needs pnpm to install packages. Using the same version as the repo keeps
#    the lockfile result identical to the one on a laptop. It is here, in base, so every
#    stage below gets pnpm and Docker caches this slow step once.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# 3. WHAT: set the folder where the next instructions run (created if missing).
#    WHY: a fixed folder keeps paths short and the same in every stage.
WORKDIR /app


# ---- Stage: deps ---------------------------------------------------------------------------
FROM base AS deps

# 4. WHAT: copy ONLY the files that decide which packages to install: the lockfile,
#    the workspace file and the package.json of every workspace package.
#    WHY (layer caching): Docker caches each instruction as a layer and reuses it if its input
#    did not change. If we copied all the source code first, every code edit would change the
#    input and force a full re-install. The package files change rarely, so the slow install
#    layer below is reused on almost every build.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

# 5. WHAT: install the API's dependencies (dev ones included, we need esbuild) exactly as the lockfile says.
#    `--filter @minitickets/api...` means "the api and the packages it depends on", so the web
#    app's packages are skipped. --frozen-lockfile fails if the lockfile and package.json disagree.
#    WHY: the cache mount keeps pnpm's download store between builds, so even when the package
#    files change, packages already downloaded are not downloaded again. The mount is not part
#    of the image, so it adds no size.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @minitickets/api...


# ---- Stage: build --------------------------------------------------------------------------
FROM deps AS build

# 6. WHAT: copy the source code of the API and of the shared package, plus tsconfig.base.json
#    (every package's tsconfig.json extends it).
#    WHY: only now, AFTER the install, so editing code does not invalidate the install layer above.
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared

# 7. WHAT: bundle the TypeScript into dist/ with esbuild (see apps/api/build.mjs).
#    WHY: production should run compiled JavaScript with `node`, not TypeScript with `tsx`.
#    @minitickets/shared is raw TypeScript, so it is compiled into the bundle here.
RUN pnpm --filter @minitickets/api build


# ---- Stage: prod ---------------------------------------------------------------------------
FROM deps AS prod

# 8. WHAT: copy the source (pnpm deploy needs the workspace package folders to exist).
#    WHY: this stage starts from `deps`, which only has package.json files.
COPY apps/api apps/api
COPY packages/shared packages/shared

# 9. WHAT: create /prod/api holding the API's package.json plus node_modules with ONLY production
#    dependencies. `--legacy` is needed by pnpm 10 for a workspace that does not use injected packages.
#    WHY: the final image must not contain esbuild, tsx, drizzle-kit, TypeScript and so on.
#    They are only needed to build, and every extra package is size and attack surface.
RUN pnpm --filter @minitickets/api --prod deploy --legacy /prod/api


# ---- Stage: runtime (the final image) ------------------------------------------------------
FROM node:24.13.0-slim AS runtime

# 10. WHAT: set the working folder of the final image.
#     WHY: the migrate command finds ./drizzle relative to this folder.
WORKDIR /app

# 11. WHAT: production mode, listen on all network addresses, default port.
#     WHY: NODE_ENV=production makes libraries faster and turns on the Secure cookie flag in our code.
#     HOST=0.0.0.0 is needed because with the default 127.0.0.1 only the container itself could
#     connect, so the published port would never reach the API.
#     These are not secrets. Passwords (DATABASE_URL, ...) are given when the container runs.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

# @concept: tls-in-transit
# 11b. WHAT: download AWS's RDS certificate bundle (the certificate authorities, CAs, that sign
#      every RDS database certificate, in all regions) and tell Node to trust it as well.
#      WHY: on AWS the API connects to RDS with SSL and VERIFIES the certificate (see
#      src/config/database.ts). Node only trusts the well-known public CAs, and the RDS CA is
#      not one of them, so without this file the check fails with "self-signed certificate in
#      certificate chain". The fix is to trust AWS's CA, NEVER to turn the check off.
#      NODE_EXTRA_CA_CERTS ADDS these CAs to Node's normal list (public sites still work).
#      --chmod=644: files downloaded by ADD are readable only by root by default, and the app
#      runs as the "node" user (step 15). The target folder /usr/local/share already exists:
#      ADD would create a missing folder with the same 644 mode, and nobody could open it.
#      It is harmless locally: the local Postgres uses no SSL, so these CAs are never used there.
#      Docker checks the URL on every build, so a new bundle from AWS lands in the next image.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem

# 12. WHAT: copy the production-only package.json and node_modules from the prod stage.
#     WHY: package.json has "type": "module", which Node needs to run our ES module output.
#     --chown is not needed: the app only READS these files, so root ownership is safer
#     (a hacked app cannot rewrite its own code).
COPY --from=prod /prod/api/package.json ./package.json
COPY --from=prod /prod/api/node_modules ./node_modules

# 13. WHAT: copy the compiled JavaScript from the build stage.
#     WHY: this is the program itself. It is copied after node_modules because code changes
#     more often than dependencies, so the node_modules layer stays cached.
COPY --from=build /app/apps/api/dist ./dist

# 14. WHAT: copy the SQL migration files.
#     WHY: `node dist/migrate.js` reads them. They are in the same image so the code and the
#     database changes it needs always travel together.
COPY apps/api/drizzle ./drizzle

# 15. WHAT: switch from root to the "node" user (already in the official image, uid 1000).
#     WHY: if someone breaks into the app, they get a user that cannot change the system or
#     install tools, instead of root inside the container.
USER node

# 16. WHAT: document that the API listens on port 4000.
#     WHY: it does not open the port by itself; it tells people and tools which port to publish
#     (docker-compose.yml does that with `ports`).
EXPOSE 4000

# 17. WHAT: start the server by running node directly, in "exec form" (a JSON list).
#     WHY: with this form node is PID 1, the process Docker sends signals to. `docker stop`
#     sends SIGTERM straight to node, so our graceful shutdown in server.ts runs. With
#     `pnpm start` or the string form (CMD node ...), a shell or pnpm would be PID 1 and
#     would not pass SIGTERM on, so Docker would wait 10 seconds and then kill the app.
CMD ["node", "dist/server.js"]
