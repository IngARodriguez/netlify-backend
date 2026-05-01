# `_lib/` — helpers compartidos para HTTP Functions

Helpers extraídos de `proxy.js`, `run.js` y `jobs.js` para eliminar
duplicación.

**Alcance**: solo lo usan las HTTP Functions Node de
`netlify/functions/`. Las Edge Functions (`netlify/edge-functions/`)
corren en Deno y mantienen su propio código duplicado por ahora —
unificarlas requeriría asegurar compatibilidad runtime y queda fuera de
este refactor.

## Módulos

| Archivo | Exporta |
|---|---|
| `cors.js` | `corsHeaders(methods)`, `preflight(req, cors)` |
| `auth.js` | `bearer(req, expected)`, `clientToken()`, `workerToken()` |
| `http.js` | `json(body, status, cors)`, `sleep(ms)` |
| `stores.js` | `ACTIVE`, `ARCHIVE`, `CHUNKS`, `LEGACY`, `getActive()`, `getArchive()`, `getChunks()` |
| `queue.js` | `newJobId()`, `pollJobUntilArchived({active, archive, id, waitMs})` |

## Convenciones

- ESM puro (`"type": "module"` ya está en `package.json`).
- Sin estado global; cada función es pura o factory.
- `cors` se pasa explícito a `json()` y a `preflight()`. Cada endpoint
  declara sus métodos en `corsHeaders("POST, OPTIONS")` etc.
- **Compatibilidad estricta**: cualquier cambio que altere body, status,
  o headers de una respuesta debe marcarse como cambio de comportamiento
  observable, no como refactor.
