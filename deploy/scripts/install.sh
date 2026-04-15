#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:-/opt/apps/mailops}"
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$APP_ROOT"
rsync -a --delete "$SRC_ROOT/" "$APP_ROOT/"

if [ ! -f "$APP_ROOT/backend/.env" ]; then
  install -m 600 "$APP_ROOT/backend/.env.example" "$APP_ROOT/backend/.env"
fi
install -m 600 "$APP_ROOT/deploy/systemd/mailadmin.env" "$APP_ROOT/deploy/systemd/mailadmin.env"

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
