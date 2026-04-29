import { getStore } from "@netlify/blobs";

export const config = {
  path: ["/api/jobs", "/api/jobs/*"],
};

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
  const store = getStore("jobs");

  // POST /api/jobs  → cliente crea un trabajo
  if (req.method === "POST" && parts.length === 2) {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const command = typeof body.command === "string" ? body.command.trim() : "";
    if (!command) return json({ error: "Falta 'command' (string)." }, 400);
    if (command.length > 4000) return json({ error: "command demasiado largo" }, 400);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      command,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(id, job);
    return json({ ok: true, id, status: "pending" });
  }

  // GET /api/jobs/next  → worker reclama el siguiente pendiente
  if (req.method === "GET" && parts.length === 3 && parts[2] === "next") {
    if (!bearer(req, workerToken)) return json({ error: "Unauthorized" }, 401);
    const list = await store.list();
    let oldest = null;
    for (const blob of list.blobs) {
      const j = await store.get(blob.key, { type: "json" });
      if (j && j.status === "pending" && (!oldest || j.createdAt < oldest.createdAt)) {
        oldest = j;
      }
    }
    if (!oldest) return json({ ok: true, job: null });
    oldest.status = "running";
    oldest.startedAt = new Date().toISOString();
    await store.setJSON(oldest.id, oldest);
    return json({ ok: true, job: oldest });
  }

  // POST /api/jobs/:id/result  → worker entrega el resultado
  if (req.method === "POST" && parts.length === 4 && parts[3] === "result") {
    if (!bearer(req, workerToken)) return json({ error: "Unauthorized" }, 401);
    const id = parts[2];
    const job = await store.get(id, { type: "json" });
    if (!job) return json({ error: "Not found" }, 404);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    job.status = body.error ? "error" : "done";
    job.finishedAt = new Date().toISOString();
    job.stdout = String(body.stdout ?? "").slice(0, 100_000);
    job.stderr = String(body.stderr ?? "").slice(0, 100_000);
    job.exitCode = Number.isInteger(body.exitCode) ? body.exitCode : null;
    job.durationMs = Number.isFinite(body.durationMs) ? body.durationMs : null;
    if (body.error) job.error = String(body.error).slice(0, 2000);
    await store.setJSON(id, job);
    return json({ ok: true });
  }

  // GET /api/jobs/:id  → cliente consulta estado/resultado
  if (req.method === "GET" && parts.length === 3) {
    if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);
    const id = parts[2];
    const job = await store.get(id, { type: "json" });
    if (!job) return json({ error: "Not found" }, 404);
    return json({ ok: true, job });
  }

  return json({ error: "Route not found" }, 404);
};
