import { getStore } from "@netlify/blobs";

export const config = {
  path: ["/v1/*", "/anthropic/*", "/openai/*"],
};

const ACTIVE = "jobs-active";
const ARCHIVE = "jobs-archive";
const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 250;

const HOSTS = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, anthropic-version, anthropic-beta, Authorization, OpenAI-Organization, OpenAI-Project, OpenAI-Beta, User-Agent",
  "Access-Control-Expose-Headers": "*",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

function extractClientToken(req) {
  const x = req.headers.get("x-api-key");
  if (x) return x;
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function detectTarget(pathname, headers) {
  if (pathname.startsWith("/anthropic/")) {
    return { provider: "anthropic", apiPath: pathname.slice("/anthropic".length) || "/" };
  }
  if (pathname.startsWith("/openai/")) {
    return { provider: "openai", apiPath: pathname.slice("/openai".length) || "/" };
  }

  if (pathname === "/v1/messages" ||
      pathname.startsWith("/v1/messages/") ||
      pathname === "/v1/messages/batches" ||
      pathname.startsWith("/v1/messages/batches/") ||
      pathname.startsWith("/v1/complete")) {
    return { provider: "anthropic", apiPath: pathname };
  }

  if (pathname.startsWith("/v1/chat/") ||
      pathname.startsWith("/v1/completions") ||
      pathname.startsWith("/v1/embeddings") ||
      pathname.startsWith("/v1/audio/") ||
      pathname.startsWith("/v1/images/") ||
      pathname.startsWith("/v1/files") ||
      pathname.startsWith("/v1/moderations") ||
      pathname.startsWith("/v1/fine_tuning") ||
      pathname.startsWith("/v1/responses") ||
      pathname.startsWith("/v1/threads") ||
      pathname.startsWith("/v1/assistants") ||
      pathname.startsWith("/v1/uploads") ||
      pathname.startsWith("/v1/batches") ||
      pathname.startsWith("/v1/vector_stores") ||
      pathname.startsWith("/v1/organization")) {
    return { provider: "openai", apiPath: pathname };
  }

  if (headers.get("anthropic-version") || headers.get("anthropic-beta")) {
    return { provider: "anthropic", apiPath: pathname };
  }

  if (pathname === "/v1/models" || pathname.startsWith("/v1/models/")) {
    return { provider: "openai", apiPath: pathname };
  }

  return null;
}

const STRIP_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding",
  "accept-encoding", "x-forwarded-for", "x-real-ip",
  "x-forwarded-host", "x-forwarded-proto", "x-nf-client-connection-ip",
  "x-nf-request-id", "x-country", "x-language",
  "cdn-loop", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor",
  "x-nf-account-id", "x-nf-deploy-context", "x-nf-deploy-id",
  "x-nf-site-id", "x-nf-geo",
]);

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  const target = detectTarget(url.pathname, req.headers);
  if (!target) {
    return json({
      error: "no_route",
      message: "Ruta no reconocida. Usa /v1/messages (Anthropic) o /v1/chat/completions (OpenAI), o un prefijo explícito /anthropic/* o /openai/*.",
      pathname: url.pathname,
    }, 404);
  }

  const expectedToken = process.env.JOBS_CLIENT_TOKEN ?? "admin";
  if (expectedToken) {
    const got = extractClientToken(req);
    if (got !== expectedToken) {
      return json({
        error: "unauthorized",
        message: "Falta o no coincide la auth. Pasa el token de OpenChaw como 'x-api-key: <token>' (Anthropic) o 'Authorization: Bearer <token>' (OpenAI).",
      }, 401);
    }
  }

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const buf = await req.arrayBuffer();
      if (buf.byteLength) body = new TextDecoder().decode(buf);
    } catch {
      body = undefined;
    }
  }

  if (body && /"stream"\s*:\s*true/i.test(body)) {
    return json({
      error: "streaming_not_supported",
      message: "Streaming aún no está soportado en OpenChaw. Quita 'stream: true' del body.",
    }, 400);
  }

  const forwardHeaders = {};
  for (const [k, v] of req.headers) {
    const lc = k.toLowerCase();
    if (STRIP_HEADERS.has(lc)) continue;
    if (lc === "x-api-key" || lc === "authorization") continue;
    forwardHeaders[k] = v;
  }

  const targetUrl = HOSTS[target.provider] + target.apiPath + url.search;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    type: "http",
    request: {
      url: targetUrl,
      method: req.method,
      headers: forwardHeaders,
      body,
    },
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  const active = getStore({ name: ACTIVE, consistency: "strong" });
  const archive = getStore({ name: ARCHIVE, consistency: "strong" });

  await active.setJSON(id, job);

  const deadline = Date.now() + MAX_WAIT_MS;
  let done = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    done = await archive.get(id, { type: "json" });
    if (done) break;
  }

  if (!done) {
    return json({
      error: "timeout",
      message: `Sin resultado en ${MAX_WAIT_MS}ms. ¿Worker corriendo?`,
      id,
    }, 504);
  }

  archive.delete(id).catch(() => {});

  if (done.error) {
    return json({
      error: "worker_error",
      message: String(done.error),
      id,
    }, 502);
  }

  const resp = done.response;
  if (!resp) {
    return json({
      error: "empty_response",
      id,
    }, 502);
  }

  const responseBody = typeof resp.body === "string"
    ? resp.body
    : JSON.stringify(resp.body);

  const responseHeaders = { ...cors };
  for (const [k, v] of Object.entries(resp.headers || {})) {
    const lc = k.toLowerCase();
    if (["content-encoding", "transfer-encoding", "connection", "content-length"].includes(lc)) continue;
    if (lc.startsWith("access-control-")) continue;
    responseHeaders[k] = v;
  }
  if (!responseHeaders["Content-Type"] && !responseHeaders["content-type"]) {
    responseHeaders["Content-Type"] = "application/json";
  }

  return new Response(responseBody, {
    status: resp.status,
    headers: responseHeaders,
  });
};
