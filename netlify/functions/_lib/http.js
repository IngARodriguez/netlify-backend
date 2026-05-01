// Helpers HTTP genéricos compartidos.

// json(body, status, cors) construye una Response JSON con headers CORS.
// `cors` se pasa explícito para que cada endpoint declare sus métodos
// permitidos (POST vs GET/POST vs GET/POST/DELETE).
export function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
