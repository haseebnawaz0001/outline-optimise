#!/usr/bin/env bash
#
# Builds the optimized Outline Docker images from this repository.
#
# Produces:
#   - the dependency/build base image  (Dockerfile.base)
#   - the runtime image                (Dockerfile, on top of the base)
#
# Usage (from anywhere):
#   deploy/build.sh
#
# Environment overrides:
#   BASE_IMAGE    tag for the base image   (default: outline-base:local)
#   OUTLINE_IMAGE tag for the final image  (default: outline-optimized:local)
#   PLATFORM      e.g. linux/amd64 or linux/arm64 (default: host platform)

set -euo pipefail

cd "$(dirname "$0")/.."

BASE_IMAGE="${BASE_IMAGE:-outline-base:local}"
OUTLINE_IMAGE="${OUTLINE_IMAGE:-outline-optimized:local}"
PLATFORM_ARGS=()
if [ -n "${PLATFORM:-}" ]; then
  PLATFORM_ARGS=(--platform "$PLATFORM")
fi

echo "==> Building base image: $BASE_IMAGE"
docker build "${PLATFORM_ARGS[@]}" -f Dockerfile.base -t "$BASE_IMAGE" .

echo "==> Building runtime image: $OUTLINE_IMAGE"
docker build "${PLATFORM_ARGS[@]}" \
  --build-arg "BASE_IMAGE=$BASE_IMAGE" \
  -f Dockerfile -t "$OUTLINE_IMAGE" .

echo "==> Done. Image: $OUTLINE_IMAGE"
