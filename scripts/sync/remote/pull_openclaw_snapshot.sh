#!/usr/bin/env bash
set -euo pipefail

# Pull remote OpenClaw runtime source/config snapshot into repo (incremental).
# Requires SSH access. Prefer SSH key auth for non-interactive use.

REMOTE="${1:-root@47.90.228.188}"
ADMIN_USER="${ADMIN_USER:-admin}"
DEST_ROOT="${DEST_ROOT:-ops/remote-sync/47.90.228.188}"
TMP_TGZ="$(mktemp -t openclaw_snapshot.XXXXXX.tgz)"
TMP_DIR="$(mktemp -d -t openclaw_snapshot.XXXXXX)"
REMOTE_TMP="/tmp/openclaw_snapshot.tgz"

cleanup() {
  rm -f "$TMP_TGZ"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ssh "$REMOTE" "set -e; rm -rf /tmp/openclaw_snapshot && mkdir -p /tmp/openclaw_snapshot/extensions; \
  cp /home/${ADMIN_USER}/.openclaw/openclaw.json /tmp/openclaw_snapshot/openclaw.json; \
  cp -r /home/${ADMIN_USER}/.openclaw/extensions/wecom /tmp/openclaw_snapshot/extensions/wecom; \
  cp -r /home/${ADMIN_USER}/.openclaw/extensions/github-webhook-bridge /tmp/openclaw_snapshot/extensions/github-webhook-bridge; \
  cp /home/${ADMIN_USER}/.config/systemd/user/openclaw-gateway.service /tmp/openclaw_snapshot/openclaw-gateway.service; \
  rm -rf /tmp/openclaw_snapshot/extensions/wecom/.git; \
  tar -czf ${REMOTE_TMP} -C /tmp openclaw_snapshot"

scp "$REMOTE:${REMOTE_TMP}" "$TMP_TGZ"
tar -xzf "$TMP_TGZ" -C "$TMP_DIR"

mkdir -p "$DEST_ROOT/config" "$DEST_ROOT/extensions" "$DEST_ROOT/systemd"

python3 - <<PY
import json
from pathlib import Path
src = Path("$TMP_DIR/openclaw_snapshot/openclaw.json")
out = Path("$DEST_ROOT/config/openclaw.redacted.json")
obj = json.loads(src.read_text(encoding='utf-8'))

sensitive = {"token", "apikey", "appsecret", "secret", "webhooksecret", "hookstoken", "encodingaeskey", "password"}

def redact(v):
    if isinstance(v, dict):
        r = {}
        for k, val in v.items():
            lk = k.lower()
            if lk in sensitive or lk.endswith("token") or lk.endswith("secret") or lk.endswith("key"):
                r[k] = "<REDACTED>"
            else:
                r[k] = redact(val)
        return r
    if isinstance(v, list):
        return [redact(x) for x in v]
    return v

out.write_text(json.dumps(redact(obj), ensure_ascii=False, indent=2) + "\n", encoding='utf-8')
PY

rsync -a --delete --checksum "$TMP_DIR/openclaw_snapshot/extensions/wecom/" "$DEST_ROOT/extensions/wecom/"
rsync -a --delete --checksum "$TMP_DIR/openclaw_snapshot/extensions/github-webhook-bridge/" "$DEST_ROOT/extensions/github-webhook-bridge/"
cp "$TMP_DIR/openclaw_snapshot/openclaw-gateway.service" "$DEST_ROOT/systemd/openclaw-gateway.service"

echo "Snapshot pulled to: $DEST_ROOT"
