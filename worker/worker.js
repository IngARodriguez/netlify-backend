import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const BASE = process.env.JOBS_BASE_URL || "https://enviromentfree.netlify.app";
const TOKEN = process.env.JOBS_WORKER_TOKEN;
const POLL_MS = Number(process.env.POLL_MS || 1000);
const CMD_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 30_000);
const MAX_BUFFER = 1024 * 1024;
const VERBOSE = process.env.VERBOSE === "1" || process.env.VERBOSE === "true";

if (!TOKEN) {
  console.error("Falta la variable de entorno JOBS_WORKER_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const ts = () => new Date().toISOString().slice(11, 23);
const vlog = (...a) => { if (VERBOSE) console.log(`[${ts()}]`, ...a); };

async function claimNext() {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/jobs/next`, { headers });
  const latency = Date.now() - t0;
  if (!r.ok) throw new Error(`GET /api/jobs/next → ${r.status} (${latency}ms)`);
  const data = await r.json();
  vlog(`poll next ${latency}ms job=${data.job ? data.job.id : "null"}`);
  return data.job;
}

async function runJob(job) {
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

async function loop() {
  console.log(
    `[${ts()}] Worker activo. Polling ${BASE} cada ${POLL_MS}ms ` +
    `(VERBOSE=${VERBOSE ? "on" : "off"})`
  );
  let pollCount = 0;
  while (true) {
    pollCount++;
    try {
      const job = await claimNext();
      if (!job) {
        if (!VERBOSE && pollCount % 30 === 0) {
          console.log(`[${ts()}] heartbeat ${pollCount} polls, sin trabajos`);
        }
        await sleep(POLL_MS);
        continue;
      }
      const claimedAt = Date.now();
      const queueWaitMs = claimedAt - Date.parse(job.createdAt);
      console.log(`[${ts()}] [${job.id}] $ ${job.command}  (esperó ${queueWaitMs}ms en cola)`);
      const result = await runJob(job);
      await postResult(job.id, result);
      console.log(
        `[${ts()}] [${job.id}] exit=${result.exitCode} ` +
        `cmd=${result.durationMs}ms total=${Date.now() - claimedAt}ms`
      );
    } catch (err) {
      console.error(`[${ts()}] loop error:`, err.message);
      await sleep(POLL_MS);
    }
  }
}

loop();
