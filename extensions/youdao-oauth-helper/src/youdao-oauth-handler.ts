import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginLogger } from "openclaw/plugin-sdk";

const YOUDAO_AUTHORIZE_URL = "https://note.youdao.com/oauth/authorize2";
const YOUDAO_ACCESS_URL = "https://note.youdao.com/oauth/access2";
const DEFAULT_BASE_PATH = "/youdao/oauth";
const DEFAULT_STATE_TTL_SECONDS = 600;

type YoudaoOauthStateEntry = {
  createdAtMs: number;
  redirectUri: string;
};

type YoudaoOauthTokenResponse = {
  accessToken?: unknown;
  access_token?: unknown;
  refreshToken?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  message?: unknown;
} & Record<string, unknown>;

export type YoudaoOauthResolvedConfig = {
  basePath: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  stateTtlSeconds: number;
  strictState: boolean;
  warnings: string[];
};

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return undefined;
}

function normalizeBasePath(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_BASE_PATH;
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  const normalized = prefixed.replace(/\/+$/u, "");
  return normalized || DEFAULT_BASE_PATH;
}

function isValidAbsoluteUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function jsonContentType(req: IncomingMessage): boolean {
  const accept = req.headers.accept;
  const value = Array.isArray(accept) ? accept.join(",") : (accept ?? "");
  return value.toLowerCase().includes("application/json");
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return asTrimmedString(value[0]);
  }
  return asTrimmedString(value);
}

