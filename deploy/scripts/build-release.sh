#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ROOT="$SRC_ROOT/.release"
ARTIFACT_PATH="$SRC_ROOT/release.tar.gz"

echo "==> Cleaning old release artifacts"
rm -rf "$RELEASE_ROOT" "$ARTIFACT_PATH"

mkdir -p \
  "$RELEASE_ROOT/backend/bin" \
  "$RELEASE_ROOT/frontend" \
  "$RELEASE_ROOT/deploy"

echo "==> Building backend"
(
  cd "$SRC_ROOT/backend"
  go build -o "$RELEASE_ROOT/backend/bin/mailadmin-api" ./cmd/server
)

echo "==> Copying backend runtime files"
cp -a "$SRC_ROOT/backend/scripts" "$RELEASE_ROOT/backend/scripts"
cp -a "$SRC_ROOT/backend/.env.example" "$RELEASE_ROOT/backend/.env.example"

echo "==> Building frontend"
(
  cd "$SRC_ROOT/frontend"
  npm ci
  npm run build
)

echo "==> Copying frontend dist"
cp -a "$SRC_ROOT/frontend/dist" "$RELEASE_ROOT/frontend/dist"

echo "==> Copying deploy assets"
mkdir -p "$RELEASE_ROOT/deploy/systemd/mailadmin.service.d"
cp -a "$SRC_ROOT/deploy/scripts" "$RELEASE_ROOT/deploy/scripts"
cp -a "$SRC_ROOT/deploy/systemd/mailadmin.service" "$RELEASE_ROOT/deploy/systemd/mailadmin.service"
cp -a "$SRC_ROOT/deploy/systemd/mailadmin.env.example" "$RELEASE_ROOT/deploy/systemd/mailadmin.env.example"
cp -a "$SRC_ROOT/deploy/systemd/mailadmin.service.d/redis-unix.conf" "$RELEASE_ROOT/deploy/systemd/mailadmin.service.d/redis-unix.conf"
cp -a "$SRC_ROOT/deploy/nginx" "$RELEASE_ROOT/deploy/nginx"

echo "==> Validating release contents"
test -x "$RELEASE_ROOT/backend/bin/mailadmin-api"
test -f "$RELEASE_ROOT/backend/.env.example"
test -f "$RELEASE_ROOT/frontend/dist/index.html"
test -f "$RELEASE_ROOT/frontend/dist/mail/index.html"
test -f "$RELEASE_ROOT/frontend/dist/admin/index.html"
test -f "$RELEASE_ROOT/deploy/scripts/install.sh"
test -f "$RELEASE_ROOT/deploy/systemd/mailadmin.service"
test -f "$RELEASE_ROOT/deploy/systemd/mailadmin.env.example"
test -f "$RELEASE_ROOT/deploy/nginx/mail.myupona.com.conf"

echo "==> Packaging release.tar.gz"
tar -C "$RELEASE_ROOT" -czf "$ARTIFACT_PATH" .

echo "Release ready: $ARTIFACT_PATH"
