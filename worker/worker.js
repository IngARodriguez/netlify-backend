import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const BASE = process.env.JOBS_BASE_URL || "https://enviromentfree.netlify.app";
const TOKEN = process.env.JOBS_WORKER_TOKEN;
const POLL_MS = Number(process.env.POLL_MS || 3000);
const CMD_TIMEOUT_MS = Number(process.env.CMD_TIMEOUT_MS || 30_000);
const MAX_BUFFER = 1024 * 1024;

if (!TOKEN) {
  console.error("Falta la variable de entorno JOBS_WORKER_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function claimNext() {
  const r = await fetch(`${BASE}/api/jobs/next`, { headers });
  if (!r.ok) throw new Error(`GET /api/jobs/next → ${r.status}`);
  const data = await r.json();
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
  const r = await fetch(`${BASE}/api/jobs/${id}/result`, {
    method: "POST",
    headers,
    body: JSON.stringify(result),
  });
  if (!r.ok) throw new Error(`POST /api/jobs/${id}/result → ${r.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  console.log(`Worker activo. Polling ${BASE} cada ${POLL_MS}ms`);
  while (true) {
    try {
      const job = await claimNext();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      console.log(`[${job.id}] $ ${job.command}`);
      const result = await runJob(job);
      await postResult(job.id, result);
      console.log(`[${job.id}] exit=${result.exitCode} (${result.durationMs}ms)`);
    } catch (err) {
      console.error("loop error:", err.message);
      await sleep(POLL_MS);
    }
  }
}

loop();
