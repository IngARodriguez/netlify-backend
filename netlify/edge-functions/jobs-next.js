import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/jobs/next",
};

const ACTIVE = "jobs-active";
const POLL_INTERVAL_MS = 1500;
// Edge Functions tienen timeout 30s; dejamos margen al overhead.
const MAX_WAIT_SEC = 29;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

const readEnv = (key) => {
  if (typeof Netlify !== "undefined" && Netlify.env?.get) return Netlify.env.get(key);
  if (typeof Deno !== "undefined" && Deno.env?.get) return Deno.env.get(key);
  return undefined;
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }
  if (req.method !== "GET") {
    return json({ error: "Method not allowed. Use GET." }, 405);
  }

  const workerToken = readEnv("JOBS_WORKER_TOKEN") || "admin";
  if (!bearer(req, workerToken)) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const waitSec = Math.max(0, Math.min(Number(url.searchParams.get("wait")) || 0, MAX_WAIT_SEC));
  const deadline = Date.now() + waitSec * 1000;

  const active = getStore({ name: ACTIVE, consistency: "strong" });

  while (true) {
    const list = await active.list();
    const keys = list.blobs.map((b) => b.key).sort();
    for (const key of keys) {
      const claimed = await tryClaim(active, key);
      if (claimed) return json({ ok: true, job: claimed });
    }
    if (Date.now() >= deadline) return json({ ok: true, job: null });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
};

// Reclama un job atómicamente.  Indispensable cuando el worker corre en
// paralelo con varios slots o cuando hay >1 worker — evita doble entrega
// del mismo job.
async function tryClaim(active, key) {
  let meta;
  try {
    meta = await active.getWithMetadata(key, { type: "json" });
  } catch {
    return null;
  }
  if (!meta || !meta.data) return null;
  const job = meta.data;
  if (job.status !== "pending") return null;

  const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const updated = {
    ...job,
    status: "running",
    startedAt: new Date().toISOString(),
    claimId,
  };

  // CAS atómico: solo escribimos si nadie tocó el blob desde nuestra lectura.
  try {
    const result = await active.setJSON(key, updated, { onlyIfMatch: meta.etag });
    if (result && result.modified === false) return null;
  } catch {
    return null;
  }

  // Defensa por si la versión del SDK ignora onlyIfMatch silenciosamente.
  let verify;
  try {
    verify = await active.get(key, { type: "json" });
  } catch {
    return null;
  }
  if (!verify || verify.claimId !== claimId) return null;

  return verify;
}
