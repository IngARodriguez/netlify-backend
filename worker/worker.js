import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const BASE = (process.env.JOBS_BASE_URL || "https://enviromentfree.netlify.app").replace(/\/+$/, "");
const TOKEN = process.env.JOBS_WORKER_TOKEN || "admin";
const LONG_POLL_SEC = Math.max(1, Math.min(Number(process.env.LONG_POLL_SEC || 24), 24));
const ERROR_BACKOFF_MS = Number(process.env.ERROR_BACKOFF_MS || 5000);
const CMD_TIMEOUT_MS  = Number(process.env.CMD_TIMEOUT_MS  || 30_000);
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5 * 60_000);
const WORKER_CONCURRENCY     = Math.max(1, Math.min(Number(process.env.WORKER_CONCURRENCY     || 5), 50));
const WORKER_CONCURRENCY_MIN = Math.max(1, Math.min(Number(process.env.WORKER_CONCURRENCY_MIN || 2), WORKER_CONCURRENCY));
const WORKER_CONCURRENCY_MAX = Math.max(WORKER_CONCURRENCY, Math.min(Number(process.env.WORKER_CONCURRENCY_MAX || 20), 50));
const WORKER_AUTOSCALE = process.env.WORKER_AUTOSCALE !== "0" && process.env.WORKER_AUTOSCALE !== "false";
const AUTOSCALE_INTERVAL_MS = Math.max(2_000, Number(process.env.AUTOSCALE_INTERVAL_MS || 8_000));
const STREAM_FLUSH_MS = Math.max(20, Number(process.env.STREAM_FLUSH_MS || 60));
const STREAM_BATCH_SIZE = Math.max(1, Number(process.env.STREAM_BATCH_SIZE || 2));
const MAX_BUFFER = 1024 * 1024;
const HTTP_BODY_CAP = 1_000_000;
const VERBOSE = process.env.VERBOSE === "1" || process.env.VERBOSE === "true";

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const ts = () => new Date().toISOString().slice(11, 23);
const vlog = (...a) => { if (VERBOSE) console.log(`[${ts()}]`, ...a); };

