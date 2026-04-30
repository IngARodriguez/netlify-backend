# OpenChaw

Backend serverless en Netlify + un worker en una máquina propia (típicamente
una instancia de Theia, pero sirve cualquier Linux con `node`) que actúa como
puente entre el navegador y las APIs de OpenAI / Anthropic, **sin exponer las
claves de los modelos al cliente**.

OpenChaw ofrece tres caras del mismo sistema:

1. **Un chat web** estilo claude.ai (`/tunnel/`) con sidebar de
   conversaciones, adjuntos, markdown, slider de tokens y modo PWA.
2. **Una terminal web** (`/run/`) para ejecutar comandos shell en la máquina
   donde corre el worker.
3. **Un API gateway transparente** (`/v1/*`, `/anthropic/*`, `/openai/*`) que
   expone los endpoints de OpenAI y Anthropic con la URL de Netlify, listo
   para consumirlo desde curl, Python, OpenCode, Cline, Cursor, etc.

Las claves de OpenAI / Anthropic viven solo en el worker (variables de
entorno locales). El cliente solo necesita un token administrativo
(`JOBS_CLIENT_TOKEN`, por defecto `admin`) para hablar con OpenChaw.

---

## Arquitectura

```
   ┌──────────────┐         HTTPS         ┌────────────────────────────┐
   │  Cliente     │ ─────────────────────►│  Netlify Functions          │
   │  (browser,   │                       │  /v1/*, /api/proxy,         │
   │   curl, SDK) │ ◄─────────────────────│  /api/run, /api/jobs/...    │
   └──────────────┘                       └─────────────┬───────────────┘
                                                        │ encola job en
                                                        │ Netlify Blobs
                                                        ▼
                                                  ┌─────────────┐
                                                  │ jobs-active │
                                                  └─────┬───────┘
                                                        │
                          ┌─────────────────────────────┘
                          │ long polling (`?wait=24`)
                          ▼
                  ┌────────────────┐    fetch real     ┌────────────────────┐
                  │  worker.js     │ ────────────────► │ api.openai.com /   │
                  │  (en Theia)    │ ◄──────────────── │ api.anthropic.com  │
                  └─────┬──────────┘                   └────────────────────┘
                        │ POST /api/jobs/:id/result
                        ▼
                  ┌──────────────┐
                  │ jobs-archive │
                  └──────────────┘
```

El cliente nunca toca directamente a OpenAI / Anthropic. Tampoco conoce las
API keys reales. La autenticación entre cliente y OpenChaw es independiente
de la autenticación entre OpenChaw y los proveedores.

---

## Componentes

### Backend serverless (`netlify/functions/`)

| Archivo | Responsabilidad |
|---|---|
| `gateway.js` | API gateway transparente para `/v1/*`, `/anthropic/*`, `/openai/*`. Detecta provider, valida auth de OpenChaw, encola HTTP job, espera respuesta, opcional fake-streaming SSE. |
| `proxy.js` | Endpoint genérico `POST /api/proxy` para que el frontend de `/tunnel/` haga peticiones HTTP arbitrarias a través del worker. |
| `run.js` | `POST /api/run` — encola un comando shell y espera el resultado hasta 25 s en la misma invocación. |
| `jobs.js` | Cola de trabajos: crear (`POST /api/jobs`), reclamar siguiente con long polling (`GET /api/jobs/next?wait=N`), entregar resultado (`POST /api/jobs/:id/result`), consultar (`GET /api/jobs/:id`), borrar uno o vaciar stores (`DELETE /api/jobs/{archive|active}`). |
| `ping.js` | Health-check trivial (`GET /.netlify/functions/ping`). |

Todos los handlers son funciones HTTP estándar de Netlify (sin Background
Functions ni Edge Functions). El timeout máximo es ~26 s.

### Worker (`worker/worker.js`)

Proceso Node 20+ que el usuario arranca en su máquina:

```bash
git clone https://github.com/IngARodriguez/netlify-backend
export JOBS_BASE_URL=https://tu-sitio.netlify.app
cd netlify-backend
node worker/worker.js
```

Lo que hace:

- Bucle infinito que llama a `GET /api/jobs/next?wait=24`. Long polling:
  cada invocación de Function dura hasta 24 s o se corta cuando llega un
  job. Idle = 1 request cada 24 s.
- Si el job es `type: "shell"`: ejecuta el comando con
  `child_process.exec` (bash, max 30 s, max buffer 1 MB) y devuelve
  `stdout` / `stderr` / `exitCode`.
