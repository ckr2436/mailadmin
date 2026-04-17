#!/usr/bin/env bash
set -euo pipefail

INPUT_PATH="${1:?usage: install.sh <release_dir_or_tarball> [app_root]}"
APP_ROOT="${2:-/opt/apps/mailops}"

SERVICE_USER="${SERVICE_USER:-mailops}"
SERVICE_GROUP="${SERVICE_GROUP:-mailops}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BACKEND_ENV="$APP_ROOT/backend/.env"
SYSTEMD_ENV="$APP_ROOT/deploy/systemd/mailadmin.env"

echo "==> Resolving release input"
if [ -d "$INPUT_PATH" ]; then
  RELEASE_ROOT="$INPUT_PATH"
elif [ -f "$INPUT_PATH" ]; then
  mkdir -p "$TMP_DIR/release"
  tar -xzf "$INPUT_PATH" -C "$TMP_DIR/release"
  RELEASE_ROOT="$TMP_DIR/release"
else
  echo "release input not found: $INPUT_PATH" >&2
  exit 1
fi

echo "==> Validating release contents"
test -x "$RELEASE_ROOT/backend/bin/mailadmin-api"
test -f "$RELEASE_ROOT/backend/.env.example"
test -f "$RELEASE_ROOT/frontend/dist/index.html"
test -f "$RELEASE_ROOT/frontend/dist/mail/index.html"
test -f "$RELEASE_ROOT/frontend/dist/admin/index.html"
test -f "$RELEASE_ROOT/deploy/systemd/mailadmin.service"
test -f "$RELEASE_ROOT/deploy/systemd/mailadmin.env.example"
test -f "$RELEASE_ROOT/deploy/nginx/mail.myupona.com.conf"

echo "==> Backing up existing env files"
mkdir -p "$TMP_DIR/env-backup"
if [ -f "$BACKEND_ENV" ]; then
  cp -f "$BACKEND_ENV" "$TMP_DIR/env-backup/backend.env"
fi
if [ -f "$SYSTEMD_ENV" ]; then
  cp -f "$SYSTEMD_ENV" "$TMP_DIR/env-backup/mailadmin.env"
fi

echo "==> Syncing release to app root"
mkdir -p "$APP_ROOT"
rsync -a --delete "$RELEASE_ROOT/" "$APP_ROOT/"

echo "==> Restoring or initializing env files"
if [ -f "$TMP_DIR/env-backup/backend.env" ]; then
  install -m 600 "$TMP_DIR/env-backup/backend.env" "$BACKEND_ENV"
else
  install -m 600 "$APP_ROOT/backend/.env.example" "$BACKEND_ENV"
fi

if [ -f "$TMP_DIR/env-backup/mailadmin.env" ]; then
  install -m 600 "$TMP_DIR/env-backup/mailadmin.env" "$SYSTEMD_ENV"
else
  install -m 600 "$APP_ROOT/deploy/systemd/mailadmin.env.example" "$SYSTEMD_ENV"
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "==> Ensuring service account"
  NOLOGIN_SHELL="$(command -v nologin || true)"
  if [ -z "$NOLOGIN_SHELL" ]; then
    NOLOGIN_SHELL="/usr/sbin/nologin"
  fi

  if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
    groupadd --system "$SERVICE_GROUP"
  fi
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --gid "$SERVICE_GROUP" --home-dir "$APP_ROOT" --shell "$NOLOGIN_SHELL" "$SERVICE_USER"
  fi

  echo "==> Fixing ownership"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_ROOT/backend" "$APP_ROOT/frontend/dist"
else
  echo "warning: not running as root; ownership and systemd install skipped"
fi

if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  echo "==> Installing systemd unit"
  cp -f "$APP_ROOT/deploy/systemd/mailadmin.service" /etc/systemd/system/mailadmin.service

  DROPIN_DIR="/etc/systemd/system/mailadmin.service.d"
  install -d -m 755 "$DROPIN_DIR"

  REDIS_NETWORK_VALUE="$(
    awk -F= '/^REDIS_NETWORK=/{print $2}' "$SYSTEMD_ENV" 2>/dev/null | tail -n1 | tr -d '[:space:]'
  )"

  if [ "$REDIS_NETWORK_VALUE" = "unix" ]; then
    if getent group "valkey-mail" >/dev/null 2>&1; then
      cat > "$DROPIN_DIR/40-redis-unix.conf" <<'EOC'
[Unit]
After=valkey-mail.service
Wants=valkey-mail.service

[Service]
SupplementaryGroups=valkey-mail dovecot
EOC
    else
      echo "error: REDIS_NETWORK=unix but group valkey-mail does not exist" >&2
      exit 1
    fi
  else
    rm -f "$DROPIN_DIR/40-redis-unix.conf"
  fi

  systemctl daemon-reload
fi

echo "Deploy complete: $APP_ROOT"
echo "Next:"
echo "  systemctl restart mailadmin"
echo "  nginx -t && systemctl reload nginx"
