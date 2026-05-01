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
      const j = await active.get(key, { type: "json" });
      if (j && j.status === "pending") {
        j.status = "running";
        j.startedAt = new Date().toISOString();
        await active.setJSON(j.id, j);
        return json({ ok: true, job: j });
      }
    }
    if (Date.now() >= deadline) return json({ ok: true, job: null });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
};
