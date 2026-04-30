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

  // "Fake streaming": si el cliente pide stream:true, lo apagamos para el worker
  // y al final formatemos la respuesta completa como un único bloque SSE.
  let fakeStream = false;
  let parsedBody = null;
  if (body) {
    try { parsedBody = JSON.parse(body); } catch {}
    if (parsedBody && parsedBody.stream === true) {
      fakeStream = true;
      parsedBody.stream = false;
      body = JSON.stringify(parsedBody);
    }
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

  const responseHeaders = { ...cors };
  for (const [k, v] of Object.entries(resp.headers || {})) {
    const lc = k.toLowerCase();
    if (["content-encoding", "transfer-encoding", "connection", "content-length"].includes(lc)) continue;
    if (lc.startsWith("access-control-")) continue;
    if (fakeStream && lc === "content-type") continue;
    responseHeaders[k] = v;
  }

  if (fakeStream && resp.status >= 200 && resp.status < 300) {
    const obj = typeof resp.body === "string"
      ? (() => { try { return JSON.parse(resp.body); } catch { return null; } })()
      : resp.body;
    if (obj) {
      const events = buildFakeStream(target.provider, obj);
      responseHeaders["Content-Type"] = "text/event-stream; charset=utf-8";
      responseHeaders["Cache-Control"] = "no-cache, no-transform";
      responseHeaders["X-Accel-Buffering"] = "no";
      const enc = new TextEncoder();
      let i = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          if (i < events.length) {
            controller.enqueue(enc.encode(events[i++]));
            await new Promise((r) => setTimeout(r, 8));
          } else {
            controller.close();
          }
        },
      });
      return new Response(stream, { status: resp.status, headers: responseHeaders });
    }
  }

  const responseBody = typeof resp.body === "string"
    ? resp.body
    : JSON.stringify(resp.body);
  if (!responseHeaders["Content-Type"] && !responseHeaders["content-type"]) {
    responseHeaders["Content-Type"] = "application/json";
  }
  return new Response(responseBody, {
    status: resp.status,
    headers: responseHeaders,
  });
};

function sseEvent(name, data) {
  let out = "";
  if (name) out += "event: " + name + "\n";
  out += "data: " + JSON.stringify(data) + "\n\n";
  return out;
}

const TEXT_CHUNK = 40;

function chunkText(text) {
  const out = [];
  if (!text) return [""];
  for (let i = 0; i < text.length; i += TEXT_CHUNK) {
    out.push(text.slice(i, i + TEXT_CHUNK));
  }
  return out;
}

function buildFakeStream(provider, full) {
  if (provider === "anthropic") return buildAnthropicStream(full);
  return buildOpenAIStream(full);
}

function buildAnthropicStream(msg) {
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  const events = [];

  events.push(sseEvent("message_start", {
    type: "message_start",
    message: {
      id: msg.id,
      type: msg.type || "message",
      role: msg.role || "assistant",
      model: msg.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: msg.usage || { input_tokens: 0, output_tokens: 0 },
    },
  }));

  blocks.forEach((block, idx) => {
    if (block.type === "text") {
      events.push(sseEvent("content_block_start", {
        type: "content_block_start",
        index: idx,
        content_block: { type: "text", text: "" },
      }));
      for (const piece of chunkText(block.text || "")) {
        events.push(sseEvent("content_block_delta", {
          type: "content_block_delta",
          index: idx,
          delta: { type: "text_delta", text: piece },
        }));
      }
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: idx,
      }));
    } else {
      events.push(sseEvent("content_block_start", {
        type: "content_block_start",
        index: idx,
        content_block: block,
      }));
      events.push(sseEvent("content_block_stop", {
        type: "content_block_stop",
        index: idx,
      }));
    }
  });

  events.push(sseEvent("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: msg.stop_reason || "end_turn",
      stop_sequence: msg.stop_sequence ?? null,
    },
    usage: { output_tokens: msg.usage?.output_tokens ?? 0 },
  }));

  events.push(sseEvent("message_stop", { type: "message_stop" }));

  return events;
}

function buildOpenAIStream(resp) {
  const id = resp.id || "chatcmpl-" + Math.random().toString(36).slice(2, 12);
  const created = resp.created || Math.floor(Date.now() / 1000);
  const model = resp.model || "";
  const choices = Array.isArray(resp.choices) ? resp.choices : [];
  const events = [];

  if (choices.length) {
    const initial = choices.map((c, i) => ({
      index: c.index ?? i,
      delta: { role: "assistant", content: "" },
      logprobs: null,
      finish_reason: null,
    }));
    events.push("data: " + JSON.stringify({
      id, object: "chat.completion.chunk", created, model,
      choices: initial,
    }) + "\n\n");
  }

  // Chunks de content reales — uno por cada trozo de texto
  for (let ci = 0; ci < choices.length; ci++) {
    const c = choices[ci];
    const content = (c.message && c.message.content) || "";
    const pieces = chunkText(content);
    for (const piece of pieces) {
      events.push("data: " + JSON.stringify({
        id, object: "chat.completion.chunk", created, model,
        choices: [{
          index: c.index ?? ci,
          delta: { content: piece },
          logprobs: null,
          finish_reason: null,
        }],
      }) + "\n\n");
    }
  }

  const finalChunk = choices.map((c, i) => ({
    index: c.index ?? i,
    delta: {},
    logprobs: null,
    finish_reason: c.finish_reason || "stop",
  }));
  events.push("data: " + JSON.stringify({
    id, object: "chat.completion.chunk", created, model,
    choices: finalChunk,
    usage: resp.usage,
  }) + "\n\n");

  events.push("data: [DONE]\n\n");
  return events;
}
