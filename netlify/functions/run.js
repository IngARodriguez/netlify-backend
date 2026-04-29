import { getStore } from "@netlify/blobs";

export const config = { path: "/api/run" };

const ACTIVE = "jobs-active";
const ARCHIVE = "jobs-archive";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 250;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  const clientToken = process.env.JOBS_CLIENT_TOKEN;
  const workerToken = process.env.JOBS_WORKER_TOKEN;
  if (!clientToken || !workerToken) {
    return json(
      { error: "Faltan JOBS_CLIENT_TOKEN y/o JOBS_WORKER_TOKEN en las env vars de Netlify." },
      500
    );
  }
  if (!bearer(req, clientToken)) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) return json({ error: "Falta 'command' (string)." }, 400);
  if (command.length > 4000) return json({ error: "command demasiado largo" }, 400);

  const waitMs = Math.min(
    Math.max(Number(body.timeoutMs) || MAX_WAIT_MS, 500),
    MAX_WAIT_MS
  );

  const active = getStore(ACTIVE);
  const archive = getStore(ARCHIVE);

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const initial = {
    id,
    command,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await active.setJSON(id, initial);

  const deadline = Date.now() + waitMs;
  let job = initial;
  let done = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    done = await archive.get(id, { type: "json" });
    if (done) {
      job = done;
      break;
    }
    const live = await active.get(id, { type: "json" });
    if (live) job = live;
  }

  if (done) {
    return json({
      ok: true,
      id: job.id,
      status: job.status,
      stdout: job.stdout ?? "",
      stderr: job.stderr ?? "",
      exitCode: job.exitCode ?? null,
      durationMs: job.durationMs ?? null,
      error: job.error,
    });
  }

  return json(
    {
      ok: true,
      id: job.id,
      status: job.status,
      message: `Sin resultado en ${waitMs}ms. Consulta GET /api/jobs/${job.id} para recoger el resultado cuando termine.`,
    },
    202
  );
};
