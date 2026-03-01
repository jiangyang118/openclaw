#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/aliyun-openclaw-remote.sh [--as-admin] <remote-command>
  scripts/aliyun-openclaw-remote.sh --check

Environment:
  OPENCLAW_ALIYUN_HOST       Remote host (default: 47.90.228.188)
  OPENCLAW_ALIYUN_USER       Remote user (default: root)
  OPENCLAW_ALIYUN_PASSWORD   Optional SSH password. If unset, SSH key auth is used.
  OPENCLAW_ALIYUN_PROFILE_FILE
                             Optional markdown profile file (default: .agent/aliyun-ssh.md)

Examples:
  scripts/aliyun-openclaw-remote.sh --check
  scripts/aliyun-openclaw-remote.sh "ss -ltnp | grep :17310 || true"
  scripts/aliyun-openclaw-remote.sh --as-admin "openclaw --version"
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROFILE_FILE="${OPENCLAW_ALIYUN_PROFILE_FILE:-${REPO_ROOT}/.agent/aliyun-ssh.md}"

extract_profile_value() {
  local file="$1"
  shift
  local key
  for key in "$@"; do
    local value
    value="$(
      awk -v key="$key" '
        BEGIN { IGNORECASE=1 }
        {
          line=$0
          gsub(/\r/, "", line)
          if (line ~ "^[[:space:]-*]*" key "[[:space:]]*[:：]") {
            sub("^[[:space:]-*]*" key "[[:space:]]*[:：][[:space:]]*", "", line)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
            print line
            exit
          }
        }
      ' "$file"
    )"
    if [[ -n "$value" ]]; then
      echo "$value"
      return 0
    fi
  done
  return 1
}

PROFILE_HOST=""
PROFILE_USER=""
PROFILE_PASSWORD=""
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_HOST="$(extract_profile_value "$PROFILE_FILE" "主机" "host" "HOST" || true)"
  PROFILE_USER="$(extract_profile_value "$PROFILE_FILE" "用户" "user" "USER" || true)"
  PROFILE_PASSWORD="$(extract_profile_value "$PROFILE_FILE" "密码" "password" "PASSWORD" || true)"
fi

HOST="${OPENCLAW_ALIYUN_HOST:-${PROFILE_HOST:-47.90.228.188}}"
USER_NAME="${OPENCLAW_ALIYUN_USER:-${PROFILE_USER:-root}}"
PASSWORD="${OPENCLAW_ALIYUN_PASSWORD:-${PROFILE_PASSWORD:-}}"
AS_ADMIN=0

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--as-admin" ]]; then
  AS_ADMIN=1
  shift
fi

if [[ "${1:-}" == "--check" ]]; then
  set -- "ss -ltnp | grep ':17310' || true; sudo -u admin XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user is-active openclaw-gateway.service || true"
fi

if [[ "$#" -lt 1 ]]; then
  usage
  exit 2
fi

REMOTE_CMD="$*"
if [[ "$AS_ADMIN" -eq 1 ]]; then
  REMOTE_CMD="sudo -iu admin bash -lc $(printf %q "$REMOTE_CMD")"
fi

run_with_ssh_key() {
  ssh -o StrictHostKeyChecking=no "${USER_NAME}@${HOST}" "${REMOTE_CMD}"
}

run_with_password() {
  if ! command -v expect >/dev/null 2>&1; then
    echo "expect is required for password-based SSH mode." >&2
    return 1
  fi
  expect -f - "$HOST" "$USER_NAME" "$PASSWORD" "$REMOTE_CMD" <<'EOF'
set timeout -1
set host [lindex $argv 0]
set user [lindex $argv 1]
set pass [lindex $argv 2]
set cmd  [lindex $argv 3]
spawn ssh -o StrictHostKeyChecking=no "$user@$host" "$cmd"
expect {
  -re "(?i)yes/no" {
    send "yes\r"
    exp_continue
  }
  -re "(?i)password:" {
    send "$pass\r"
    exp_continue
  }
  eof
}
catch wait result
exit [lindex $result 3]
EOF
}

if [[ -n "$PASSWORD" ]]; then
  run_with_password
else
  run_with_ssh_key
fi
