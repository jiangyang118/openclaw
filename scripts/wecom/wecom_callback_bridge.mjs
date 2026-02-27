#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

const PORT = Number(process.env.WECOM_BRIDGE_PORT || 18888);
const CALLBACK_PATH = process.env.WECOM_CALLBACK_PATH || "/wecom/callback";
const TOKEN = process.env.WECOM_CALLBACK_TOKEN || "";
const ENCODING_AES_KEY = process.env.WECOM_CALLBACK_AES_KEY || "";
const OPENCLAW_HOOK_BASE = process.env.OPENCLAW_HOOK_BASE || "http://127.0.0.1:18789";
const OPENCLAW_HOOK_PATH = process.env.OPENCLAW_HOOK_PATH || "/hooks/wecom";
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || "";
const REQUEST_TIMEOUT_MS = Number(process.env.WECOM_FORWARD_TIMEOUT_MS || 8000);

if (!TOKEN || !ENCODING_AES_KEY || !OPENCLAW_HOOK_TOKEN) {
  console.error(
    "[wecom-bridge] missing required env: WECOM_CALLBACK_TOKEN / WECOM_CALLBACK_AES_KEY / OPENCLAW_HOOK_TOKEN"
  );
  process.exit(2);
}

const AES_KEY = Buffer.from(`${ENCODING_AES_KEY}=`, "base64");
if (AES_KEY.length !== 32) {
  console.error("[wecom-bridge] invalid WECOM_CALLBACK_AES_KEY length");
  process.exit(2);
}

function computeSignature({ token, timestamp, nonce, encrypt }) {
  const raw = [token, timestamp, nonce, encrypt].sort().join("");
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad <= 0 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}

function decryptWecom(cipherTextBase64) {
  const encrypted = Buffer.from(cipherTextBase64, "base64");
  const iv = AES_KEY.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", AES_KEY, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const unpadded = pkcs7Unpad(plain);

  const msgLen = unpadded.readUInt32BE(16);
  const msgStart = 20;
  const msgEnd = msgStart + msgLen;
  const msg = unpadded.subarray(msgStart, msgEnd).toString("utf8");
  const receiveId = unpadded.subarray(msgEnd).toString("utf8");
  return { msg, receiveId };
}

function xmlValue(xml, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>|<${tag}>(.*?)<\\/${tag}>`, "s");
  const m = xml.match(re);
  if (!m) return "";
  return (m[1] || m[2] || "").trim();
}

async function forwardToOpenClaw(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENCLAW_HOOK_BASE}${OPENCLAW_HOOK_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENCLAW_HOOK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`forward failed ${res.status}: ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendText(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (u.pathname !== CALLBACK_PATH) {
      return sendText(res, 404, "Not Found");
    }

    const msgSignature = u.searchParams.get("msg_signature") || "";
    const timestamp = u.searchParams.get("timestamp") || "";
    const nonce = u.searchParams.get("nonce") || "";
    const echostr = u.searchParams.get("echostr") || "";

    if (req.method === "GET") {
      if (!echostr) return sendText(res, 200, "wecom bridge ok");
      const expected = computeSignature({ token: TOKEN, timestamp, nonce, encrypt: echostr });
      if (!msgSignature || expected !== msgSignature) return sendText(res, 401, "Invalid signature");
      const { msg } = decryptWecom(echostr);
      return sendText(res, 200, msg);
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const encrypted = xmlValue(body, "Encrypt");
      if (!encrypted) return sendText(res, 400, "Missing Encrypt");

      const expected = computeSignature({ token: TOKEN, timestamp, nonce, encrypt: encrypted });
      if (!msgSignature || expected !== msgSignature) return sendText(res, 401, "Invalid signature");

      const { msg: plainXml, receiveId } = decryptWecom(encrypted);
      const payload = {
        source: "wecom-callback",
        receivedAt: new Date().toISOString(),
        receiveId,
        MsgType: xmlValue(plainXml, "MsgType"),
        Event: xmlValue(plainXml, "Event"),
        FromUserName: xmlValue(plainXml, "FromUserName"),
        ToUserName: xmlValue(plainXml, "ToUserName"),
        CreateTime: xmlValue(plainXml, "CreateTime"),
        Content: xmlValue(plainXml, "Content"),
        MsgId: xmlValue(plainXml, "MsgId"),
        AgentID: xmlValue(plainXml, "AgentID"),
        rawXml: plainXml,
      };

      try {
        await forwardToOpenClaw(payload);
      } catch (err) {
        console.error("[wecom-bridge] forward error:", err?.message || err);
      }
      return sendText(res, 200, "success");
    }

    return sendText(res, 405, "Method Not Allowed");
  } catch (err) {
    console.error("[wecom-bridge] request error:", err?.message || err);
    return sendText(res, 500, "Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[wecom-bridge] listening on :${PORT}${CALLBACK_PATH}, forwarding to ${OPENCLAW_HOOK_BASE}${OPENCLAW_HOOK_PATH}`
  );
});
