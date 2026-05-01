// Helpers de la cola de jobs.

import { sleep } from "./http.js";

export function newJobId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Polling loop usado por proxy.js y run.js: espera que un job aparezca
// en archive (escrito por el worker al terminar), y mientras tanto lee
// active para devolver al cliente el último estado visto si la espera
// excede waitMs.
//
// Devuelve { done, latest }:
//   - done:   el job archivado (status "done" o "error") o null si timeout.
//   - latest: el último estado visto en active (o el done si llegó);
//             null si nunca hubo refresh visible.
//
// El caller compone el job final como `done || latest || initial` para
// preservar el comportamiento previo de `let job = initial` en proxy/run.
export async function pollJobUntilArchived({
  active,
  archive,
  id,
  waitMs,
  pollIntervalMs = 250,
}) {
  const deadline = Date.now() + waitMs;
  let latest = null;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const done = await archive.get(id, { type: "json" });
    if (done) return { done, latest: done };
    const live = await active.get(id, { type: "json" });
    if (live) latest = live;
  }
  return { done: null, latest };
}
