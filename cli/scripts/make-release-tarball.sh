#!/usr/bin/env bash
# Build the release package for the wekyt hub: wekyt-hub.tar.gz plus
# SHA256SUMS, from the ai/ folder. The SHA256SUMS file is required: since
# v0.2.0, `wekyt install` and `wekyt update` refuse any release that does
# not publish one.
#
# Usage:
#   cli/scripts/make-release-tarball.sh [version] [out-dir]
#
# Defaults: version from ai/VERSION, out dir ./dist at the hub root.
# The tarball contains only ai/, at the top level, like v0.1.0 did.
set -euo pipefail

HUB_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-$(cat "$HUB_DIR/ai/VERSION")}"
OUT="${2:-$HUB_DIR/dist}"

mkdir -p "$OUT"
cd "$HUB_DIR"
tar -czf "$OUT/wekyt-hub.tar.gz" ai
cd "$OUT"
sha256sum wekyt-hub.tar.gz > SHA256SUMS
# sha256sum writes "<hash>  wekyt-hub.tar.gz", the format the CLI parses.
echo "built $OUT/wekyt-hub.tar.gz (version $VERSION)"
cat SHA256SUMS
echo "upload both files as assets of the v$VERSION GitHub release."
