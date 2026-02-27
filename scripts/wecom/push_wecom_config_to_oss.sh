#!/usr/bin/env bash
set -euo pipefail

SOURCE="${HOME}/.openclaw/bootstrap/wecom-api-config.json"
OSS_URI=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --oss-uri) OSS_URI="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$SOURCE" ]]; then
  echo "[ERR] source file not found: $SOURCE" >&2
  exit 1
fi
if [[ -z "$OSS_URI" ]]; then
  echo "[ERR] --oss-uri is required, e.g. oss://bucket/path/wecom-api-config.json" >&2
  exit 1
fi

if command -v ossutil >/dev/null 2>&1; then
  ossutil cp "$SOURCE" "$OSS_URI" --force
  echo "[OK] uploaded by ossutil: $OSS_URI"
  exit 0
fi

if command -v aliyun >/dev/null 2>&1; then
  aliyun oss cp "$SOURCE" "$OSS_URI" --force
  echo "[OK] uploaded by aliyun: $OSS_URI"
  exit 0
fi

echo "[ERR] neither ossutil nor aliyun CLI is installed/configured" >&2
exit 2
