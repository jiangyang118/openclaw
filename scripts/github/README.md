# GitHub Integration (OpenClaw on Aliyun)

This directory adds a GitHub webhook bridge for OpenClaw deployments that already run WeCom/Feishu.

## What is included

- `github-webhook-bridge-plugin/`
  - OpenClaw plugin that verifies GitHub `X-Hub-Signature-256`
  - Exposes `GET/POST /github/webhook`
  - Forwards validated events to OpenClaw `POST /hooks/github`
- `setup_github_bridge.sh`
  - Server-side setup script (OpenClaw 2026.2.9-compatible hooks schema)

## Abilities covered

- GitHub webhook ingestion (`/github/webhook`)
- Issue/PR workflow trigger into OpenClaw via hooks mapping
- Foundation for `gh`/`git` based repo read-write + issue/PR comments

## Run (on server)

```bash
cd /path/to/openclaw
bash scripts/github/setup_github_bridge.sh
```

After setup, check:

```bash
curl -i http://127.0.0.1:17310/github/webhook
# expect: 200 ok
```

## GitHub side settings

Configure your repository/org webhook as:

- URL: `http://robot.cpt-fit.com:17310/github/webhook`
- Content type: `application/json`
- Secret: value of `WEBHOOK_SECRET` in `/home/admin/.openclaw/github-bridge-secrets.txt`
- Events: `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `push` (and `ping` for test)

## For issue/pr comment + repo read-write

Install/login GitHub CLI on server and provide a PAT with at least:

- `repo` (private repo read/write)
- `read:org` (if org-level repo operations are needed)

Then:

```bash
gh auth login --with-token
```

Use OpenClaw/agent shell tools to run `gh issue ...`, `gh pr ...`, `git push`, etc.
