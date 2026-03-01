# Youdao OAuth Helper

This plugin adds two HTTP endpoints to your OpenClaw Gateway:

- `GET <basePath>/start`
- `GET <basePath>/callback`

Default `basePath` is `/youdao/oauth`.

## Why this exists

Youdao `client_id` and `client_secret` are issued by Youdao OpenAPI after you create an app.
This plugin does not generate them; it helps you complete OAuth on your own gateway host.

## Install (local path)

```bash
openclaw plugins install ./extensions/youdao-oauth-helper
openclaw config set plugins.entries.youdao-oauth-helper.enabled true --json
```

## Configure

```bash
openclaw config set plugins.entries.youdao-oauth-helper.config.clientId '"YOUR_CONSUMER_KEY"' --json
openclaw config set plugins.entries.youdao-oauth-helper.config.clientSecret '"YOUR_CONSUMER_SECRET"' --json
openclaw config set plugins.entries.youdao-oauth-helper.config.redirectUri '"http://YOUR_HOST:17310/youdao/oauth/callback"' --json
```

Optional:

```bash
openclaw config set plugins.entries.youdao-oauth-helper.config.basePath '"/youdao/oauth"' --json
openclaw config set plugins.entries.youdao-oauth-helper.config.stateTtlSeconds 600 --json
openclaw config set plugins.entries.youdao-oauth-helper.config.strictState true --json
```

## OAuth flow

1. Open:

```text
http://YOUR_HOST:17310/youdao/oauth/start
```

2. You will be redirected to Youdao authorization.
3. After consent, Youdao redirects back to `/callback`.
4. Callback page shows `accessToken` (this is your `oauth_token`).

For JSON mode:

```text
http://YOUR_HOST:17310/youdao/oauth/start?mode=json
http://YOUR_HOST:17310/youdao/oauth/callback?code=...&state=...&format=json
```