- Si el job es `type: "http"`: hace `fetch(req.url, ...)` y devuelve
  `status` / `headers` / `body`. **Inyecta automáticamente** las API
  keys reales para Anthropic (`x-api-key`) y OpenAI (`Authorization`)
  cuando el destino es `api.anthropic.com` o `api.openai.com`.
- Cuerpo de la respuesta truncado a 1 MB (configurable). Cuerpo binario
  no soportado todavía.

Token: por defecto `JOBS_WORKER_TOKEN = "admin"`. Solo hace falta
exportar uno distinto si lo cambiaste también en Netlify.

### Frontend (`public/`)

```
public/
├── index.html              ← dashboard
├── manifest.webmanifest    ← PWA
├── icon.svg                ← icono PWA y favicon
├── run/
│   └── index.html          ← terminal estilo iOS
└── tunnel/
    ├── index.html          ← chat
    ├── style.css
    └── js/                 ← 13 módulos ES nativos
```

El chat de `/tunnel/` está partido en módulos ES (cargados con
`<script type="module">`):

| Módulo | Responsabilidad |
|---|---|
| `app.js` | Composición e inicialización (event wiring + IIFE final). |
| `dom.js` | Referencias a elementos DOM y helpers (`escapeHtml`, `paintRangeFill`). |
| `icons.js` | SVG inline de OpenAI / Anthropic / archivos. |
| `markdown.js` | Renderizador de markdown propio (~80 líneas). Sin librerías externas. |
| `status.js` | Footer del composer con estados *idle / info / thinking / ok / error*. |
| `ui.js` | Drawer de settings, sidebar mobile, autoresize del textarea. |
| `models.js` | Catálogo de modelos rápidos (`FAST_MODEL`), slider de `max_tokens` adaptativo según modelo, `populateModelSelect`, `fetchModels`. |
| `attachments.js` | Pipeline de archivos: file picker, drag & drop, paste, validación de tamaño/tipo, lectura base64, `buildContentParts` por provider. |
| `chats.js` | Persistencia de chats en `localStorage`, migración de claves antiguas, `CustomEvent` cuando cambia la lista. |
| `greeting.js` | Saludos dinámicos del empty state (25 *moods* + fallback de 30 frases). |
| `render.js` | `messageNode`, `emptyStateNode`, `typingNode`, `renderHistory`. |
| `chat-list.js` | Sidebar de conversaciones (renderizado, switch, delete). |
| `model-picker.js` | Dropdown custom estilo claude.ai que sustituye al `<select>` nativo del modelo. |
| `send.js` | `buildRequest`, pipeline completa de envío con typing indicator. |

---

## Aplicaciones web

### `/` — dashboard

Landing del sitio. Lista las dos apps (`Run command`, `Tunnel chat`,
`API gateway`), documenta los endpoints, ofrece snippets copiables del
gateway con la URL del sitio rellenada automáticamente, e incluye un
botón de mantenimiento para vaciar los blobs acumulados.

### `/tunnel/` — OpenChaw chat

Chat web estilo claude.ai sobre el `POST /api/proxy`:

- **Sidebar de conversaciones** con título derivado del primer prompt,
  borrado por chat, botón "Nueva conversación".
- **Selector de provider y modelo** — dos dropdowns (provider nativo,
  modelo en picker custom con info de tokens y check del activo).
- **Slider de `max_tokens`** que se ajusta automáticamente al máximo
  real del modelo seleccionado (tabla por familia: gpt-5, gpt-4o,
  claude-opus, claude-sonnet, etc.).
- **Composer** con botón de adjuntar (clip), drag & drop, paste de
  imágenes desde el portapapeles. Tipos soportados: imágenes
  (png/jpg/gif/webp), PDF (solo Anthropic), texto (md, json, csv,
  código fuente). Límite: 5 MB por archivo, 3 archivos por mensaje.
- **Mensajes** del asistente con markdown renderizado (headers, listas,
  bold/italic, code blocks, blockquotes, links, hr); del usuario con
  preview de adjuntos y texto en pre-wrap.
- **Empty state dinámico**: cada chat vacío genera un saludo creativo
  llamando al modelo rápido del provider activo (`gpt-4o-mini` o
  `claude-haiku-4-5`) con prompt de mood random — fallback inmediato
  desde una lista local mientras se espera la respuesta.
- **Typing indicator** estilo Telegram (3 puntos rebotando + halo
  pulsante en el avatar) durante la espera.
- **Footer de status** con dot indicador de color y fuente monospace
  (`pensando...` en naranja, `ok · 1234 ms` en verde, errores en rojo).
- **PWA instalable** (manifest, theme color, apple-touch-icon,
  `display: standalone`). Respeta `safe-area-inset-*` para iPhone con
  notch.
