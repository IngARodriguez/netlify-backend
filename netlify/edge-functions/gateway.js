import { getStore } from "@netlify/blobs";

export const config = {
  path: ["/v1/*", "/anthropic/*", "/openai/*"],
};

const ACTIVE = "jobs-active";
const ARCHIVE = "jobs-archive";
const CHUNKS = "jobs-chunks";

// Edge Functions tienen cap de 30s wall time. Dejamos margen para emitir
// el último chunk y cerrar limpiamente antes de que la plataforma corte.
const EDGE_TIMEOUT_MS = 28_500;
const POLL_INTERVAL_MS = 250;
const HEARTBEAT_MS = 5_000;

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

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

const readEnv = (key) => {
  if (typeof Netlify !== "undefined" && Netlify.env?.get) return Netlify.env.get(key);
  if (typeof Deno !== "undefined" && Deno.env?.get) return Deno.env.get(key);
  return undefined;
};

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
    return new Response(null, { status: 204, headers: cors });
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

  const expectedToken = readEnv("JOBS_CLIENT_TOKEN") ?? "admin";
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

  // Streaming real: si el cliente pide stream:true, dejamos stream:true en el
  // body al provider y marcamos el job para que el worker haga chunked write.
  let realStream = false;
  let parsedBody = null;
  if (body) {
    try { parsedBody = JSON.parse(body); } catch {}
    if (parsedBody && parsedBody.stream === true) {
      realStream = true;
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
    streaming: realStream,
    createdAt: new Date().toISOString(),
  };

  const active = getStore({ name: ACTIVE, consistency: "strong" });
  const archive = getStore({ name: ARCHIVE, consistency: "strong" });
  const chunks = getStore({ name: CHUNKS, consistency: "strong" });

  await active.setJSON(id, job);

  if (realStream) {
    return streamRealChunks({ id, chunks, archive });
  }
  return streamResult({ id, archive });
};

function streamResult({ id, archive }) {
  const enc = new TextEncoder();
  const deadline = Date.now() + EDGE_TIMEOUT_MS;
  const heartbeat = " ";

  const stream = new ReadableStream({
    async start(controller) {
      let lastHeartbeat = Date.now();
      let closed = false;

      const tryEnqueue = (data) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(data)); }
        catch { closed = true; }
      };
      const tryClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      try {
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

          const done = await archive.get(id, { type: "json" });
          if (done) {
            archive.delete(id).catch(() => {});

            if (done.error) {
              tryEnqueue(JSON.stringify({
                error: "worker_error",
                message: String(done.error),
                id,
              }));
              tryClose();
              return;
            }

            const resp = done.response;
            if (!resp) {
              tryEnqueue(JSON.stringify({ error: "empty_response", id }));
              tryClose();
              return;
            }

            const respBody = typeof resp.body === "string"
              ? resp.body
              : JSON.stringify(resp.body);
            tryEnqueue(respBody);
            tryClose();
            return;
          }

          if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            tryEnqueue(heartbeat);
            lastHeartbeat = Date.now();
          }
        }

        tryEnqueue(JSON.stringify({
          error: "edge_timeout",
          message: `Sin resultado en ${EDGE_TIMEOUT_MS}ms. El job ${id} sigue en marcha en el worker; consulta GET /api/jobs/${id} para recogerlo.`,
          id,
        }));
        tryClose();
      } catch (err) {
        if (!closed) {
          try { controller.error(err); closed = true; } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// Streaming real: el worker escribe chunks SSE al store CHUNKS conforme llegan
// del provider; aquí los leemos en orden y los reenviamos al cliente.
function streamRealChunks({ id, chunks, archive }) {
  const enc = new TextEncoder();
  const deadline = Date.now() + EDGE_TIMEOUT_MS;

  const stream = new ReadableStream({
    async start(controller) {
      let nextSeq = 0;
      let closed = false;
      let lastHeartbeat = Date.now();
      let firstChunkSeen = false;

      const tryEnqueue = (data) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(data)); }
        catch { closed = true; }
      };
      const tryClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      const cleanup = () => {
        chunks.list({ prefix: `${id}/` }).then(({ blobs }) => {
          for (const b of blobs) chunks.delete(b.key).catch(() => {});
        }).catch(() => {});
        archive.get(id, { type: "json" })
          .then((j) => { if (j) archive.delete(id).catch(() => {}); })
          .catch(() => {});
      };

      try {
        while (Date.now() < deadline) {
          const key = `${id}/${String(nextSeq).padStart(6, "0")}`;
          const chunk = await chunks.get(key, { type: "json" });

          if (chunk) {
            firstChunkSeen = true;
            chunks.delete(key).catch(() => {});

            if (chunk.done) {
              tryClose();
              cleanup();
              return;
            }
            if (chunk.raw) tryEnqueue(chunk.raw);
            nextSeq++;
            lastHeartbeat = Date.now();
            continue;
          }

          // Sin chunk nuevo: heartbeat SSE para mantener viva la conexión.
          if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            tryEnqueue(": keepalive\n\n");
            lastHeartbeat = Date.now();
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        // Cap del Edge Function alcanzado.
        const note = firstChunkSeen
          ? `:edge_timeout id=${id} (job sigue corriendo, recupera con GET /api/jobs/${id})\n\n`
          : `:edge_timeout id=${id} (worker no devolvió primer chunk, recupera con GET /api/jobs/${id})\n\n`;
        tryEnqueue(note);
        tryClose();
      } catch (err) {
        if (!closed) {
          try { controller.error(err); closed = true; } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

