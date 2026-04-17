#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $0 <release_dir_or_tarball> <app_root>

Examples:
  $0 /tmp/release /opt/apps/mailops
  $0 /tmp/release.tar.gz /opt/apps/mailops
USAGE
}

if [ "$#" -lt 2 ]; then
  usage
  exit 1
fi

INPUT_PATH="$1"
APP_ROOT="$2"
BACKEND_ENV="$APP_ROOT/backend/.env"
SYSTEMD_ENV="$APP_ROOT/deploy/systemd/mailadmin.env"
SERVICE_USER="${SERVICE_USER:-mailops}"
SERVICE_GROUP="${SERVICE_GROUP:-mailops}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

resolve_release_root() {
  if [ -d "$INPUT_PATH" ]; then
    RELEASE_ROOT="$INPUT_PATH"
    return 0
  fi

  if [ -f "$INPUT_PATH" ]; then
    mkdir -p "$TMP_DIR/release"
    tar -xzf "$INPUT_PATH" -C "$TMP_DIR/release"
    RELEASE_ROOT="$TMP_DIR/release"
    return 0
  fi

  echo "error: release artifact not found: $INPUT_PATH" >&2
  return 1
}

assert_file() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "error: required file missing in release: $path" >&2
    exit 1
  fi
}

assert_exec() {
  local path="$1"
  if [ ! -x "$path" ]; then
    echo "error: required executable missing in release: $path" >&2
    exit 1
  fi
}

resolve_release_root

assert_exec "$RELEASE_ROOT/backend/bin/mailadmin-api"
assert_file "$RELEASE_ROOT/frontend/dist/index.html"
assert_file "$RELEASE_ROOT/frontend/dist/mail/index.html"
assert_file "$RELEASE_ROOT/frontend/dist/admin/index.html"
assert_file "$RELEASE_ROOT/deploy/systemd/mailadmin.service"
assert_file "$RELEASE_ROOT/deploy/systemd/mailadmin.env"
assert_file "$RELEASE_ROOT/deploy/nginx/mail.myupona.com.conf"
assert_file "$RELEASE_ROOT/deploy/systemd/mailadmin.service.d/redis-unix.conf"

mkdir -p "$APP_ROOT"
if [ -f "$BACKEND_ENV" ]; then
  cp -f "$BACKEND_ENV" "$TMP_DIR/backend.env"
fi
if [ -f "$SYSTEMD_ENV" ]; then
  cp -f "$SYSTEMD_ENV" "$TMP_DIR/mailadmin.env"
fi

rsync -a --delete "$RELEASE_ROOT/" "$APP_ROOT/"

if [ "$(id -u)" -eq 0 ]; then
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
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_ROOT/backend" "$APP_ROOT/frontend/dist"
else
  echo "warning: not running as root; unable to provision $SERVICE_USER/$SERVICE_GROUP or adjust ownership"
fi

if [ -f "$TMP_DIR/backend.env" ]; then
  install -m 600 "$TMP_DIR/backend.env" "$BACKEND_ENV"
elif [ ! -f "$BACKEND_ENV" ]; then
  install -m 600 "$APP_ROOT/backend/.env.example" "$BACKEND_ENV"
fi

if [ -f "$TMP_DIR/mailadmin.env" ]; then
  install -m 600 "$TMP_DIR/mailadmin.env" "$SYSTEMD_ENV"
else
  install -m 600 "$SYSTEMD_ENV" "$SYSTEMD_ENV"
fi

if command -v systemctl >/dev/null 2>&1; then
  cp -f "$APP_ROOT/deploy/systemd/mailadmin.service" /etc/systemd/system/mailadmin.service
  REDIS_NETWORK_VALUE="$({ awk -F= '/^REDIS_NETWORK=/{print $2}' "$SYSTEMD_ENV" || true; } | tail -n1 | tr -d '[:space:]')"
  REDIS_GROUP_DROPIN_DIR="/etc/systemd/system/mailadmin.service.d"
  REDIS_GROUP_DROPIN="$REDIS_GROUP_DROPIN_DIR/redis-unix.conf"

  if [ "$REDIS_NETWORK_VALUE" = "unix" ]; then
    if getent group "valkey-mail" >/dev/null 2>&1; then
      install -d -m 755 "$REDIS_GROUP_DROPIN_DIR"
      cp -f "$APP_ROOT/deploy/systemd/mailadmin.service.d/redis-unix.conf" "$REDIS_GROUP_DROPIN"
      echo "systemd unix-socket drop-in installed: $REDIS_GROUP_DROPIN"
    else
      rm -f "$REDIS_GROUP_DROPIN"
      echo "error: REDIS_NETWORK=unix but group valkey-mail does not exist" >&2
      exit 1
    fi
  else
    rm -f "$REDIS_GROUP_DROPIN"
  fi

  systemctl daemon-reload
  echo "systemd unit installed: /etc/systemd/system/mailadmin.service"
fi

echo "Artifact deployed to $APP_ROOT"
echo "Next:"
echo "  1) systemctl enable --now mailadmin"
echo "  2) API 首次启动将自动 ensureMetaTables() 初始化表结构"
echo "  3) $APP_ROOT/backend/scripts/init_admin.sh <username> <password> superadmin"