- **Mobile-first**: sidebar como drawer con overlay, hamburger en el
  topbar, tamaños de touch >38 px, viewport `100dvh` para que la URL
  bar de iOS no tape el composer, `font-size: 16 px` en el textarea
  para evitar zoom-on-focus en iOS.
- **Persistencia local** en `localStorage` con prefijo `openchaw_*`
  (chats, chat activo) y `tunnel_*` (preferencias: token, provider,
  modelo elegido, max_tokens por modelo, lista de modelos cacheada).

### `/run/` — terminal estilo iOS

UI dark con apariencia de ventana de macOS (traffic lights rojo / amarillo
/ verde) sobre `POST /api/run`:

- Campo `token` (persistido en localStorage), textarea con prompt `$`
  verde, dos botones: **Run** (sincrónico, espera ≤25 s) y
  **Enqueue + polling** (encola y poolea `GET /api/jobs/:id` cada
  segundo durante 60 s).
- Pill de estado con dot de color animado (`pending / running / done /
  error`).
- Tres paneles: `stdout`, `stderr` (con borde sutil rojo) y `meta` (id,
  exitCode, duración, error).

---

## API Gateway

La pieza más interesante. Reescribe cualquier llamada que parezca de OpenAI
o Anthropic a través del worker, **manteniendo la URL pública del sitio**.

### Detección automática del provider

| Path entrante | → provider |
|---|---|
| `/v1/messages`, `/v1/messages/batches/*`, `/v1/complete*` | Anthropic |
| `/v1/chat/*`, `/v1/embeddings`, `/v1/audio/*`, `/v1/images/*`, `/v1/files`, `/v1/responses`, `/v1/threads`, `/v1/assistants`, `/v1/batches`, `/v1/vector_stores`, `/v1/organization`, etc. | OpenAI |
| `/v1/models` con header `anthropic-version` | Anthropic |
| `/v1/models` (sin header) | OpenAI |
| `/anthropic/*` (prefijo explícito) | Anthropic |
| `/openai/*` (prefijo explícito) | OpenAI |

### Autenticación

El cliente pone su token de OpenChaw como:

- `x-api-key: <token>` (estilo Anthropic) **o**
- `Authorization: Bearer <token>` (estilo OpenAI)

El gateway valida, **strippa el header de auth del cliente** y reenvía el
resto al worker. El worker, al hacer `fetch()` real al provider, inyecta
la API key real desde sus env vars (`ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`).

Si `JOBS_CLIENT_TOKEN` está vacío en el entorno de Netlify, el gateway
deshabilita la auth (no recomendado en endpoints públicos).

### Compatibilidad con SDKs

```python
# Anthropic SDK
from anthropic import Anthropic
client = Anthropic(api_key="admin", base_url="https://tu-sitio.netlify.app")

# OpenAI SDK
from openai import OpenAI
client = OpenAI(api_key="admin", base_url="https://tu-sitio.netlify.app/v1")
```

```bash
# curl Anthropic
curl https://tu-sitio.netlify.app/v1/messages \
  -H "x-api-key: admin" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"Hola"}]}'

# curl OpenAI
curl https://tu-sitio.netlify.app/v1/chat/completions \
  -H "Authorization: Bearer admin" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hola"}]}'
```

> Nota sobre `base_url` en SDKs:
> el SDK de Anthropic concatena `/v1/messages` al `base_url`, así que **no**
> se le pone `/v1`. El SDK de OpenAI concatena `/chat/completions`, así que
> **sí** lleva `/v1` al final. Si los inviertes, llegará al gateway una URL
> con `/v1` duplicado y Anthropic devolverá 422.

### Streaming

`stream: true` se acepta y se entrega como **fake streaming**: el worker
hace la petición sin streaming, recibe la respuesta completa, y el gateway
reconstruye los eventos SSE estándar (Anthropic: `message_start /
content_block_start / content_block_delta×N / content_block_stop /
message_delta / message_stop`. OpenAI: `chat.completion.chunk` × N + `data:
[DONE]`). El texto se trocea en deltas de ~40 caracteres y se entrega con
un `ReadableStream` que enqueue cada evento con un *gap* de 8 ms para
forzar transferencia chunked real.

Esto hace que clientes que **exigen** SSE (OpenCode, Cline, Cursor,
Anthropic SDK `.stream()`) funcionen transparentemente. **No** simula el
efecto visual de tokens apareciendo uno a uno: la respuesta completa del
modelo se calcula primero y luego se entrega en chunks rápidos.

---