function inferRequestBaseUrl(req: IncomingMessage): string | undefined {
  const host =
    firstHeaderValue(req.headers["x-forwarded-host"]) ?? firstHeaderValue(req.headers.host);
  if (!host) {
    return undefined;
  }

  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shouldReturnJson(req: IncomingMessage, url: URL): boolean {
  const fmt = asTrimmedString(url.searchParams.get("format"))?.toLowerCase();
  if (fmt === "json") {
    return true;
  }
  return jsonContentType(req);
}

function resolveRedirectUri(
  req: IncomingMessage,
  params: {
    callbackPath: string;
    explicit?: string;
    fallback?: string;
  },
): string | undefined {
  const explicit = asTrimmedString(params.explicit);
  if (explicit && isValidAbsoluteUrl(explicit)) {
    return explicit;
  }

  const fallback = asTrimmedString(params.fallback);
  if (fallback && isValidAbsoluteUrl(fallback)) {
    return fallback;
  }

  const baseUrl = inferRequestBaseUrl(req);
  if (!baseUrl) {
    return undefined;
  }
  return `${baseUrl}${params.callbackPath}`;
}

function extractToken(payload: YoudaoOauthTokenResponse): {
  accessToken?: string;
  refreshToken?: string;
} {
  const accessTokenRaw = payload.accessToken ?? payload.access_token;
  const refreshTokenRaw = payload.refreshToken ?? payload.refresh_token;
  return {
    accessToken: asTrimmedString(accessTokenRaw),
    refreshToken: asTrimmedString(refreshTokenRaw),
  };
}

function maskToken(value: string): string {
  if (value.length < 10) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(YOUDAO_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ ok: true; payload: YoudaoOauthTokenResponse } | { ok: false; error: string }> {
  const url = new URL(YOUDAO_ACCESS_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("client_secret", params.clientSecret);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code", params.code);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain;q=0.9",
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: `Failed to call Youdao token endpoint: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    return {
      ok: false,
      error: `Token endpoint returned non-JSON response (HTTP ${response.status}).`,
    };
  }

  if (!response.ok) {
    const rec = toRecord(payload);
    return {
      ok: false,
      error: `Token endpoint HTTP ${response.status}: ${String(rec.message ?? rec.error ?? "unknown error")}`,
    };
  }

  const rec = toRecord(payload) as YoudaoOauthTokenResponse;
  if (asTrimmedString(rec.error)) {
    return {
      ok: false,
      error: `Youdao returned error ${String(rec.error)}: ${String(rec.message ?? "unknown error")}`,
    };
  }

  return { ok: true, payload: rec };
}

function readQueryString(url: URL, key: string): string | undefined {
  return asTrimmedString(url.searchParams.get(key));
}

function cleanupStates(stateStore: Map<string, YoudaoOauthStateEntry>, ttlMs: number): void {
  const now = Date.now();
  for (const [state, entry] of stateStore.entries()) {
    if (now - entry.createdAtMs > ttlMs) {
      stateStore.delete(state);
    }
  }
}

function errorPayload(message: string, details?: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: false,
    error: message,
    ...(details ? { details } : {}),
  };
}

function renderSuccessHtml(params: {
  accessToken?: string;
  refreshToken?: string;
  payload: YoudaoOauthTokenResponse;
}): string {
  const payloadText = JSON.stringify(params.payload, null, 2);
  const accessBlock = params.accessToken
    ? `<p><strong>accessToken</strong> (copy this):</p><textarea readonly rows="3" style="width:100%;font-family:monospace;">${escapeHtml(params.accessToken)}</textarea>`
    : "<p>No accessToken found in response payload.</p>";
  const refreshBlock = params.refreshToken
    ? `<p><strong>refreshToken</strong> (optional): ${escapeHtml(maskToken(params.refreshToken))}</p>`
    : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Youdao OAuth Success</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; line-height: 1.4;">
    <h2>Youdao OAuth Success</h2>
    <p>Authorization code exchange completed.</p>
    ${accessBlock}
    ${refreshBlock}
    <details>
      <summary>Raw response payload</summary>
      <pre style="white-space: pre-wrap;">${escapeHtml(payloadText)}</pre>
    </details>
  </body>
</html>`;
}

function renderErrorHtml(message: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Youdao OAuth Error</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; line-height: 1.4;">
    <h2>Youdao OAuth Error</h2>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`;
}

export function resolveYoudaoOauthConfig(raw: unknown): YoudaoOauthResolvedConfig {
  const cfg = toRecord(raw);
  const warnings: string[] = [];

  const basePath = normalizeBasePath(asTrimmedString(cfg.basePath));
  const clientId = asTrimmedString(cfg.clientId);
  const clientSecret = asTrimmedString(cfg.clientSecret);

  const redirectUriRaw = asTrimmedString(cfg.redirectUri);
  let redirectUri: string | undefined;
  if (redirectUriRaw) {
    if (isValidAbsoluteUrl(redirectUriRaw)) {
      redirectUri = redirectUriRaw;
    } else {
      warnings.push("config.redirectUri is not a valid absolute URL; it will be ignored.");
    }
  }

  const ttlInput = asPositiveInteger(cfg.stateTtlSeconds) ?? DEFAULT_STATE_TTL_SECONDS;
  const stateTtlSeconds = Math.min(86_400, Math.max(60, ttlInput));
  const strictState = asBoolean(cfg.strictState) ?? true;

  return {
    basePath,
    clientId,
    clientSecret,
    redirectUri,
    stateTtlSeconds,
    strictState,
    warnings,
  };
}

export function createYoudaoOauthHttpHandler(params: {
  logger: PluginLogger;
  config: YoudaoOauthResolvedConfig;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { logger, config } = params;
  const startPath = `${config.basePath}/start`;
  const callbackPath = `${config.basePath}/callback`;
  const stateStore = new Map<string, YoudaoOauthStateEntry>();
  const stateTtlMs = config.stateTtlSeconds * 1000;

  return async (req, res): Promise<boolean> => {
    const parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = (req.method ?? "GET").toUpperCase();
    const pathname = parsedUrl.pathname.replace(/\/+$/u, "") || "/";

    if (pathname !== startPath && pathname !== callbackPath) {
      return false;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed");
      return true;
    }

    cleanupStates(stateStore, stateTtlMs);

    if (pathname === startPath) {
      const clientId = readQueryString(parsedUrl, "client_id") ?? config.clientId;
      if (!clientId) {
        const message =
          "Missing client_id. Set plugins.entries.youdao-oauth-helper.config.clientId or pass ?client_id=.";
        if (shouldReturnJson(req, parsedUrl)) {
          sendJson(res, 400, errorPayload(message));
        } else {
          sendHtml(res, 400, renderErrorHtml(message));
        }
        return true;
      }

      const redirectUri = resolveRedirectUri(req, {
        callbackPath,
        explicit: readQueryString(parsedUrl, "redirect_uri"),
        fallback: config.redirectUri,
      });
      if (!redirectUri) {
        const message =
          "Could not resolve redirect_uri. Set plugins.entries.youdao-oauth-helper.config.redirectUri.";
        if (shouldReturnJson(req, parsedUrl)) {
          sendJson(res, 400, errorPayload(message));
        } else {
          sendHtml(res, 400, renderErrorHtml(message));
        }
        return true;
      }

      const state = readQueryString(parsedUrl, "state") ?? randomBytes(18).toString("base64url");
      stateStore.set(state, {
        createdAtMs: Date.now(),
        redirectUri,
      });

      const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state });
      const mode = readQueryString(parsedUrl, "mode")?.toLowerCase() ?? "redirect";

      if (mode === "json" || shouldReturnJson(req, parsedUrl)) {
        sendJson(res, 200, {
          ok: true,
          authorizeUrl,
          state,
          redirectUri,
          expiresInSeconds: config.stateTtlSeconds,
        });
        return true;
      }

      res.statusCode = 302;
      res.setHeader("Location", authorizeUrl);
      res.end("Redirecting to Youdao OAuth authorization page.");
      return true;
    }

    const code = readQueryString(parsedUrl, "code");
    const state = readQueryString(parsedUrl, "state");
    if (!code) {
      const message = "Missing code in callback query.";
      if (shouldReturnJson(req, parsedUrl)) {
        sendJson(res, 400, errorPayload(message));
      } else {
        sendHtml(res, 400, renderErrorHtml(message));
      }
      return true;
    }

    const stateEntry = state ? stateStore.get(state) : undefined;
    if (config.strictState) {
      if (!state) {
        const message = "Missing state in callback. Use /start endpoint to initiate OAuth.";
        if (shouldReturnJson(req, parsedUrl)) {
          sendJson(res, 400, errorPayload(message));
        } else {
          sendHtml(res, 400, renderErrorHtml(message));
        }
        return true;
      }
      if (!stateEntry) {
        const message =
          "Invalid or expired state. Retry OAuth from /start to generate a fresh state token.";
        if (shouldReturnJson(req, parsedUrl)) {
          sendJson(res, 400, errorPayload(message));
        } else {
          sendHtml(res, 400, renderErrorHtml(message));
        }
        return true;
      }
    }
    if (state) {
      stateStore.delete(state);
    }

    const clientId = readQueryString(parsedUrl, "client_id") ?? config.clientId;
    const clientSecret = readQueryString(parsedUrl, "client_secret") ?? config.clientSecret;
    if (!clientId || !clientSecret) {
      const message =
        "Missing client credentials. Set plugins.entries.youdao-oauth-helper.config.clientId/clientSecret.";
      if (shouldReturnJson(req, parsedUrl)) {
        sendJson(res, 400, errorPayload(message));
      } else {
        sendHtml(res, 400, renderErrorHtml(message));
      }
      return true;
    }

    const redirectUri = resolveRedirectUri(req, {
      callbackPath,
      explicit: readQueryString(parsedUrl, "redirect_uri"),
      fallback: stateEntry?.redirectUri ?? config.redirectUri,
    });
    if (!redirectUri) {
      const message =
        "Could not resolve redirect_uri during token exchange. Set plugin config redirectUri.";
      if (shouldReturnJson(req, parsedUrl)) {
        sendJson(res, 400, errorPayload(message));
      } else {
        sendHtml(res, 400, renderErrorHtml(message));
      }
      return true;
    }

    const exchanged = await exchangeCode({ code, clientId, clientSecret, redirectUri });
    if (!exchanged.ok) {
      logger.warn(`[youdao-oauth-helper] token exchange failed: ${exchanged.error}`);
      if (shouldReturnJson(req, parsedUrl)) {
        sendJson(res, 502, errorPayload(exchanged.error));
      } else {
        sendHtml(res, 502, renderErrorHtml(exchanged.error));
      }
      return true;
    }

    const tokens = extractToken(exchanged.payload);
    if (tokens.accessToken) {
      logger.info(
        `[youdao-oauth-helper] token exchange succeeded (accessToken=${maskToken(tokens.accessToken)})`,
      );
    } else {
      logger.warn("[youdao-oauth-helper] token exchange response had no accessToken field.");
    }

    if (shouldReturnJson(req, parsedUrl)) {
      sendJson(res, 200, {
        ok: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        payload: exchanged.payload,
      });
      return true;
    }

    sendHtml(
      res,
      200,
      renderSuccessHtml({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        payload: exchanged.payload,
      }),
    );
    return true;
  };
}
