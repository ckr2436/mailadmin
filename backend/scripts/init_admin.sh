#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

USERNAME="${1:-}"
PASSWORD="${2:-}"
ROLE="${3:-superadmin}"

if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "Usage: $0 <username> <password> [superadmin|workspace_admin]" >&2
  exit 1
fi

: "${DB_SOCKET:?missing DB_SOCKET}"
: "${DB_NAME:?missing DB_NAME}"
: "${DB_ADMIN_USER:?missing DB_ADMIN_USER}"
: "${DB_ADMIN_PASS:?missing DB_ADMIN_PASS}"
: "${DOVECOT_BIN:=/opt/apps/dovecot/bin}"

hash_password() {
  if [[ -x "$DOVECOT_BIN/doveadm" ]]; then
    "$DOVECOT_BIN/doveadm" pw -s SHA512-CRYPT -p "$1"
  elif command -v doveadm >/dev/null 2>&1; then
    doveadm pw -s SHA512-CRYPT -p "$1"
  else
    local h
    h="$(openssl passwd -6 "$1")"
    echo "{SHA512-CRYPT}$h"
  fi
}

PW_HASH="$(hash_password "$PASSWORD")"

MYSQL_PWD="$DB_ADMIN_PASS" mysql --protocol=socket -S "$DB_SOCKET" -u "$DB_ADMIN_USER" "$DB_NAME" <<SQL
source $ROOT_DIR/migrations/001_mailadmin_tables.sql;
INSERT INTO app_admin_users(username,password_hash,role,active)
VALUES('${USERNAME//'/\'}','${PW_HASH//'/\'}','${ROLE//'/\'}',1)
ON DUPLICATE KEY UPDATE
  password_hash=VALUES(password_hash),
  role=VALUES(role),
  active=1;
SQL

echo "OK: admin user upserted: $USERNAME ($ROLE)"