## Tabla completa de endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/jobs` | Bearer `JOBS_CLIENT_TOKEN` | Encola un job (`type: "shell" \| "http"`). |
| `GET` | `/api/jobs/next?wait=N` | Bearer `JOBS_WORKER_TOKEN` | Worker reclama el siguiente pendiente. `wait` ≤ 24 (long polling). |
| `POST` | `/api/jobs/:id/result` | Bearer `JOBS_WORKER_TOKEN` | Worker entrega resultado (mueve `active → archive`). |
| `GET` | `/api/jobs/:id` | Bearer `JOBS_CLIENT_TOKEN` | Cliente consulta estado / resultado. |
| `DELETE` | `/api/jobs/:id` | Bearer `JOBS_CLIENT_TOKEN` | Borra un job. |
| `DELETE` | `/api/jobs/archive` | Bearer `JOBS_CLIENT_TOKEN` | Vacía todos los blobs en `jobs-archive`. |
| `DELETE` | `/api/jobs/active` | Bearer `JOBS_CLIENT_TOKEN` | Vacía todos los blobs en `jobs-active`. |
| `POST` | `/api/run` | Bearer `JOBS_CLIENT_TOKEN` | Ejecuta comando shell y espera ≤25 s. |
| `POST` | `/api/proxy` | Bearer `JOBS_CLIENT_TOKEN` | Proxy HTTP con `{url, method, headers, body}`. |
| `*` | `/v1/*` | `x-api-key` o `Bearer` | Gateway transparente OpenAI/Anthropic. |
| `*` | `/anthropic/*` `/openai/*` | `x-api-key` o `Bearer` | Gateway con prefijo explícito. |

---

## Variables de entorno

### Netlify (sitio)

| Variable | Default si no se setea | Para qué |
|---|---|---|
| `JOBS_CLIENT_TOKEN` | `admin` | Auth que valida el gateway / proxy / run / jobs frente a clientes. |
| `JOBS_WORKER_TOKEN` | `admin` | Auth que valida `/api/jobs/next` y `/api/jobs/:id/result` frente al worker. |

Si están seteadas en el dashboard de Netlify, esos valores ganan. Si no,
el código usa `"admin"` por fallback (cómodo para empezar; **inseguro**
en sitios públicos).

### Worker (máquina local / Theia)

| Variable | Default | Para qué |
|---|---|---|
| `JOBS_BASE_URL` | `https://enviromentfree.netlify.app` | URL del sitio Netlify donde corre el backend. **Cambiar siempre.** |
| `JOBS_WORKER_TOKEN` | `admin` | Debe coincidir con el del sitio. |
| `LONG_POLL_SEC` | `24` | Segundos de espera por petición a `/api/jobs/next`. Máx 24. |
| `ERROR_BACKOFF_MS` | `5000` | Sleep tras error de red antes de reintentar. |
| `CMD_TIMEOUT_MS` | `30000` | Timeout para shell exec y para fetch HTTP del worker. |
| `VERBOSE` | `0` | `1` para logs detallados (latencia por poll, contenido de jobs, etc.). |
| `ANTHROPIC_API_KEY` | — | Inyectada como `x-api-key` cuando el destino es `api.anthropic.com`. |
| `OPENAI_API_KEY` | — | Inyectada como `Authorization: Bearer` cuando el destino es `api.openai.com`. |

---

## Despliegue

### Netlify

`netlify.toml` ya define `publish = "public"` y
`functions = "netlify/functions"`. No hay redirects manuales: cada Function
declara su propia `path` con `export const config`.

```bash
# desde el repo
npm install
npx netlify deploy --prod
```

O conecta el repo desde el dashboard de Netlify: cada push a `main` dispara
deploy automático.

### Worker en Theia (o cualquier Linux con node ≥ 20)

```bash
git clone https://github.com/IngARodriguez/netlify-backend.git
cd netlify-backend

export JOBS_BASE_URL=https://tu-sitio.netlify.app
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
# JOBS_WORKER_TOKEN no es necesario si dejaste el default "admin"

node worker/worker.js
```

Para correrlo en background con respawn automático: `pm2`, `systemd`,
`tmux`, `screen`, o el método que prefieras. El proceso es ligero
(<60 MB RAM, CPU casi cero en idle).

---

## Estructura del repositorio

