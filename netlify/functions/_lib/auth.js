// Auth helpers — Bearer token simple.
//
// Mantenemos la misma semántica que el código original:
// - Si `expected` es falsy (token deshabilitado), `bearer` devuelve false
//   — los callers deben decidir qué hacer (jobs.js/proxy.js/run.js
//   actualmente todos rechazan con 401 si bearer() es falso).
// - `clientToken()` y `workerToken()` siempre devuelven al menos "admin"
//   por compatibilidad con el comportamiento previo (`process.env.X || "admin"`).

export function bearer(req, expected) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return !!expected && !!m && m[1] === expected;
}

export function clientToken() {
  return process.env.JOBS_CLIENT_TOKEN || "admin";
}

export function workerToken() {
  return process.env.JOBS_WORKER_TOKEN || "admin";
}
