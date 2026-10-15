#!/usr/bin/env bash
# Builds the api, web and worker images for ARM64 and pushes them to ECR.
# Run from anywhere:  pnpm images:push   (export AWS_PROFILE=ticketlite first)
# Since Step 12b CD does this on every push to main (.github/workflows/cd.yml, job publish);
# this script is for manual / emergency pushes.
# Explained in docs/16-infra-ecr.md.

# 1. WHAT: stop at the first error, on unset variables, and in failed pipes.
#    WHY: a half-finished push must never look like a success.
set -euo pipefail

# 2. WHAT: work from the repo root, wherever the script was started.
#    WHY: the Dockerfiles are built with the repo root as context.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 3. WHAT: refuse to run if the git working tree has uncommitted changes.
#    WHY: the tag is the git SHA. If files differ from that commit, the image would carry
#    code that the tag does not describe, and the deploy could not be traced back.
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: uncommitted changes. Commit them first, so the image tag matches committed code." >&2
  git status --short >&2
  exit 1
fi

# @concept: immutable-image-tags
# 4. WHAT: the tag is the short git SHA, e.g. 9fa3c21. Never "latest".
#    WHY: "latest" is a moving name: you cannot tell which code it holds, and it cannot be
#    used here at all because the repositories are IMMUTABLE (a tag can be pushed only once).
#    A SHA names exactly one commit, so any running container can be traced to its code.
TAG="$(git rev-parse --short HEAD)"

# 5. WHAT: warn if this is not an Apple Silicon Mac.
#    WHY: we build for ARM64 (AWS Graviton, cheaper). On an Intel/AMD machine Docker emulates
#    ARM, which works but is much slower.
HOST_ARCH="$(uname -m)"
if [ "$HOST_ARCH" != "arm64" ] && [ "$HOST_ARCH" != "aarch64" ]; then
  echo "WARNING: this machine is $HOST_ARCH, not ARM. The ARM64 build will use emulation and be slower." >&2
fi

# 6. WHAT: use the same region as Pulumi, unless the caller already set it. The AWS credentials
#    come from the environment (export AWS_PROFILE=ticketlite), the same ones Pulumi uses.
#    WHY: the images must go to the account that Pulumi created the repositories in.
#    (Until Step 12b the profile was read from Pulumi config; it is no longer there, see Pulumi.dev.yaml.)
cd "$ROOT/infra"
export AWS_REGION="${AWS_REGION:-$(pulumi config get aws:region 2>/dev/null || echo us-east-1)}"

# 7. WHAT: read the three repository URLs from the Pulumi stack outputs.
#    WHY: Pulumi is the single source of truth for them; no URL is typed here by hand.
API_REPO="$(pulumi stack output apiRepoUrl)"
WEB_REPO="$(pulumi stack output webRepoUrl)"
WORKER_REPO="$(pulumi stack output workerRepoUrl)"
cd "$ROOT"

# 8. WHAT: log Docker in to ECR. The password comes from `aws ecr get-login-password`.
#    WHY: ECR repositories are private. The token lasts 12 hours and is piped in, so it is
#    never printed or saved in a file. The registry host is the part of the URL before the "/".
REGISTRY="${API_REPO%%/*}"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

# @concept: arm64-graviton
# @concept: same-origin-routing
# 9. WHAT: build for linux/arm64 and push in one step (--push): api, web, then the worker (S1c).
#    WHY: the ECS tasks (Step 11e) will run on ARM64, and an image only runs on the CPU it
#    was built for. buildx is Docker's multi-platform builder.
#    --provenance=false: stops buildx adding extra "attestation" manifests, so each tag is
#    one plain image and `describe-images` shows a single clean ARM64 image.
#    web gets no NEXT_PUBLIC_API_URL: empty means same origin (see docs/16-infra-ecr.md).
echo "Building and pushing api:$TAG ..."
docker buildx build --platform linux/arm64 --provenance=false \
  -f apps/api/Dockerfile -t "$API_REPO:$TAG" --push .

echo "Building and pushing web:$TAG ..."
docker buildx build --platform linux/arm64 --provenance=false \
  -f apps/web/Dockerfile -t "$WEB_REPO:$TAG" --push .

# The worker is a Lambda container image: Lambda accepts only a plain single-platform image, so
# --provenance=false is required here, not just tidy (cd.yml step 17b).
echo "Building and pushing worker:$TAG ..."
docker buildx build --platform linux/arm64 --provenance=false \
  -f apps/worker/Dockerfile -t "$WORKER_REPO:$TAG" --push .

# 10. WHAT: print what was pushed: the tag and the digest of each image.
#     WHY: the tag is a name; the digest (sha256 of the content) is the exact content. Later
#     steps can pin the digest to be sure about what runs.
echo
echo "Pushed (tag = git SHA):"
for SERVICE in api web worker; do
  REPO_NAME="minitickets-dev-$SERVICE"
  DIGEST="$(aws ecr describe-images --region "$AWS_REGION" --repository-name "$REPO_NAME" \
    --image-ids imageTag="$TAG" --query 'imageDetails[0].imageDigest' --output text)"
  echo "  $REPO_NAME  tag=$TAG  digest=$DIGEST"
done