```
netlify-backend/
├── README.md
├── package.json                        # dependencias mínimas (@netlify/blobs)
├── netlify.toml                        # publish/functions config
├── netlify/
│   └── functions/
│       ├── gateway.js                  # API gateway transparente
│       ├── proxy.js                    # /api/proxy
│       ├── run.js                      # /api/run
│       ├── jobs.js                     # cola jobs + DELETE archive/active
│       └── ping.js                     # health check
├── worker/
│   └── worker.js                       # proceso local que ejecuta jobs
├── public/
│   ├── index.html                      # dashboard
│   ├── manifest.webmanifest            # PWA manifest
│   ├── icon.svg                        # icon (ahora compartido con Anthropic)
│   ├── run/
│   │   └── index.html                  # terminal estilo iOS
│   └── tunnel/
│       ├── index.html                  # chat
│       ├── style.css                   # ~ 900 líneas
│       └── js/                         # 13 módulos ES nativos
│           ├── app.js
│           ├── attachments.js
│           ├── chat-list.js
│           ├── chats.js
│           ├── dom.js
│           ├── greeting.js
│           ├── icons.js
│           ├── markdown.js
│           ├── model-picker.js
│           ├── models.js
│           ├── render.js
│           ├── send.js
│           ├── status.js
│           └── ui.js
└── clients/
    └── powershell/
        └── theia-tunnel.ps1            # cliente PowerShell para /api/proxy
```

---

## Limitaciones conocidas

### Worker

- El worker debe estar **encendido** para que cualquier llamada al gateway,
  `/tunnel/` o `/run/` funcione. Sin worker, los jobs se quedan en `pending`
  hasta que el cliente o la Function expiren (504).
- El worker hace polling continuo: con `LONG_POLL_SEC=24` consume
  ~3,600 invocaciones de Function al día (≈ 108 k/mes). El runtime
  acumulado en idle es alto (24 h/día porque cada poll dura los 24 s
  esperando). En el plan free de Netlify (≈ 100 h/mes de runtime + 125 k
  invocaciones/mes), eso revienta el límite de runtime.

### Body / archivos

- Body máximo ~6 MB por la limitación de Netlify Functions. Imágenes
  grandes en `/v1/messages` o adjuntos pesados en `/tunnel/` pueden topar.
- El cuerpo de la respuesta del worker se trunca a 1 MB (configurable con
  `HTTP_BODY_CAP`) para no reventar el blob.
- `localStorage` del navegador (~ 5–10 MB total) limita cuántos chats con
  imágenes en historial se pueden guardar; al toparse, el código avisa
  con un status en rojo.

### Streaming

- `stream: true` se acepta pero el modelo responde **completo** primero;
  los chunks SSE son una emulación. Un cliente que mida latencia hasta el
  primer token verá cifras parecidas a no-streaming, no a streaming
  real.
- No hay soporte de cuerpo binario en respuesta (audio, imágenes
  generadas) aún; se devuelven como texto/json y algunos endpoints
  (`/v1/audio/speech`, `/v1/images/generations` con `b64_json`) pueden
  comportarse mal.

### Seguridad

- `JOBS_*_TOKEN` por defecto a `"admin"`: cualquier persona que descubra
  la URL pública del sitio puede ejecutar comandos shell y consumir las
  API keys del worker. Esto está pensado para desarrollo personal. En
  producción real conviene **setear** ambas variables en Netlify a un
  secreto fuerte y propagarlo al worker.
- `JOBS_CLIENT_TOKEN = ""` en Netlify deshabilita la validación del
  gateway. Útil para abrir endpoints públicos pero peligrosísimo si
  hay claves de pago en el worker.

### Otros

- No hay endpoint público de listado de chats (los chats viven solo en
  `localStorage` del navegador). Cambiar de navegador o limpiar datos =
  perderlos. No hay export/import.
- No hay registro de uso, métricas o quota por usuario/token. El gateway
  pasa todo al provider real y se cobra contra la cuenta del worker.

---

## Decisiones abiertas y trabajo futuro

Los siguientes puntos quedaron evaluados pero no implementados, en orden
aproximado de impacto:

1. **Backoff agresivo del worker en idle** para bajar el consumo de
   Functions de ~108 k/mes a ~3 k/mes a costa de añadir hasta varios
   minutos de latencia tras periodos largos sin uso.
2. **Push real desde Netlify hacia el worker** para eliminar el polling
   del todo. Requiere un canal del lado del worker:
   - Cloudflare Tunnel (puerto 7844, bloqueado en muchos sandbox tipo
     Theia).
   - Cloudflare Workers + WebSocket (puerto 443, casi siempre abierto).
3. **Streaming verdadero token-a-token** del modelo hasta el cliente.
   Posible vía polling de chunks en blobs (latencia ~250 ms entre
   chunks) o vía un canal push de la opción 2.
4. **Backend persistente para chats** (sincronización entre dispositivos,
   export/import) usando Netlify Blobs + endpoint protegido.
5. **Cuerpos binarios** (audio, imágenes generadas) en el worker.

---

## Licencia

MIT.
