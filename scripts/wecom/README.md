# WeCom API Bridge (OpenClaw)

This bundle sets up:

1. A WeCom callback bridge endpoint (`/wecom/callback`) that verifies and decrypts WeCom API callbacks.
2. Forwarding from WeCom callback messages into your OpenClaw gateway via hooks.
3. Optional upload of generated config to Aliyun OSS.

## What this solves

- WeCom "API mode" requires URL verification (`URL`, `Token`, `EncodingAESKey`) and encrypted callback handling.
- OpenClaw hooks are JSON-based; this bridge converts WeCom XML/encrypted payloads to JSON and forwards to OpenClaw.

## Files

- `scripts/wecom/wecom_callback_bridge.mjs` - callback bridge server
- `scripts/wecom/setup_wecom_bridge.sh` - generates config + starts bridge
- `scripts/wecom/push_wecom_config_to_oss.sh` - uploads config JSON to OSS

## Quick start

```bash
cd /Users/jack/code/099-github/openclaw
bash scripts/wecom/setup_wecom_bridge.sh \
  --public-base "http://robot.cpt-fit.com:17310" \
  --openclaw-hook-token "YOUR_OPENCLAW_HOOK_TOKEN"
```

After running, copy values from:

- `~/.openclaw/bootstrap/wecom-api-config.json`

and fill your WeCom page:

- URL = `public_base + /wecom/callback`
- Token = generated value
- EncodingAESKey = generated value

## OSS upload

```bash
bash scripts/wecom/push_wecom_config_to_oss.sh \
  --source "$HOME/.openclaw/bootstrap/wecom-api-config.json" \
  --oss-uri "oss://YOUR_BUCKET/path/wecom-api-config.json"
```

Requires `ossutil` or `aliyun` CLI already configured.

## Runtime env

Bridge env file:

- `~/.openclaw/bootstrap/wecom-bridge.env`

Bridge log:

- `~/.openclaw/bootstrap/wecom-bridge.log`

## Notes

- This bridge only handles callback verification + inbound relay.
- If you need proactive WeCom send API (`message/send`), add corp credentials and a send path separately.
