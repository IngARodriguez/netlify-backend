import { getStore } from "@netlify/blobs";

export const config = {
  path: ["/api/jobs", "/api/jobs/*"],
};

const ACTIVE = "jobs-active";
const ARCHIVE = "jobs-archive";
const LEGACY = "jobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });

const bearer = (req, expected) => {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return !!expected && !!m && m[1] === expected;
};

async function findJob(id) {
  for (const name of [ARCHIVE, ACTIVE, LEGACY]) {
    const store = getStore({ name, consistency: "strong" });
    const job = await store.get(id, { type: "json" });
    if (job) return { job, store };
  }
  return null;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  const clientToken = process.env.JOBS_CLIENT_TOKEN;
  const workerToken = process.env.JOBS_WORKER_TOKEN;
  if (!clientToken || !workerToken) {
    return json(
      { error: "Faltan JOBS_CLIENT_TOKEN y/o JOBS_WORKER_TOKEN en las env vars de Netlify." },
      500
    );
  }

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  // POST /api/jobs  → cliente crea un trabajo (queda en ACTIVE)
  if (req.method === "POST" && parts.length === 2) {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let job;

    if (body.type === "http" || body.request) {
      if (!body.request || typeof body.request.url !== "string") {
        return json({ error: "Para HTTP hace falta request.url (string)." }, 400);
      }
      try { new URL(body.request.url); }
      catch { return json({ error: "request.url inválida." }, 400); }
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
      if (!command) return json({ error: "Falta 'command' (string) o 'request' (objeto)." }, 400);
      if (command.length > 4000) return json({ error: "command demasiado largo" }, 400);
      job = {
        id,
        type: "shell",
        command,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
    }

    await getStore({ name: ACTIVE, consistency: "strong" }).setJSON(id, job);
    return json({ ok: true, id, status: "pending", type: job.type });
  }

  // GET /api/jobs/next  → worker reclama el siguiente pendiente (sólo mira ACTIVE)
  // Soporta long polling con ?wait=N (segundos, max 24).
  if (req.method === "GET" && parts.length === 3 && parts[2] === "next") {
    if (!bearer(req, workerToken)) return json({ error: "Unauthorized" }, 401);
    const active = getStore({ name: ACTIVE, consistency: "strong" });
    const url = new URL(req.url);
    const waitSec = Math.max(0, Math.min(Number(url.searchParams.get("wait")) || 0, 24));
    const deadline = Date.now() + waitSec * 1000;
    const INTERVAL_MS = 1500;

    while (true) {
      const list = await active.list();
      const keys = list.blobs.map((b) => b.key).sort();
      for (const key of keys) {
        const j = await active.get(key, { type: "json" });
        if (j && j.status === "pending") {
          j.status = "running";
          j.startedAt = new Date().toISOString();
          await active.setJSON(j.id, j);
          return json({ ok: true, job: j });
        }
      }
      if (Date.now() >= deadline) return json({ ok: true, job: null });
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  // POST /api/jobs/:id/result  → worker entrega resultado (mueve ACTIVE → ARCHIVE)
  if (req.method === "POST" && parts.length === 4 && parts[3] === "result") {
    if (!bearer(req, workerToken)) return json({ error: "Unauthorized" }, 401);
    const id = parts[2];
    const active = getStore({ name: ACTIVE, consistency: "strong" });
    const archive = getStore({ name: ARCHIVE, consistency: "strong" });
    const job = await active.get(id, { type: "json" });
    if (!job) return json({ error: "Not found" }, 404);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

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
    return json({ ok: true });
  }

  // DELETE /api/jobs/archive  → cliente vacía todo el store de archive
  if (req.method === "DELETE" && parts.length === 3 && parts[2] === "archive") {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    const store = getStore({ name: ARCHIVE, consistency: "strong" });
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, deleted: blobs.length, store: "archive" });
  }

  // DELETE /api/jobs/active  → cliente vacía todo el store de active
  if (req.method === "DELETE" && parts.length === 3 && parts[2] === "active") {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    const store = getStore({ name: ACTIVE, consistency: "strong" });
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, deleted: blobs.length, store: "active" });
  }

  // DELETE /api/jobs/:id  → cliente borra de cualquier store
  if (req.method === "DELETE" && parts.length === 3) {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    const id = parts[2];
    const found = await findJob(id);
    if (!found) return json({ error: "Not found" }, 404);
    await found.store.delete(id);
    return json({ ok: true });
  }

  // GET /api/jobs/:id  → cliente consulta estado/resultado (busca en ARCHIVE → ACTIVE → LEGACY)
  if (req.method === "GET" && parts.length === 3) {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    const id = parts[2];
    const found = await findJob(id);
    if (!found) return json({ error: "Not found" }, 404);
    return json({ ok: true, job: found.job });
  }

  return json({ error: "Route not found" }, 404);
};
