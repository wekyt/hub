#!/usr/bin/env bash
# Wekyt hub installer. One command, zero questions.
#
# Installs the default dev team (orchestrator, architect, dev, QA, security)
# plus the tool store, templates and policy into an ai/ folder in the
# current directory.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/wekyt/hub/main/install.sh | bash
#
# No git clone, no npm. The installer downloads the release package from
# GitHub Releases and extracts the ai/ folder. It needs curl and tar.
#
# Environment overrides (for testing and for pinned installs):
#   WEKYT_TARBALL=<path to a local .tar.gz>   use a local package instead
#   WEKYT_RELEASE_URL=<url>                   use another release asset URL
#   WEKYT_FORCE=1                             replace an existing ai/ folder
#
# Exit codes: 0 ok, 1 missing tool, 2 ai/ already exists, 3 download failed,
# 4 package is not a valid wekyt hub package.

set -euo pipefail

RELEASE_URL="${WEKYT_RELEASE_URL:-https://github.com/wekyt/hub/releases/latest/download/wekyt-hub.tar.gz}"
TARGET_DIR="${WEKYT_TARGET:-$PWD}"

fail() {
  echo "wekyt install: error: $1" >&2
  exit "${2:-1}"
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required tool: $1" 1
}

need curl
need tar
need mktemp

if [[ -e "$TARGET_DIR/ai" && "${WEKYT_FORCE:-0}" != "1" ]]; then
  fail "ai/ already exists in $TARGET_DIR. Move it aside first, or run with WEKYT_FORCE=1 to replace it." 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PACKAGE="$WORK/wekyt-hub.tar.gz"

if [[ -n "${WEKYT_TARBALL:-}" ]]; then
  [[ -f "$WEKYT_TARBALL" ]] || fail "WEKYT_TARBALL not found: $WEKYT_TARBALL" 3
  cp "$WEKYT_TARBALL" "$PACKAGE"
else
  echo "wekyt install: downloading $RELEASE_URL"
  curl -fsSL --retry 2 -o "$PACKAGE" "$RELEASE_URL" \
    || fail "download failed: $RELEASE_URL (is there a published release with a wekyt-hub.tar.gz asset?)" 3
fi

[[ -s "$PACKAGE" ]] || fail "downloaded package is empty" 4
LISTING="$(tar -tzf "$PACKAGE")" \
  || fail "package is not a valid gzip tarball" 4
grep -q '^ai/' <<<"$LISTING" \
  || fail "package has no top level ai/ folder" 4

tar -xzf "$PACKAGE" -C "$WORK"

if [[ "${WEKYT_FORCE:-0}" == "1" && -e "$TARGET_DIR/ai" ]]; then
  rm -rf "$TARGET_DIR/ai"
fi
mv "$WORK/ai" "$TARGET_DIR/ai"

COUNT="$(find "$TARGET_DIR/ai" -type f | wc -l | tr -d ' ')"
echo "wekyt install: done. $COUNT files installed in $TARGET_DIR/ai"
echo "wekyt install: next step: open this project with your agent harness and ask the orchestrator for the first job. See ai/README.md."
