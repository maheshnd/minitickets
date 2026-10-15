# Worker image for AWS Lambda. Build it from the repo root: docker build -f apps/worker/Dockerfile .
#
# @concept: docker-multi-stage
# Stages (same idea as apps/api/Dockerfile):
#   base    -> Node + pnpm, to BUILD. Never shipped.
#   deps    -> the worker's dependencies installed (dev tools too: esbuild).
#   build   -> esbuild bundles everything into ONE file: dist/lambda.mjs.
#   runtime -> AWS's Lambda base image + that one file. Nothing else.

# 1. WHAT: the build stages start from the same Node image as the api (pinned to .nvmrc's version).
#    WHY: same Node and pnpm as the laptop and CI, and Docker reuses the api build's cached layers.
FROM node:24.13.0-slim AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app


# ---- Stage: deps ---------------------------------------------------------------------------
FROM base AS deps

# @concept: docker-layer-caching
# 2. WHAT: copy only the files that decide which packages to install, then install the worker and
#    the packages it depends on (`--filter @minitickets/worker...`), exactly as the lockfile says.
#    WHY: this slow layer is reused until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @minitickets/worker...


# ---- Stage: build --------------------------------------------------------------------------
FROM deps AS build

# 3. WHAT: copy the worker's and the shared package's source, then bundle (apps/worker/build.mjs).
#    WHY: the result, dist/lambda.mjs, holds our code AND every library it uses, so the final image
#    needs no node_modules and no pnpm.
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages/shared packages/shared
RUN pnpm --filter @minitickets/worker build


# ---- Stage: runtime (the final image) ------------------------------------------------------
# @concept: aws-lambda
# 4. WHAT: AWS's official base image for Lambda's Node.js 24 runtime ("nodejs24.x").
#    WHY this one: a CONTAINER-IMAGE Lambda must contain Lambda's "runtime interface client" (the
#      small program that fetches events from the Lambda service and calls our handler). AWS's base
#      images have it built in, plus a local emulator for testing (see PENDING.md, S1c).
#    WHY Node 24: .nvmrc says 24.13.0, and Lambda's newest Node runtime is 24 (Node 24.21.0 inside
#      the image when this was written). Same MAJOR version = same language features and APIs. Lambda
#      does not let us pick the minor/patch: AWS patches it, which is also the point (security fixes).
#    WHY the tag "24" (not a digest): AWS rebuilds this tag with security patches; every publish
#      (cd.yml) takes the current one. The pushed image itself never changes afterwards (immutable
#      tag), so a deploy still runs exactly the bytes CI built.
#    ARCHITECTURE: built with --platform linux/arm64 (cd.yml, scripts/push-images.sh) to match the
#      Lambda's "arm64" (Graviton) setting, infra/src/jobs/worker-lambda.ts. A mismatch fails at
#      start with "exec format error".
FROM public.ecr.aws/lambda/nodejs:24 AS runtime

# 5. WHAT: our one file goes into LAMBDA_TASK_ROOT (/var/task), where the runtime looks for handlers.
#    WHY no USER line: Lambda runs the function as its own unprivileged user anyway, on a read-only
#      file system (only /tmp is writable). Nothing here needs root at runtime.
COPY --from=build /app/apps/worker/dist/lambda.mjs ${LAMBDA_TASK_ROOT}/

# 6. WHAT: the handler: file "lambda" (lambda.mjs), exported function "handler".
#    WHY CMD and not ENTRYPOINT: the base image's ENTRYPOINT starts the runtime client, which reads
#      the handler name from CMD. (A Lambda's ImageConfig can override it; ours does not.)
CMD ["lambda.handler"]
