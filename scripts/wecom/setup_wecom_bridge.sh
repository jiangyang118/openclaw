#!/usr/bin/env bash
set -euo pipefail

PUBLIC_BASE=""
HOOK_TOKEN=""
HOOK_PATH="/hooks/wecom"
LOCAL_OPENCLAW_BASE="http://127.0.0.1:18789"
BRIDGE_PORT="18888"
CALLBACK_PATH="/wecom/callback"
TOKEN_IN=""
AES_IN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --public-base) PUBLIC_BASE="$2"; shift 2 ;;
    --openclaw-hook-token) HOOK_TOKEN="$2"; shift 2 ;;
    --openclaw-hook-path) HOOK_PATH="$2"; shift 2 ;;
    --openclaw-base) LOCAL_OPENCLAW_BASE="$2"; shift 2 ;;
    --bridge-port) BRIDGE_PORT="$2"; shift 2 ;;
    --callback-path) CALLBACK_PATH="$2"; shift 2 ;;
    --token) TOKEN_IN="$2"; shift 2 ;;
    --aes-key) AES_IN="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PUBLIC_BASE" ]]; then
  echo "[ERR] --public-base is required" >&2
  exit 1
fi
if [[ -z "$HOOK_TOKEN" ]]; then
  echo "[ERR] --openclaw-hook-token is required" >&2
  exit 1
fi

mkdir -p "$HOME/.openclaw/bootstrap"

gen_token() {
  python3 - <<'PY'
import random, string
chars = string.ascii_letters + string.digits
print("".join(random.SystemRandom().choice(chars) for _ in range(15)), end="")
PY
}
gen_aes() {
  # WeCom EncodingAESKey requires 43 chars
  python3 - <<'PY'
import random, string
chars = string.ascii_letters + string.digits
print("".join(random.SystemRandom().choice(chars) for _ in range(43)), end="")
PY
}

TOKEN="${TOKEN_IN:-$(gen_token)}"
AES_KEY="${AES_IN:-$(gen_aes)}"

ENV_FILE="$HOME/.openclaw/bootstrap/wecom-bridge.env"
CFG_FILE="$HOME/.openclaw/bootstrap/wecom-api-config.json"
LOG_FILE="$HOME/.openclaw/bootstrap/wecom-bridge.log"
BRIDGE_SCRIPT="$(cd "$(dirname "$0")" && pwd)/wecom_callback_bridge.mjs"

cat >"$ENV_FILE" <<EOF
WECOM_BRIDGE_PORT=$BRIDGE_PORT
WECOM_CALLBACK_PATH=$CALLBACK_PATH
WECOM_CALLBACK_TOKEN=$TOKEN
WECOM_CALLBACK_AES_KEY=$AES_KEY
OPENCLAW_HOOK_BASE=$LOCAL_OPENCLAW_BASE
OPENCLAW_HOOK_PATH=$HOOK_PATH
OPENCLAW_HOOK_TOKEN=$HOOK_TOKEN
WECOM_FORWARD_TIMEOUT_MS=8000
EOF

cat >"$CFG_FILE" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "wecom": {
    "callbackUrl": "${PUBLIC_BASE}${CALLBACK_PATH}",
    "token": "$TOKEN",
    "encodingAesKey": "$AES_KEY"
  },
  "openclaw": {
    "hookBase": "$LOCAL_OPENCLAW_BASE",
    "hookPath": "$HOOK_PATH"
  }
}
EOF

# best-effort stop previous bridge
pkill -f "wecom_callback_bridge.mjs" >/dev/null 2>&1 || true

# start bridge in background
nohup env $(grep -v '^[[:space:]]*$' "$ENV_FILE" | xargs) node "$BRIDGE_SCRIPT" >"$LOG_FILE" 2>&1 &
sleep 1

echo "[OK] WeCom bridge started"
echo "  env:    $ENV_FILE"
echo "  config: $CFG_FILE"
echo "  log:    $LOG_FILE"
echo
echo "Fill in WeCom console with:"
echo "  URL:             ${PUBLIC_BASE}${CALLBACK_PATH}"
echo "  Token:           $TOKEN"
echo "  EncodingAESKey:  $AES_KEY"
