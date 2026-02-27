#!/usr/bin/env bash
set -euo pipefail

# Configure GitHub webhook bridge plugin + hooks mapping for OpenClaw 2026.2.9-compatible schema.
# Run this script ON the target server.

ADMIN_USER="${ADMIN_USER:-admin}"
OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-/home/${ADMIN_USER}/.openclaw/openclaw.json}"
PLUGIN_DIR="${PLUGIN_DIR:-/home/${ADMIN_USER}/.openclaw/extensions/github-webhook-bridge}"
PLUGIN_SRC_DIR="${PLUGIN_SRC_DIR:-$(pwd)/scripts/github/github-webhook-bridge-plugin}"
PUBLIC_WEBHOOK_URL="${PUBLIC_WEBHOOK_URL:-http://robot.cpt-fit.com:17310/github/webhook}"
FORWARD_URL="${FORWARD_URL:-http://127.0.0.1:17310/hooks/github}"

if [[ ! -f "$OPENCLAW_CONFIG" ]]; then
  echo "Config not found: $OPENCLAW_CONFIG" >&2
  exit 1
fi

if [[ ! -d "$PLUGIN_SRC_DIR" ]]; then
  echo "Plugin source not found: $PLUGIN_SRC_DIR" >&2
  exit 1
fi

HOOKS_TOKEN="${HOOKS_TOKEN:-$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)}"

install -d -m 755 "$PLUGIN_DIR"
install -m 644 "$PLUGIN_SRC_DIR/openclaw.plugin.json" "$PLUGIN_DIR/openclaw.plugin.json"
install -m 644 "$PLUGIN_SRC_DIR/index.js" "$PLUGIN_DIR/index.js"
chown -R "$ADMIN_USER:$ADMIN_USER" "$PLUGIN_DIR"

python3 - <<PY
import json, tempfile, os, datetime
p = "$OPENCLAW_CONFIG"
with open(p, "r", encoding="utf-8") as f:
    cfg = json.load(f)

cfg.setdefault("hooks", {})
hooks = cfg["hooks"]
hooks["enabled"] = True
hooks["path"] = "/hooks"
hooks["token"] = "$HOOKS_TOKEN"

mappings = hooks.get("mappings")
if not isinstance(mappings, list):
    mappings = []

new_map = {
    "id": "github-events",
    "match": {"path": "github", "source": "github"},
    "action": "agent",
    "wakeMode": "now",
    "name": "GitHub",
    "sessionKey": "hook:github:{{delivery}}",
    "deliver": False,
    "messageTemplate": "[GitHub] event={{event}} action={{action}} repo={{repository}}\\nTitle={{title}}\\nDelivery={{delivery}}\\nPayload={{payload}}"
}

replaced = False
for i, m in enumerate(mappings):
    if isinstance(m, dict) and m.get("id") == "github-events":
        mappings[i] = new_map
        replaced = True
        break
if not replaced:
    mappings.append(new_map)
hooks["mappings"] = mappings

cfg.setdefault("plugins", {})
plugins = cfg["plugins"]
plugins.setdefault("entries", {})
plugins["entries"]["github-webhook-bridge"] = {
    "enabled": True,
    "config": {
      "path": "/github/webhook",
      "forwardUrl": "$FORWARD_URL",
      "webhookSecret": "$WEBHOOK_SECRET",
      "hooksToken": "$HOOKS_TOKEN",
      "allowedEvents": ["ping", "issues", "issue_comment", "pull_request", "pull_request_review", "push"]
    }
}
plugins.setdefault("installs", {})
plugins["installs"]["github-webhook-bridge"] = {
    "source": "path",
    "sourcePath": "$PLUGIN_DIR",
    "installPath": "$PLUGIN_DIR",
    "version": "0.1.0",
    "installedAt": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
}

fd, tmp = tempfile.mkstemp(prefix="openclaw.", suffix=".json", dir=os.path.dirname(p))
os.close(fd)
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write("\\n")
os.replace(tmp, p)
print("updated", p)
PY

chown "$ADMIN_USER:$ADMIN_USER" "$OPENCLAW_CONFIG"

cat > "/home/${ADMIN_USER}/.openclaw/github-bridge-secrets.txt" <<SECRETS
HOOKS_TOKEN=${HOOKS_TOKEN}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
WEBHOOK_URL=${PUBLIC_WEBHOOK_URL}
FORWARD_URL=${FORWARD_URL}
SECRETS
chown "$ADMIN_USER:$ADMIN_USER" "/home/${ADMIN_USER}/.openclaw/github-bridge-secrets.txt"
chmod 600 "/home/${ADMIN_USER}/.openclaw/github-bridge-secrets.txt"

sudo -iu "$ADMIN_USER" env XDG_RUNTIME_DIR="/run/user/$(id -u "$ADMIN_USER")" systemctl --user restart openclaw-gateway
sleep 2
sudo -iu "$ADMIN_USER" env XDG_RUNTIME_DIR="/run/user/$(id -u "$ADMIN_USER")" systemctl --user status openclaw-gateway --no-pager | sed -n '1,20p'

echo "GitHub webhook URL: ${PUBLIC_WEBHOOK_URL}"
echo "Secrets file: /home/${ADMIN_USER}/.openclaw/github-bridge-secrets.txt"
