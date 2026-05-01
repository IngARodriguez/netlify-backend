// CORS helpers para Netlify HTTP Functions.
//
// `corsHeaders(methods)` produce el objeto de headers usado en cada
// Response y en el handler OPTIONS.  El conjunto de headers permitidos
// es estable entre endpoints; solo varía la lista de métodos.

export function corsHeaders(methods = "POST, OPTIONS") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Devuelve la Response de preflight si el método es OPTIONS, null si no.
// Cada caller decide qué hacer si recibe null (seguir con el routing).
export function preflight(req, cors) {
  if (req.method !== "OPTIONS") return null;
  return new Response("", { status: 204, headers: cors });
}
