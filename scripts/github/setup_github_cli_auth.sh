#!/usr/bin/env bash
set -euo pipefail

# Configure GitHub CLI auth for issue/pr comments and repo read-write.
# Usage:
#   export GITHUB_PAT=ghp_xxx
#   bash scripts/github/setup_github_cli_auth.sh

if [[ -z "${GITHUB_PAT:-}" ]]; then
  echo "GITHUB_PAT is required" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  ver=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | jq -r .tag_name)
  v=${ver#v}
  cd /tmp
  curl -fsSLo gh.tgz -L "https://github.com/cli/cli/releases/download/${ver}/gh_${v}_linux_amd64.tar.gz"
  rm -rf gh_extract && mkdir gh_extract
  tar -xzf gh.tgz -C gh_extract
  sudo install -m 755 "gh_extract/gh_${v}_linux_amd64/bin/gh" /usr/local/bin/gh
fi

printf '%s' "$GITHUB_PAT" | gh auth login --hostname github.com --with-token

gh auth status

git config --global credential.helper store
git config --global user.name "${GIT_USER_NAME:-openclaw-bot}"
git config --global user.email "${GIT_USER_EMAIL:-openclaw-bot@users.noreply.github.com}"

echo "GitHub CLI auth configured."
