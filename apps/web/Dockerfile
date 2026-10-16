# Web image. Build it from the repo root:
#   docker build -f apps/web/Dockerfile .                      (AWS: same-origin, no API URL inside)
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:4100 .   (docker compose)
#
# @concept: docker-multi-stage
# Stages (only the last one becomes the image we run):
#   base    -> Node + pnpm. A shared starting point, produces no files of its own.
#   deps    -> ALL dependencies installed. Produces node_modules for the build.
#   build   -> runs `next build`. Produces .next/standalone (a tiny self-contained server).
#   runtime -> the final image. Only the standalone server, the static files and public/.

# 1. WHAT: official Node "slim" image, pinned to the exact version in .nvmrc.
#    WHY: keep the laptop/CI build toolchain; runtime gets newer patches within Node 24. Slim keeps it small.
FROM node:24.13.0-slim AS base

# 2. WHAT: enable corepack and activate the pnpm version from the root package.json.
#    WHY: the build stages need pnpm, and the same version as the repo gives the same install.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# 3. WHAT: set the folder where the next instructions run.
#    WHY: a fixed folder keeps paths the same in every stage.
WORKDIR /app


# ---- Stage: deps ---------------------------------------------------------------------------
FROM base AS deps

# @concept: docker-layer-caching
# 4. WHAT: copy only the files that decide which packages to install.
#    WHY (layer caching): the install below is slow. Docker reuses a layer when its input is
#    unchanged. Package files change rarely; source code changes all the time. Copying only
#    the package files first means a code edit does not repeat the install.
#    The web app imports TYPES from the API (type AppRouter), so the api package.json is needed too.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

# 5. WHAT: install the web app's dependencies and those of the packages it needs, exactly as in the lockfile.
#    WHY: --frozen-lockfile fails if the lockfile is out of date, so the image can never get
#    different versions than CI tested. The cache mount keeps pnpm's download store between
#    builds (it is not part of the image, so it adds no size).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @minitickets/web...


# ---- Stage: build --------------------------------------------------------------------------
FROM deps AS build

# @concept: twelve-factor-config
# 6. WHAT: declare a build argument and turn it into an environment variable.
#    WHY: Next.js copies NEXT_PUBLIC_* values INTO the JavaScript sent to browsers while it
#    builds. The value must therefore exist at BUILD time, and changing it later means a new
#    image. It is a public address, not a secret.
#    The default is EMPTY on purpose: empty means "call /trpc on the same origin as the page".
#    On AWS a load balancer routes /trpc/* to the api (Step 11f), so no address is baked in
#    and one image works everywhere. docker compose still passes the localhost URL.
ARG NEXT_PUBLIC_API_URL=""
# 6b. WHAT: the ENV line below copies the ARG into an environment variable.
#     WHY: `next build` reads environment variables, not build arguments.
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# 7. WHAT: copy the sources, plus tsconfig.base.json (every package's tsconfig.json extends it).
#    Next needs the API source too, only for its TypeScript types.
#    WHY: after the install, so editing code does not invalidate the install layer above.
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY apps/api apps/api
COPY packages/shared packages/shared

# 8. WHAT: build the web app. next.config.ts has output: "standalone", so this also writes .next/standalone.
#    WHY: standalone traces which files the app really uses and copies only those (with the few
#    node_modules packages it needs) into one folder, instead of shipping the whole node_modules.
RUN pnpm --filter @minitickets/web build


# ---- Stage: runtime (the final image) ------------------------------------------------------
# 8b. WHAT: pin the patched Node 24 runtime without changing the Debian Bookworm base distribution.
#     WHY: the standalone server gets security fixes while the build toolchain stays unchanged.
FROM node:24.22.0-bookworm-slim AS runtime

# 8c. WHAT: apply Debian's Perl security update, then remove package managers and their shims.
#     WHY: the latest Node base still has old Perl; standalone needs only node, not installers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade perl-base \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

# 9. WHAT: set the working folder of the final image.
#    WHY: the standalone output keeps the monorepo layout, so the server ends up in /app/apps/web.
WORKDIR /app

# 10. WHAT: production mode, listen on all addresses, port 3000, no telemetry.
#     WHY: HOSTNAME=0.0.0.0 is needed or Next only listens inside the container and the
#     published port cannot reach it. These are not secrets.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# 11. WHAT: copy the standalone server (server.js plus the few node_modules it needs).
#     WHY: this is the whole app logic. It does NOT include static files, see the next step.
COPY --from=build /app/apps/web/.next/standalone ./

# 12. WHAT: copy the built static files (JavaScript and CSS for the browser).
#     WHY: standalone leaves them out on purpose (they are meant for a CDN). Without them the
#     page loads without styles or scripts.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# 13. WHAT: copy the public/ folder if the app has one (images, favicon, ...).
#     WHY: standalone leaves it out too. The `*` makes the copy a no-op when the folder does not exist yet.
COPY --from=build /app/apps/web/public* ./apps/web/public/

# 14. WHAT: move into the folder that holds server.js.
#     WHY: so the start command can simply be `node server.js`.
WORKDIR /app/apps/web

# @concept: container-hardening
# 15. WHAT: switch from root to the "node" user (already in the official image).
#     WHY: if someone breaks into the app, they cannot change the system. The files stay
#     owned by root and are only readable, so the app cannot rewrite its own code either.
USER node

# 16. WHAT: document that the web server listens on port 3000.
#     WHY: it only informs people and tools; docker-compose.yml's `ports` really publishes it.
EXPOSE 3000

# @concept: graceful-shutdown
# 17. WHAT: start the standalone server with node directly, in "exec form".
#     WHY: node becomes PID 1, so `docker stop` delivers SIGTERM straight to it and it exits
#     at once. Through pnpm or a shell, the signal would not arrive.
CMD ["node", "server.js"]
