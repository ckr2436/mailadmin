#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:-/opt/apps/mailops}"
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_ENV="$APP_ROOT/backend/.env"
SYSTEMD_ENV="$APP_ROOT/deploy/systemd/mailadmin.env"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$APP_ROOT"
if [ -f "$BACKEND_ENV" ]; then
  cp -f "$BACKEND_ENV" "$TMP_DIR/backend.env"
fi
if [ -f "$SYSTEMD_ENV" ]; then
  cp -f "$SYSTEMD_ENV" "$TMP_DIR/mailadmin.env"
fi

rsync -a --delete "$SRC_ROOT/" "$APP_ROOT/"

if [ -f "$TMP_DIR/backend.env" ]; then
  install -m 600 "$TMP_DIR/backend.env" "$BACKEND_ENV"
fi
if [ -f "$TMP_DIR/mailadmin.env" ]; then
  install -m 600 "$TMP_DIR/mailadmin.env" "$SYSTEMD_ENV"
fi

if [ ! -f "$BACKEND_ENV" ]; then
  install -m 600 "$APP_ROOT/backend/.env.example" "$BACKEND_ENV"
fi
install -m 600 "$SYSTEMD_ENV" "$SYSTEMD_ENV"

if command -v systemctl >/dev/null 2>&1; then
  cp -f "$APP_ROOT/deploy/systemd/mailadmin.service" /etc/systemd/system/mailadmin.service
  systemctl daemon-reload
  echo "systemd unit installed: /etc/systemd/system/mailadmin.service"
fi

echo "App copied to $APP_ROOT"
echo "Next:"
echo "  1) systemctl enable --now mailadmin"
echo "  2) API 首次启动将自动 ensureMetaTables() 初始化表结构"
echo "  3) $APP_ROOT/backend/scripts/init_admin.sh <username> <password> superadmin"
