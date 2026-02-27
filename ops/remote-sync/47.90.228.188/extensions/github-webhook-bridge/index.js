import crypto from "node:crypto";

function normalizePath(input) {
  const raw = typeof input === "string" && input.trim() ? input.trim() : "/github/webhook";
  let path = raw.startsWith("/") ? raw : `/${raw}`;
  path = path.replace(/\/+/g, "/");
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

function toArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function parseJson(body) {
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function parseRepo(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const repo = payload.repository;
  if (repo && typeof repo === "object" && typeof repo.full_name === "string") {
    return repo.full_name;
  }
  return "";
}

function parseAction(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  return typeof payload.action === "string" ? payload.action : "";
}

function parseTitle(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const issue = payload.issue;
  if (issue && typeof issue === "object" && typeof issue.title === "string") {
    return issue.title;
  }

  const pr = payload.pull_request;
  if (pr && typeof pr === "object" && typeof pr.title === "string") {
    return pr.title;
  }

  const comment = payload.comment;
  if (comment && typeof comment === "object" && typeof comment.body === "string") {
    const line = comment.body.split(/\r?\n/, 1)[0] || "";
    return line.slice(0, 160);
  }

  const head = payload.head_commit;
  if (head && typeof head === "object" && typeof head.message === "string") {
    const line = head.message.split(/\r?\n/, 1)[0] || "";
    return line.slice(0, 160);
  }

  return "";
}

function buildForwardPayload(params) {
  const {
    event,
    delivery,
    payload,
  } = params;

  return {
    source: "github",
    event,
    delivery,
    action: parseAction(payload),
    repository: parseRepo(payload),
    title: parseTitle(payload),
    payload,
  };
}

const plugin = {
  id: "github-webhook-bridge",
  name: "GitHub Webhook Bridge",
  description: "Verify GitHub webhook signatures and forward events to OpenClaw hooks",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" },
      forwardUrl: { type: "string" },
      webhookSecret: { type: "string" },
      hooksToken: { type: "string" },
      allowedEvents: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  register(api) {
    const cfg = api.pluginConfig || {};
    const routePath = normalizePath(cfg.path);
    const forwardUrl =
      typeof cfg.forwardUrl === "string" && cfg.forwardUrl.trim()
        ? cfg.forwardUrl.trim()
        : "http://127.0.0.1:17310/hooks/github";
    const webhookSecret =
      typeof cfg.webhookSecret === "string" && cfg.webhookSecret.trim()
        ? cfg.webhookSecret.trim()
        : "";
    const hooksToken =
      typeof cfg.hooksToken === "string" && cfg.hooksToken.trim()
        ? cfg.hooksToken.trim()
        : "";
    const allowedEvents = toArray(cfg.allowedEvents);

    if (!webhookSecret) {
      api.logger.warn("[github-webhook-bridge] webhookSecret is empty; all webhook requests will be rejected");
    }
    if (!hooksToken) {
      api.logger.warn("[github-webhook-bridge] hooksToken is empty; forwarding will fail");
    }

    api.logger.info(
      `[github-webhook-bridge] registered at ${routePath}, forwarding to ${forwardUrl}`,
    );

    api.registerHttpHandler(async (req, res) => {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const path = normalizePath(url.pathname);
      if (path !== routePath) {
        return false;
      }

      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return true;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return true;
      }

      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const bodyBuffer = Buffer.concat(chunks);
      const body = bodyBuffer.toString("utf8");

      const event = String(req.headers["x-github-event"] || "").trim();
      const delivery = String(req.headers["x-github-delivery"] || "").trim();
      const signature = String(req.headers["x-hub-signature-256"] || "").trim();

      if (!webhookSecret) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("webhook secret not configured");
        return true;
      }

      if (!signature.startsWith("sha256=")) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("missing signature");
        return true;
      }

      const expected = `sha256=${crypto
        .createHmac("sha256", webhookSecret)
        .update(bodyBuffer)
        .digest("hex")}`;

      if (!timingSafeEqualHex(signature, expected)) {
        api.logger.warn("[github-webhook-bridge] signature mismatch", {
          event,
          delivery,
        });
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("invalid signature");
        return true;
      }

      if (allowedEvents.length > 0 && !allowedEvents.includes(event)) {
        res.writeHead(202, { "Content-Type": "text/plain" });
        res.end("ignored event");
        return true;
      }

      const payload = parseJson(body);
      if (payload === null) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("invalid json");
        return true;
      }

      if (!hooksToken) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("hooks token not configured");
        return true;
      }

      const forwardPayload = buildForwardPayload({ event, delivery, payload });

      try {
        const forwardResp = await fetch(forwardUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${hooksToken}`,
            "x-github-event": event,
            "x-github-delivery": delivery,
          },
          body: JSON.stringify(forwardPayload),
        });

        if (!forwardResp.ok) {
          const text = await forwardResp.text();
          api.logger.error("[github-webhook-bridge] forward failed", {
            status: forwardResp.status,
            event,
            delivery,
            text: text.slice(0, 300),
          });
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("forward failed");
          return true;
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return true;
      } catch (error) {
        api.logger.error("[github-webhook-bridge] forward exception", {
          event,
          delivery,
          error: error instanceof Error ? error.message : String(error),
        });
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("forward exception");
        return true;
      }
    });
  },
};

export default plugin;
export const register = (api) => plugin.register(api);
