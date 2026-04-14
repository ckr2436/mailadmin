#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:-/opt/apps/mailops}"
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$APP_ROOT"
rsync -a --delete "$SRC_ROOT/" "$APP_ROOT/"

install -m 600 "$APP_ROOT/backend/.env" "$APP_ROOT/backend/.env"
install -m 600 "$APP_ROOT/deploy/systemd/mailadmin.env" "$APP_ROOT/deploy/systemd/mailadmin.env"

if command -v systemctl >/dev/null 2>&1; then
  cp -f "$APP_ROOT/deploy/systemd/mailadmin.service" /etc/systemd/system/mailadmin.service
  systemctl daemon-reload
  echo "systemd unit installed: /etc/systemd/system/mailadmin.service"
fi

echo "App copied to $APP_ROOT"
echo "Next:"
echo "  1) mysql --protocol=socket -S /var/lib/mysql/mysql.sock -u mailadmin -p mailserver < $APP_ROOT/backend/migrations/001_mailadmin_tables.sql"
echo "  2) $APP_ROOT/backend/scripts/init_admin.sh <username> <password> superadmin"
echo "  3) systemctl enable --now mailadmin"
