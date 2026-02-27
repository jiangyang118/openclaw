#!/usr/bin/env bash
set -euo pipefail

# Create/update GitHub webhook via gh api.
# Usage:
#   export GITHUB_PAT=...
#   bash scripts/github/create_repo_webhook.sh OWNER/REPO http://robot.cpt-fit.com:17310/github/webhook <WEBHOOK_SECRET>

REPO_SLUG="${1:-}"
WEBHOOK_URL="${2:-}"
WEBHOOK_SECRET="${3:-}"

if [[ -z "$REPO_SLUG" || -z "$WEBHOOK_URL" || -z "$WEBHOOK_SECRET" ]]; then
  echo "Usage: $0 OWNER/REPO WEBHOOK_URL WEBHOOK_SECRET" >&2
  exit 1
fi

if [[ -n "${GITHUB_PAT:-}" ]]; then
  printf '%s' "$GITHUB_PAT" | gh auth login --hostname github.com --with-token >/dev/null 2>&1 || true
fi

gh auth status >/dev/null

# Try to find existing webhook with same URL.
existing_id="$(gh api "repos/${REPO_SLUG}/hooks" --jq ".[] | select(.config.url == \"${WEBHOOK_URL}\") | .id" | head -n1 || true)"

payload='{"name":"web","active":true,"events":["ping","issues","issue_comment","pull_request","pull_request_review","push"],"config":{"url":"'"${WEBHOOK_URL}"'","content_type":"json","secret":"'"${WEBHOOK_SECRET}"'","insecure_ssl":"0"}}'

if [[ -n "$existing_id" ]]; then
  gh api --method PATCH "repos/${REPO_SLUG}/hooks/${existing_id}" --input - <<<"$payload" >/dev/null
  echo "Updated webhook id=${existing_id} for ${REPO_SLUG}"
else
  gh api --method POST "repos/${REPO_SLUG}/hooks" --input - <<<"$payload" >/dev/null
  echo "Created webhook for ${REPO_SLUG}"
fi