async function claimNext() {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/jobs/next?wait=${LONG_POLL_SEC}`, { headers });
  const latency = Date.now() - t0;
  if (!r.ok) throw new Error(`GET /api/jobs/next → ${r.status} (${latency}ms)`);
  const data = await r.json();
  vlog(`poll next ${latency}ms job=${data.job ? data.job.id : "null"}`);
  return data.job;
}

function applyAutoAuth(url, h) {
  let u;
  try { u = new URL(url); } catch { return h; }
  const out = { ...h };
  const has = (k) => Object.keys(out).some((x) => x.toLowerCase() === k.toLowerCase());

  if (u.hostname === "api.openai.com") {
    if (!has("authorization") && process.env.OPENAI_API_KEY) {
      out["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
    }
  }
  if (u.hostname === "api.anthropic.com") {
    if (!has("x-api-key") && process.env.ANTHROPIC_API_KEY) {
      out["x-api-key"] = process.env.ANTHROPIC_API_KEY;
    }
    if (!has("anthropic-version")) {
      out["anthropic-version"] = "2023-06-01";
    }
    // El gateway del navegador puede colar un Origin; si llega, Anthropic
    // exige este flag o devuelve "CORS requests must set ...".
    if (!has("anthropic-dangerous-direct-browser-access")) {
      out["anthropic-dangerous-direct-browser-access"] = "true";
    }
    // Limpieza defensiva por si el Origin se coló pese al strip del gateway.
    for (const k of Object.keys(out)) {
      if (k.toLowerCase() === "origin" || k.toLowerCase() === "referer") delete out[k];
    }
  }
  return out;
}

async function runHttp(job) {
  const startedAt = Date.now();
  const req = job.request || {};
  const method = (req.method || "GET").toUpperCase();
  let outHeaders = applyAutoAuth(req.url, req.headers || {});
  let body = req.body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    body = JSON.stringify(body);
    if (!Object.keys(outHeaders).some((k) => k.toLowerCase() === "content-type")) {
      outHeaders["Content-Type"] = "application/json";
    }
  }
  const init = { method, headers: outHeaders };
  if (method !== "GET" && method !== "HEAD" && body !== undefined && body !== null) {
    init.body = body;
  }
  try {
    init.signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  } catch {
    // older Node — sin timeout via signal
  }

  try {
    const r = await fetch(req.url, init);
    const respHeaders = Object.fromEntries(r.headers.entries());
    const text = await r.text();
    const truncated = text.length > HTTP_BODY_CAP;
    const finalText = truncated ? text.slice(0, HTTP_BODY_CAP) : text;
    let parsed;
    try { parsed = JSON.parse(finalText); }
    catch { parsed = finalText; }
    const result = {
      response: {
        status: r.status,
        headers: respHeaders,
        body: parsed,
      },
      durationMs: Date.now() - startedAt,
    };
    if (truncated) result.response.truncated = true;
    return result;
  } catch (err) {
    return {
      response: null,
      durationMs: Date.now() - startedAt,
      error: err.name === "TimeoutError" ? "timeout" : (err.message || String(err)),
    };
  }
}

async function runShell(job) {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execAsync(job.command, {
      timeout: CMD_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: "/bin/bash",
    });
    return {
      stdout,
      stderr,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || String(err.message || err),
      exitCode: typeof err.code === "number" ? err.code : -1,
      durationMs: Date.now() - startedAt,
      error: err.killed ? "timeout" : undefined,
    };
  }
}

async function runJob(job) {
  if (job.type === "http") {
    if (job.streaming) return await runHttpStream(job);
    return await runHttp(job);
  }
  return await runShell(job);
}

async function postChunks(jobId, batch) {
  if (!batch.length) return;
  try {
    const r = await fetch(`${BASE}/api/jobs/${jobId}/chunks`, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
    });
    if (!r.ok) vlog(`postChunks ${jobId} → ${r.status}`);
  } catch (err) {
    vlog(`postChunks ${jobId} fallo: ${err.message}`);
  }
}

async function runHttpStream(job) {
  const startedAt = Date.now();
  const req = job.request || {};
  const method = (req.method || "POST").toUpperCase();
  let outHeaders = applyAutoAuth(req.url, req.headers || {});
  let body = req.body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    body = JSON.stringify(body);
  }
  if (!Object.keys(outHeaders).some((k) => k.toLowerCase() === "content-type")) {
    outHeaders["Content-Type"] = "application/json";
  }
  const init = { method, headers: outHeaders, body };
  try { init.signal = AbortSignal.timeout(HTTP_TIMEOUT_MS); } catch {}

  let res;
  try {
    res = await fetch(req.url, init);
  } catch (err) {
    return {
      response: null,
      durationMs: Date.now() - startedAt,
      error: err.name === "TimeoutError" ? "timeout" : (err.message || String(err)),
    };
  }

  // Si el provider responde con error o sin stream, fallback a respuesta normal
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    await postChunks(job.id, [{ seq: 0, done: true }]);
    return {
      response: {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: parsed,
      },
      durationMs: Date.now() - startedAt,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seq = 0;
  let pending = [];
  let lastFlush = Date.now();
  let accText = "";
  let messageMeta = null;

  const flushPending = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0);
    await postChunks(job.id, batch);
    lastFlush = Date.now();
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx < 0) break;
        const ev = buffer.slice(0, idx + 2);
        buffer = buffer.slice(idx + 2);
        pending.push({ seq: seq++, raw: ev });

        // Acumular texto para reconstruir respuesta no-stream en archive.
        const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
        if (dataLine && dataLine !== "data: [DONE]") {
          try {
            const obj = JSON.parse(dataLine.slice(6));
            if (obj.type === "content_block_delta" && obj.delta?.text) {
              accText += obj.delta.text;
            } else if (obj.type === "message_start" && obj.message) {
              messageMeta = obj.message;
            } else if (obj.choices?.[0]?.delta?.content) {
              accText += obj.choices[0].delta.content;
            }
          } catch {}
        }
      }

      if (Date.now() - lastFlush > STREAM_FLUSH_MS || pending.length >= STREAM_BATCH_SIZE) {
        await flushPending();
      }
    }
  } catch (err) {
    await flushPending();
    await postChunks(job.id, [{ seq: seq++, done: true }]);
    return {
      response: null,
      durationMs: Date.now() - startedAt,
      error: err.name === "TimeoutError" ? "timeout" : (err.message || String(err)),
    };
  }

  await flushPending();
  await postChunks(job.id, [{ seq: seq++, done: true }]);

  // Reconstruir respuesta completa para archive (clientes no-streaming).
  const reconstructed = messageMeta
    ? { ...messageMeta, content: [{ type: "text", text: accText }], stop_reason: "end_turn" }
    : { content: [{ type: "text", text: accText }] };

  return {
    response: {
      status: 200,
      headers: Object.fromEntries(res.headers.entries()),
      body: reconstructed,
    },
    durationMs: Date.now() - startedAt,
    streamed: true,
  };
}

async function postResult(id, result) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/jobs/${id}/result`, {
    method: "POST",
    headers,
    body: JSON.stringify(result),
  });
  const latency = Date.now() - t0;
  if (!r.ok) throw new Error(`POST /api/jobs/${id}/result → ${r.status} (${latency}ms)`);
  vlog(`post result ${latency}ms id=${id}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeJob(job) {
  if (job.type === "http") {
    const r = job.request || {};
    return `HTTP ${r.method || "GET"} ${r.url}`;
  }
  return `$ ${job.command}`;
}

// Estado del pool dinámico.  liveSlots contiene los ids de slots que
// deberían seguir activos; cuando autoscale retira uno, el slot sale del
// while en cuanto vuelve del próximo claimNext, sin abortar jobs en vuelo.
const liveSlots = new Set();
let busySlots = 0;
let nextSlotId = 0;
const queueWaitWindow = [];   // últimos N tiempos en cola, para presión
const QUEUE_WAIT_WINDOW = 30;
let lastScaleAt = 0;

async function workerSlot(slotId) {
  liveSlots.add(slotId);
  try {
    while (liveSlots.has(slotId)) {
      try {
        const job = await claimNext();
        if (!job) continue;
        if (!liveSlots.has(slotId)) {
          // Slot fue retirado mientras esperábamos; devolvemos el job con
          // un error suave para que se reencole o lo coja otro slot.
          console.log(`[${ts()}] [s${slotId}] slot retirado mid-claim, releasing ${job.id}`);
          continue;
        }
        busySlots++;
        const claimedAt = Date.now();
        const queueWaitMs = claimedAt - Date.parse(job.createdAt);
        queueWaitWindow.push(queueWaitMs);
        if (queueWaitWindow.length > QUEUE_WAIT_WINDOW) queueWaitWindow.shift();
        console.log(`[${ts()}] [s${slotId} ${job.id}] ${describeJob(job)}  (esperó ${queueWaitMs}ms en cola)`);
        try {
          const result = await runJob(job);
          await postResult(job.id, result);
          const tag = job.type === "http"
            ? `httpStatus=${result.response ? result.response.status : "err"}`
            : `exit=${result.exitCode}`;
          console.log(
            `[${ts()}] [s${slotId} ${job.id}] ${tag} ` +
            `cmd=${result.durationMs}ms total=${Date.now() - claimedAt}ms`
          );
        } finally {
          busySlots--;
        }
      } catch (err) {
        console.error(`[${ts()}] [s${slotId}] loop error:`, err.message);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  } finally {
    liveSlots.delete(slotId);
    if (WORKER_AUTOSCALE) {
      console.log(`[${ts()}] [s${slotId}] slot retirado · vivos=${liveSlots.size}`);
    }
  }
}

function spawnSlot() {
  const id = nextSlotId++;
  workerSlot(id);
  return id;
}

function avgQueueWait() {
  if (!queueWaitWindow.length) return 0;
  const sum = queueWaitWindow.reduce((a, b) => a + b, 0);
  return sum / queueWaitWindow.length;
}

function autoscale() {
  if (!WORKER_AUTOSCALE) return;
  const now = Date.now();
  if (now - lastScaleAt < AUTOSCALE_INTERVAL_MS / 2) return; // debounce

  const live = liveSlots.size;
  const util = live ? busySlots / live : 0;
  const avgWait = avgQueueWait();

  // Scale up: muchos slots activos o jobs esperando en cola del server
  const pressureUp = (util >= 0.8) || (avgWait > 2_000 && busySlots >= live * 0.6);
  if (pressureUp && live < WORKER_CONCURRENCY_MAX) {
    const add = Math.min(
      Math.max(2, Math.floor(live * 0.5)),  // crece más rápido bajo presión alta
      WORKER_CONCURRENCY_MAX - live
    );
    for (let i = 0; i < add; i++) spawnSlot();
    lastScaleAt = now;
    console.log(
      `[${ts()}] [autoscale] +${add} → ${liveSlots.size} ` +
      `(busy=${busySlots} util=${util.toFixed(2)} avgWait=${avgWait.toFixed(0)}ms)`
    );
    return;
  }

  // Scale down: pocos slots ocupados Y nadie esperando
  const pressureDown = (util < 0.25) && (avgWait < 500);
  if (pressureDown && live > WORKER_CONCURRENCY_MIN) {
    const ids = Array.from(liveSlots);
    const removeId = ids[ids.length - 1];
    liveSlots.delete(removeId);
    lastScaleAt = now;
    console.log(
      `[${ts()}] [autoscale] -1 → ${live - 1} (target) ` +
      `(busy=${busySlots} util=${util.toFixed(2)} avgWait=${avgWait.toFixed(0)}ms)`
    );
  }
}

async function loop() {
  const initial = WORKER_AUTOSCALE
    ? Math.max(WORKER_CONCURRENCY_MIN, Math.min(WORKER_CONCURRENCY, WORKER_CONCURRENCY_MAX))
    : WORKER_CONCURRENCY;
  console.log(
    `[${ts()}] Worker activo. Long-polling ${BASE} con wait=${LONG_POLL_SEC}s, ` +
    `concurrencia=${initial}` +
    (WORKER_AUTOSCALE
      ? ` (autoscale ${WORKER_CONCURRENCY_MIN}-${WORKER_CONCURRENCY_MAX})`
      : ` (autoscale off)`) +
    ` (VERBOSE=${VERBOSE ? "on" : "off"})`
  );
  for (let i = 0; i < initial; i++) spawnSlot();

  if (WORKER_AUTOSCALE) {
    setInterval(autoscale, AUTOSCALE_INTERVAL_MS);
  }

  // Mantener proceso vivo (los slots corren en background).
  while (true) await sleep(60_000);
}

loop();
