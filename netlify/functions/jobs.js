import { getStore } from "@netlify/blobs";
import { corsHeaders, preflight } from "./_lib/cors.js";
import { bearer, clientToken, workerToken } from "./_lib/auth.js";
import { json } from "./_lib/http.js";
import {
  ACTIVE, ARCHIVE, LEGACY,
  getActive, getArchive, getChunks,
} from "./_lib/stores.js";
import { newJobId } from "./_lib/queue.js";

export const config = {
  path: ["/api/jobs", "/api/jobs/*"],
};

const cors = corsHeaders("GET, POST, OPTIONS");

async function findJob(id) {
  for (const name of [ARCHIVE, ACTIVE, LEGACY]) {
    const store = getStore({ name, consistency: "strong" });
    const job = await store.get(id, { type: "json" });
    if (job) return { job, store };
  }
  return null;
}

export default async (req) => {
  const pre = preflight(req, cors);
  if (pre) return pre;

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  // POST /api/jobs  → cliente crea un trabajo (queda en ACTIVE)
  if (req.method === "POST" && parts.length === 2) {
    if (!bearer(req, clientToken())) return json({ error: "Unauthorized" }, 401, cors);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }

    const id = newJobId();
    let job;

    if (body.type === "http" || body.request) {
      if (!body.request || typeof body.request.url !== "string") {
        return json({ error: "Para HTTP hace falta request.url (string)." }, 400, cors);
      }
      try { new URL(body.request.url); }
      catch { return json({ error: "request.url inválida." }, 400, cors); }
      job = {
        id,
        type: "http",
        request: {
          url: body.request.url,
          method: (typeof body.request.method === "string" ? body.request.method : "GET").toUpperCase(),
          headers: (body.request.headers && typeof body.request.headers === "object") ? body.request.headers : {},
          body: body.request.body,
        },
        status: "pending",
        createdAt: new Date().toISOString(),
      };
    } else {
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!command) return json({ error: "Falta 'command' (string) o 'request' (objeto)." }, 400, cors);
      if (command.length > 4000) return json({ error: "command demasiado largo" }, 400, cors);
      job = {
        id,
        type: "shell",
        command,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
    }

    await getActive().setJSON(id, job);
    return json({ ok: true, id, status: "pending", type: job.type }, 200, cors);
  }

  // GET /api/jobs/next  → servido por la Edge Function en
  // netlify/edge-functions/jobs-next.js (mejor cap de runtime que las
  // Functions HTTP). Esta Function HTTP ya no maneja esa ruta.

  // POST /api/jobs/:id/chunks  → worker entrega un batch de chunks SSE
  // para streaming en tiempo real.  Cada chunk: { seq: number, raw?: string, done?: bool }.
  if (req.method === "POST" && parts.length === 4 && parts[3] === "chunks") {
    if (!bearer(req, workerToken())) return json({ error: "Unauthorized" }, 401, cors);
    const id = parts[2];
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }
    if (!Array.isArray(body)) return json({ error: "Body must be array" }, 400, cors);
    const chunks = getChunks();
    await Promise.all(body.map((c) =>
      chunks.setJSON(`${id}/${String(c.seq).padStart(6, "0")}`, c)
    ));
    return json({ ok: true, count: body.length }, 200, cors);
  }

  // DELETE /api/jobs/:id/chunks  → limpia los chunks de un job (post-stream).
  if (req.method === "DELETE" && parts.length === 4 && parts[3] === "chunks") {
    if (!bearer(req, clientToken()) && !bearer(req, workerToken())) {
      return json({ error: "Unauthorized" }, 401, cors);
    }
    const id = parts[2];
    const chunks = getChunks();
    const { blobs } = await chunks.list({ prefix: `${id}/` });
    await Promise.all(blobs.map((b) => chunks.delete(b.key)));
    return json({ ok: true, deleted: blobs.length }, 200, cors);
  }

  // POST /api/jobs/:id/result  → worker entrega resultado (mueve ACTIVE → ARCHIVE)
  if (req.method === "POST" && parts.length === 4 && parts[3] === "result") {
    if (!bearer(req, workerToken())) return json({ error: "Unauthorized" }, 401, cors);
    const id = parts[2];
    const active = getActive();
    const archive = getArchive();
    const job = await active.get(id, { type: "json" });
    if (!job) return json({ error: "Not found" }, 404, cors);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }

    job.status = body.error ? "error" : "done";
    job.finishedAt = new Date().toISOString();
    job.durationMs = Number.isFinite(body.durationMs) ? body.durationMs : null;
    if (body.error) job.error = String(body.error).slice(0, 2000);

    if (body.response !== undefined) {
      job.response = body.response;
    } else {
      job.stdout = String(body.stdout ?? "").slice(0, 100_000);
      job.stderr = String(body.stderr ?? "").slice(0, 100_000);
      job.exitCode = Number.isInteger(body.exitCode) ? body.exitCode : null;
    }

    await archive.setJSON(id, job);
    await active.delete(id);
    return json({ ok: true }, 200, cors);
  }

  // DELETE /api/jobs/archive  → cliente vacía todo el store de archive
  if (req.method === "DELETE" && parts.length === 3 && parts[2] === "archive") {
    if (!bearer(req, clientToken())) return json({ error: "Unauthorized" }, 401, cors);
    const store = getArchive();
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, deleted: blobs.length, store: "archive" }, 200, cors);
  }

  // DELETE /api/jobs/active  → cliente vacía todo el store de active
  if (req.method === "DELETE" && parts.length === 3 && parts[2] === "active") {
    if (!bearer(req, clientToken())) return json({ error: "Unauthorized" }, 401, cors);
    const store = getActive();
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, deleted: blobs.length, store: "active" }, 200, cors);
  }

  // DELETE /api/jobs/:id  → cliente borra de cualquier store
  if (req.method === "DELETE" && parts.length === 3) {
    if (!bearer(req, clientToken())) return json({ error: "Unauthorized" }, 401, cors);
    const id = parts[2];
    const found = await findJob(id);
    if (!found) return json({ error: "Not found" }, 404, cors);
    await found.store.delete(id);
    return json({ ok: true }, 200, cors);
  }

  // GET /api/jobs/:id  → cliente consulta estado/resultado (ARCHIVE → ACTIVE → LEGACY)
  if (req.method === "GET" && parts.length === 3) {
    if (!bearer(req, clientToken())) return json({ error: "Unauthorized" }, 401, cors);
    const id = parts[2];
    const found = await findJob(id);
    if (!found) return json({ error: "Not found" }, 404, cors);
    return json({ ok: true, job: found.job }, 200, cors);
  }

  return json({ error: "Route not found" }, 404, cors);
};
