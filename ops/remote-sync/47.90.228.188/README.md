# Remote Sync Snapshot (47.90.228.188)

This folder stores incrementally synced runtime artifacts from the Aliyun OpenClaw host.

## Included

- `config/openclaw.redacted.json` - runtime config with secrets redacted
- `extensions/wecom/` - deployed WeCom plugin source snapshot
- `extensions/github-webhook-bridge/` - deployed GitHub webhook bridge source snapshot
- `systemd/openclaw-gateway.service` - user service unit snapshot

## Notes

- Secrets are intentionally not stored in this repo snapshot.
- Use `scripts/sync/remote/pull_openclaw_snapshot.sh` to refresh incrementally.
