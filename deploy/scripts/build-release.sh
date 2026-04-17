#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_DIR="$SRC_ROOT/.release"
PACKAGE_PATH="$SRC_ROOT/release.tar.gz"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

require_cmd go
require_cmd npm
require_cmd tar

echo "[build-release] preparing release directory: $RELEASE_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/backend/bin" "$RELEASE_DIR/frontend"

echo "[build-release] building backend binary"
(
  cd "$SRC_ROOT/backend"
  go build -o "$RELEASE_DIR/backend/bin/mailadmin-api" ./cmd/server
)

echo "[build-release] building frontend dist"
(
  cd "$SRC_ROOT/frontend"
  npm ci
  npm run build
)

echo "[build-release] copying frontend dist"
cp -a "$SRC_ROOT/frontend/dist" "$RELEASE_DIR/frontend/dist"

echo "[build-release] copying deploy assets"
cp -a "$SRC_ROOT/deploy" "$RELEASE_DIR/deploy"

echo "[build-release] copying backend runtime assets"
mkdir -p "$RELEASE_DIR/backend"
cp -a "$SRC_ROOT/backend/scripts" "$RELEASE_DIR/backend/scripts"
cp -a "$SRC_ROOT/backend/.env.example" "$RELEASE_DIR/backend/.env.example"

assert_exists() {
  local path="$1"
  if [ ! -e "$path" ]; then
    echo "error: missing required release file: $path" >&2
    exit 1
  fi
}

echo "[build-release] validating release contents"
test -x "$RELEASE_DIR/backend/bin/mailadmin-api" || {
  echo "error: backend binary is missing or not executable" >&2
  exit 1
}
assert_exists "$RELEASE_DIR/frontend/dist/index.html"
assert_exists "$RELEASE_DIR/frontend/dist/mail/index.html"
assert_exists "$RELEASE_DIR/frontend/dist/admin/index.html"
assert_exists "$RELEASE_DIR/deploy/systemd/mailadmin.service"
assert_exists "$RELEASE_DIR/deploy/systemd/mailadmin.env"
assert_exists "$RELEASE_DIR/deploy/nginx/mail.myupona.com.conf"

echo "[build-release] creating tarball: $PACKAGE_PATH"
rm -f "$PACKAGE_PATH"
tar -czf "$PACKAGE_PATH" -C "$RELEASE_DIR" .

echo "[build-release] done"
echo "  release dir: $RELEASE_DIR"
echo "  release tar: $PACKAGE_PATH"
