# Tests

Tests unitarios sobre piezas críticas de OpenChaw. Usa `node:test`, built-in
en Node 20+. **Sin dependencias extras** — no añade nada a `package.json`.

## Correr

```bash
npm run test
```

## Convenciones

- Un archivo `*.test.js` por módulo cubierto.
- Imports relativos a la raíz del repo: `../public/...`, `../netlify/...`,
  `../worker/...`.
- Los módulos del frontend que importan `dom.js` ejecutan
  `document.getElementById(...)` al cargar; los tests mockean
  `globalThis.document` antes del import dinámico.
- No mockear `fetch` ni Netlify Blobs en este nivel — esos son tests de
  integración (TODO en futuros sprints).

## Cobertura actual

- [x] `public/tunnel/js/markdown.js` — `renderMarkdown` (escape, bold,
  italic, código inline / bloque, headers, hr, links seguros, listas).
- [x] `public/tunnel/js/stream.js` — `iterSSE` (eventos simples,
  `event:` header, comentarios SSE, `[DONE]`, JSON vs string,
  reconstrucción de eventos partidos en chunks, formas de OpenAI y
  Anthropic).

## Pendiente (próximos micro-pasos)

Cada uno requerirá añadir `export` a una función interna del archivo
correspondiente (cambio quirúrgico, no destructivo) y se acordará por
separado:

- [ ] `netlify/edge-functions/gateway.js` — `detectTarget`,
  `extractClientToken`, `STRIP_HEADERS`.
- [ ] `worker/worker.js` — `applyAutoAuth`.
- [ ] `netlify/edge-functions/jobs-next.js` — `tryClaim` (con mock de
  Netlify Blobs).
