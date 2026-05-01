import { corsHeaders, preflight } from "./_lib/cors.js";
import { bearer, clientToken } from "./_lib/auth.js";
import { json } from "./_lib/http.js";
import { getActive, getArchive } from "./_lib/stores.js";
import { newJobId, pollJobUntilArchived } from "./_lib/queue.js";

export const config = { path: "/api/proxy" };

const cors = corsHeaders("POST, OPTIONS");

const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 250;

export default async (req) => {
  const pre = preflight(req, cors);
  if (pre) return pre;
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405, cors);
  }

  if (!bearer(req, clientToken())) return json({ error: "Unauthorized" }, 401, cors);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, cors); }

  if (!body.url || typeof body.url !== "string") {
    return json({ error: "Falta 'url' (string)." }, 400, cors);
  }
  try { new URL(body.url); }
  catch { return json({ error: "URL inválida." }, 400, cors); }

  const request = {
    url: body.url,
    method: (typeof body.method === "string" ? body.method : "GET").toUpperCase(),
    headers: (body.headers && typeof body.headers === "object") ? body.headers : {},
    body: body.body,
  };

  const waitMs = Math.min(
    Math.max(Number(body.timeoutMs) || MAX_WAIT_MS, 500),
    MAX_WAIT_MS
  );

  const active = getActive();
  const archive = getArchive();

  const id = newJobId();
  const initial = {
    id,
    type: "http",
    request,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await active.setJSON(id, initial);

  const { done, latest } = await pollJobUntilArchived({
    active, archive, id, waitMs, pollIntervalMs: POLL_INTERVAL_MS,
  });
  const job = done || latest || initial;

  if (done) {
    return json({
      ok: true,
      id: job.id,
      status: job.status,
      response: job.response ?? null,
      durationMs: job.durationMs ?? null,
      error: job.error,
    }, 200, cors);
  }

  return json({
    ok: true,
    id: job.id,
    status: job.status,
    message: `Sin resultado en ${waitMs}ms. Consulta GET /api/jobs/${job.id} para recoger el resultado cuando termine.`,
  }, 202, cors);
};
