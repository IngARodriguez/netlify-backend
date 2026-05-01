# OpenChaw

Backend serverless en Netlify + un worker en una máquina propia (típicamente
una instancia de Theia, pero sirve cualquier Linux con `node`) que actúa
como puente entre el navegador y las APIs de OpenAI / Anthropic, **sin
exponer las claves de los modelos al cliente**.

OpenChaw ofrece tres caras del mismo sistema:

1. **Un chat web** estilo claude.ai (`/tunnel/`) con sidebar de
   conversaciones, adjuntos, markdown, slider de tokens, modo PWA y
   **streaming token-a-token en tiempo real**.
2. **Una terminal web** (`/run/`) para ejecutar comandos shell en la máquina
   donde corre el worker.
3. **Un API gateway transparente** (`/v1/*`, `/anthropic/*`, `/openai/*`)
   con **streaming SSE real** que expone los endpoints de OpenAI y Anthropic
   con la URL de Netlify, listo para curl, Python, OpenCode, Cline, Cursor,
   SDKs oficiales, etc.

Las claves de OpenAI / Anthropic viven solo en el worker (variables de
entorno locales). El cliente solo necesita un token administrativo
(`JOBS_CLIENT_TOKEN`, por defecto `admin`) para hablar con OpenChaw.

---

## Características clave

- ✅ **Streaming real token-a-token** end-to-end, sin fake-stream. TTFT
  típico ~2 s para Sonnet/Opus.
- ✅ **El chat siempre entrega la respuesta** aunque tarde minutos —
  polling cliente con 10 min de margen.
- ✅ **Worker concurrente** — pool de N slots paralelos con claim atómico
  (CAS sobre etag) para evitar doble entrega.
- ✅ **API gateway compatible con SDKs** oficiales de Anthropic y OpenAI,
  además de OpenCode / Cline / Cursor / curl crudo.
- ✅ **Edge Functions** para los caminos calientes (long-poll, gateway
  streaming): 1M req/mes y sin cap de runtime separado en plan free.
- ✅ **Persistencia local** de chats con migración automática de claves
  antiguas. PWA instalable. Mobile-first. Adjuntos (imágenes / PDF /
  texto). System prompt por chat.
- ✅ **Tolerancia a fallos**: jobs huérfanos quedan recuperables por id en
  archive si la conexión cae a mitad de respuesta.

---

## Arquitectura

```
                                   ┌──────────────────────────────────┐
                                   │     Netlify Functions (HTTP)     │
                                   │   /api/proxy   /api/run          │
                                   │   /api/jobs    /api/jobs/:id     │
                                   │   /api/jobs/:id/result           │
                                   │   /api/jobs/:id/chunks           │
                                   └──────────────┬───────────────────┘
                                                  │
   ┌─────────────┐                                │
   │  Cliente    │ ────────► Edge Functions ◄────┤
   │ (browser,   │           /v1/*, /anthropic/*,│
   │  curl, SDK) │           /openai/*           │
   │             │           /api/jobs/next      │
   │             │ ◄──── streaming SSE ──────────┤
   └─────────────┘                                │
                                                  ▼
                                           ┌─────────────────┐
                                           │ Netlify Blobs   │
                                           │ ─ jobs-active   │
                                           │ ─ jobs-archive  │
                                           │ ─ jobs-chunks   │
                                           └────────┬────────┘
                                                    │
                          ┌─────────────────────────┘
                          │ long polling 24s
                          │ + claim atómico (CAS)
                          ▼
              ┌──────────────────────────┐    fetch streaming    ┌─────────────────────┐
              │  worker.js (en Theia)    │ ──────────────────►   │ api.openai.com /    │
              │  Pool de N slots         │ ◄── chunks SSE ────── │ api.anthropic.com   │
              │                          │                       └─────────────────────┘
              └──────────────────────────┘
                          │
                          │ POST /api/jobs/:id/chunks  (stream chunks)
                          │ POST /api/jobs/:id/result  (final + metadata)
                          ▼
                    Netlify Blobs
```

El cliente nunca toca directamente a OpenAI / Anthropic. Tampoco conoce las
API keys reales. La autenticación entre cliente y OpenChaw es independiente
de la autenticación entre OpenChaw y los proveedores.

---

## Componentes

### Edge Functions (`netlify/edge-functions/`)

Corren en Deno, plan free permite 1M invocaciones/mes y **no cobran
runtime aparte**. Timeout 30 s con streaming response soportado nativo.

| Archivo | Responsabilidad |
|---|---|
| `gateway.js` | API gateway transparente para `/v1/*`, `/anthropic/*`, `/openai/*`. Detecta provider, valida auth, encola job, y devuelve **streaming SSE real**: si `stream:true` lee chunks numerados de `jobs-chunks` conforme los escribe el worker; si `stream:false` mantiene la conexión viva con heartbeat (espacios en blanco para JSON, `: keepalive` para SSE) hasta que el resultado aparezca en archive. Cap real 28.5 s con cleanup de chunks al cerrar. |
| `jobs-next.js` | Long-poll del worker (`GET /api/jobs/next?wait=N`). Reclama jobs con **CAS atómico** (`onlyIfMatch` sobre etag) y verificación posterior por `claimId`, indispensable cuando hay >1 slot del worker llamando concurrentemente. Soporta wait hasta 29 s. |

### HTTP Functions (`netlify/functions/`)

Plan free: 125k invocaciones/mes + 100h runtime/mes. Timeout 26 s.
Útiles para operaciones cortas que no necesitan persistir conexiones.

| Archivo | Responsabilidad |
|---|---|
| `proxy.js` | `POST /api/proxy` — proxy HTTP genérico para que el frontend de `/tunnel/` haga peticiones arbitrarias a través del worker. Devuelve 202+id si excede 25 s para que el cliente continúe vía polling. |
| `run.js` | `POST /api/run` — encola comando shell y espera resultado hasta 25 s en la misma invocación. |
| `jobs.js` | Cola de trabajos: `POST /api/jobs` (encolar), `POST /api/jobs/:id/result` (worker entrega resultado), `POST /api/jobs/:id/chunks` (worker entrega chunks SSE en streaming), `DELETE /api/jobs/:id/chunks` (cleanup), `GET /api/jobs/:id` (consultar), `DELETE /api/jobs/:id` (borrar uno), `DELETE /api/jobs/{archive\|active}` (vaciar stores). |
| `ping.js` | Health-check trivial (`GET /.netlify/functions/ping`). |

### Worker (`worker/worker.js`)

Proceso Node 20+ que el usuario arranca en su máquina:

```bash
git clone https://github.com/IngARodriguez/netlify-backend
export JOBS_BASE_URL=https://tu-sitio.netlify.app
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
cd netlify-backend
node worker/worker.js
```

Características:

- **Pool concurrente**: arranca `WORKER_CONCURRENCY` slots paralelos
  (default 5, máx 50). Cada slot corre su propio bucle independiente de
  `claimNext → runJob → postResult`. Un Sonnet/4096-tokens ocupando un
  slot ya no bloquea respuestas ligeras en los demás slots.
- **Long-poll inteligente**: cada slot llama a `GET /api/jobs/next?wait=24`
  sobre la Edge Function. Idle = ~150 polls/h en total.
- **Streaming real al provider** (`runHttpStream`): cuando el job tiene
  `streaming: true`, el worker hace `fetch(provider, {stream:true})`,
  parsea los eventos SSE incrementalmente y los empuja en batches de
  ~150 ms o 4 chunks a `POST /api/jobs/:id/chunks`. La respuesta final
  reconstruida también se guarda en archive para que clientes
  no-streaming puedan recuperarla.
- **Modo no-streaming** (`runHttp`): si el job no es streaming, hace
  `fetch().text()` clásico y guarda el cuerpo entero en archive.
- **Modo shell** (`runShell`): `child_process.exec` con `bash`, max 30 s,
  buffer 1 MB.
- **Auto-auth**: inyecta automáticamente las API keys reales para
  Anthropic (`x-api-key` + `anthropic-dangerous-direct-browser-access`)
  y OpenAI (`Authorization: Bearer`) cuando el destino es
  `api.anthropic.com` o `api.openai.com`. Strippea `Origin/Referer` que
  pudieran haberse colado.
- **Timeouts separados**: `CMD_TIMEOUT_MS` (default 30 s) para shell,
  `HTTP_TIMEOUT_MS` (default 5 min) para fetch HTTP — antes era un solo
  cap que mataba respuestas largas a los 30 s.
- **Tolerante a barras finales** en `JOBS_BASE_URL`.

Token: por defecto `JOBS_WORKER_TOKEN = "admin"`. Solo hace falta
exportar uno distinto si lo cambiaste también en Netlify.

### Frontend (`public/`)

```
public/
├── index.html              ← dashboard
├── manifest.webmanifest    ← PWA
├── icon.svg
├── run/
│   └── index.html          ← terminal estilo macOS
└── tunnel/
    ├── index.html          ← chat
    ├── style.css
    └── js/                 ← módulos ES nativos, sin dependencias
```

Módulos del chat (`/tunnel/js/`):

| Módulo | Responsabilidad |
|---|---|
| `app.js` | Composición e inicialización (event wiring + IIFE final). |
| `dom.js` | Referencias DOM, `escapeHtml`, `paintRangeFill`. |
| `icons.js` | SVG inline de OpenAI / Anthropic / archivos. |
| `markdown.js` | Renderizador propio (~80 líneas), sin librerías. |
| `status.js` | Footer del composer con estados *idle / info / thinking / ok / error*. |
| `ui.js` | Drawer de settings, sidebar mobile, autoresize del textarea. |
| `models.js` | Catálogo, slider de `max_tokens` adaptativo, cache local. |
| `attachments.js` | File picker, drag & drop, paste, base64, `buildContentParts`. |
| `chats.js` | Persistencia en `localStorage`, migración, `CustomEvent`. |
| `greeting.js` | Saludos dinámicos del empty state. |
| `render.js` | `messageNode`, `emptyStateNode`, `typingNode`, `renderHistory`. |
| `chat-list.js` | Sidebar de conversaciones. |
| `model-picker.js` | Dropdown custom estilo claude.ai. |
| `system-prompt.js` | Tab de system prompt por chat (persistido). |
| **`stream.js`** | **Parser SSE async-iterable (`iterSSE`).** |
| `send.js` | Pipeline de envío. Si el caso es chat normal, abre SSE al gateway con `stream:true` y pinta tokens en vivo; si es image-gen o responses-API, va por `/api/proxy` con polling. |

---

## Streaming end-to-end

La pieza estrella. El flujo cuando un cliente pide `stream: true`:

```
Cliente ──SSE GET /v1/messages──► Edge Function gateway
                                    │
                                    ▼
                                  Netlify Blobs (jobs-active)
                                    │
                                    ▼ claim atómico
                                  Worker slot
                                    │
                                    ▼ fetch(provider, stream:true)
                                  api.anthropic.com / api.openai.com
                                    │
                                    ▼ ReadableStream → parse SSE → batches
                                  POST /api/jobs/:id/chunks (HTTP Function)
                                    │
                                    ▼ setJSON("chunks/{id}/{seq}", chunk)
                                  Netlify Blobs (jobs-chunks)
                                    ▲
                          gateway   │ poll cada 100ms
                                    │ tryEnqueue chunks en orden
                                    ▼
                          Cliente recibe SSE en tiempo real
                                    │
                                    ▼
                          worker termina → {done:true} → gateway cierra → cleanup
```

**Latencias típicas** (medidas en producción):

| Tarea | Antes | Ahora |
|---|---|---|
| TTFT Sonnet 4096 tokens | 30-80 s (esperaba completo) | **~2 s** |
| Sonnet ensayo 30 párrafos | 504 a los 25 s | **chunks fluyendo continuamente, ~28 s totales** |
| Haiku "hola" | ~3 s | ~3 s (sin diferencia visible) |
| 5 prompts paralelos | serializados (3-10 s cada uno) | **paralelos (~3 s cada uno)** |

**Compatible con**:

```python
# Anthropic SDK
from anthropic import Anthropic
client = Anthropic(api_key="admin", base_url="https://tu-sitio.netlify.app")
with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=2048,
    messages=[{"role": "user", "content": "cuenta una historia"}],
) as s:
    for text in s.text_stream:
        print(text, end="", flush=True)

# OpenAI SDK
from openai import OpenAI
client = OpenAI(api_key="admin", base_url="https://tu-sitio.netlify.app/v1")
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "cuenta una historia"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

**Heartbeat**: si el provider tarda en empezar, el gateway emite cada 5 s
un keepalive — un espacio en blanco para JSON (válido como prefix), un
comentario SSE (`: keepalive\n\n`) para streams. La conexión TCP queda
viva sin tocar el wire format del provider.

**Edge timeout**: las Edge Functions de Netlify cortan a los 30 s. Dejamos
margen y cerramos a los 28.5 s. Si el provider aún no terminó, el gateway
emite un comentario `: edge_timeout id=<job_id>` y cierra. El job sigue
corriendo en el worker y queda en `jobs-archive`, recuperable con:

```bash
curl -H "Authorization: Bearer admin" \
  https://tu-sitio.netlify.app/api/jobs/<id>
```

---

## Aplicaciones web

### `/` — dashboard

Landing del sitio. Lista las apps, documenta los endpoints del gateway,
ofrece snippets copiables con la URL del sitio rellenada
automáticamente, e incluye un botón de mantenimiento para vaciar los
blobs acumulados.

### `/tunnel/` — OpenChaw chat

Chat web estilo claude.ai con **streaming token-a-token**:

- **Sidebar de conversaciones** con título derivado del primer prompt,
  borrado por chat, botón "Nueva conversación".
- **System prompt por chat** persistido en localStorage.
- **Selector de provider y modelo** — dos dropdowns (provider nativo,
  modelo en picker custom con info de tokens y check del activo).
- **Slider de `max_tokens`** ajustado al máximo real del modelo
  seleccionado.
- **Composer** con adjuntar (clip), drag & drop, paste de imágenes desde
  portapapeles. Tipos: imágenes (png/jpg/gif/webp), PDF (solo
  Anthropic), texto / código fuente. Límite: 5 MB por archivo, 3 archivos
  por mensaje.
- **Streaming en vivo**: status footer pasa por
  `pensando...` → `stream · 234 chars · 4s` → `ok · 12345 ms`. El texto
  fluye carácter a carácter en pantalla.
- **Polling cliente como fallback** (10 min) para casos no-streaming
  (image-gen, responses-API): si `/api/proxy` devuelve 202 con id, el
  cliente sigue poleando hasta que el job termine.
- **Mensajes** del asistente con markdown renderizado; del usuario con
  preview de adjuntos y texto en pre-wrap.
- **Empty state dinámico**: cada chat vacío genera un saludo creativo
  llamando al modelo rápido del provider activo.
- **Typing indicator** estilo Telegram durante el TTFT.
- **PWA instalable** con `display: standalone`, `safe-area-inset-*`,
  manifest, theme color, apple-touch-icon.
- **Mobile-first**: drawer con overlay, hamburger, viewport `100dvh`,
  font-size 16px en textarea para evitar zoom-on-focus en iOS.
- **Persistencia local** en `localStorage` con prefijo `openchaw_*` y
  `tunnel_*`. Migración automática desde claves `outpost_*` y
  `tunnel_hist_*` viejas.

### `/run/` — terminal estilo macOS

UI dark con apariencia de ventana de macOS sobre `POST /api/run`:

- Campo `token` (persistido), textarea con prompt `$` verde, botones
  **Run** (sincrónico, ≤25 s) y **Enqueue + polling** (encola y poolea
  cada segundo durante 60 s).
- Pill de estado animado (`pending / running / done / error`).
- Tres paneles: `stdout`, `stderr` (borde rojo), `meta` (id, exitCode,
  duración, error).

---

## API Gateway

Reescribe cualquier llamada que parezca de OpenAI o Anthropic a través
del worker, **manteniendo la URL pública del sitio**.

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

El gateway valida, **strippa el header de auth del cliente** y reenvía
el resto al worker. El worker, al hacer `fetch()` real al provider,
inyecta la API key real desde sus env vars (`ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`).

Los headers solo-de-navegador (`Origin`, `Referer`, `Cookie`,
`Sec-Fetch-*`, `Sec-Ch-*`) se descartan en el gateway antes de pasar al
worker — Anthropic los rechazaría con CORS error si llegaran.

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
# curl Anthropic — streaming real
curl -N https://tu-sitio.netlify.app/v1/messages \
  -H "x-api-key: admin" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "stream": true,
    "messages": [{"role":"user","content":"Hola"}]
  }'

# curl OpenAI — sin stream
curl https://tu-sitio.netlify.app/v1/chat/completions \
  -H "Authorization: Bearer admin" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hola"}]}'
```

> Nota sobre `base_url`: el SDK de Anthropic concatena `/v1/messages`
> al `base_url`, así que **no** se le pone `/v1`. El SDK de OpenAI
> concatena `/chat/completions`, así que **sí** lleva `/v1` al final. Si
> los inviertes, llegará al gateway una URL con `/v1` duplicado y el
> provider devolverá 422.

---

## Tabla completa de endpoints

| Método | Ruta | Tipo | Auth | Descripción |
|---|---|---|---|---|
| `POST` | `/api/jobs` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Encola un job (`type: "shell" \| "http"`). |
| `GET` | `/api/jobs/next?wait=N` | **Edge** | Bearer `JOBS_WORKER_TOKEN` | Worker reclama el siguiente pendiente con CAS atómico. `wait` ≤ 29. |
| `POST` | `/api/jobs/:id/result` | HTTP | Bearer `JOBS_WORKER_TOKEN` | Worker entrega resultado final (mueve `active → archive`). |
| `POST` | `/api/jobs/:id/chunks` | HTTP | Bearer `JOBS_WORKER_TOKEN` | Worker entrega un batch de chunks SSE para streaming. |
| `DELETE` | `/api/jobs/:id/chunks` | HTTP | Bearer `JOBS_*_TOKEN` | Limpia los chunks de un job (post-stream). |
| `GET` | `/api/jobs/:id` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Consulta estado / resultado completo. |
| `DELETE` | `/api/jobs/:id` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Borra un job. |
| `DELETE` | `/api/jobs/archive` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Vacía todos los blobs en `jobs-archive`. |
| `DELETE` | `/api/jobs/active` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Vacía todos los blobs en `jobs-active`. |
| `POST` | `/api/run` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Ejecuta comando shell y espera ≤25 s. |
| `POST` | `/api/proxy` | HTTP | Bearer `JOBS_CLIENT_TOKEN` | Proxy HTTP genérico vía worker. |
| `*` | `/v1/*` | **Edge** | `x-api-key` o `Bearer` | Gateway transparente con streaming SSE real. |
| `*` | `/anthropic/*` `/openai/*` | **Edge** | `x-api-key` o `Bearer` | Gateway con prefijo explícito. |

---

## Variables de entorno

### Netlify (sitio)

| Variable | Default si no se setea | Para qué |
|---|---|---|
| `JOBS_CLIENT_TOKEN` | `admin` | Auth que valida el gateway / proxy / run / jobs frente a clientes. |
| `JOBS_WORKER_TOKEN` | `admin` | Auth que valida `/api/jobs/next` y `/api/jobs/:id/result|chunks` frente al worker. |

### Worker (máquina local / Theia)

| Variable | Default | Para qué |
|---|---|---|
| `JOBS_BASE_URL` | `https://enviromentfree.netlify.app` | URL del sitio Netlify donde corre el backend. **Cambiar siempre.** Tolerante a barras finales. |
| `JOBS_WORKER_TOKEN` | `admin` | Debe coincidir con el del sitio. |
| `LONG_POLL_SEC` | `24` | Segundos de espera por petición a `/api/jobs/next`. Máx 24 (la Edge Function aguanta 29 con margen). |
| `ERROR_BACKOFF_MS` | `5000` | Sleep tras error de red antes de reintentar. |
| `CMD_TIMEOUT_MS` | `30000` | Timeout para shell exec. |
| `HTTP_TIMEOUT_MS` | `300000` (5 min) | Timeout para fetch HTTP del worker — separado de shell para no matar respuestas largas de modelos. |
| `WORKER_CONCURRENCY` | `5` | Número de slots paralelos del pool del worker. Min 1, max 50. |
| `VERBOSE` | `0` | `1` para logs detallados (latencia por poll, contenido de jobs, etc.). |
| `ANTHROPIC_API_KEY` | — | Inyectada como `x-api-key` cuando el destino es `api.anthropic.com`. |
| `OPENAI_API_KEY` | — | Inyectada como `Authorization: Bearer` cuando el destino es `api.openai.com`. |

---

## Capacidad y rendimiento

Estimaciones reales medidas contra Netlify free + worker pool 5:

| Carga | Aguanta | Comentario |
|---|---|---|
| 1 usuario, chat web casual | ✅ holgado | <5% del cap mensual |
| 1 agente (Cline / OpenCode / Cursor) | ✅ sin tocar nada | ~3-5 req/min sostenido |
| 3 agentes paralelos | ✅ con default | Worker pool de 5 atiende sin colas |
| 5-10 agentes paralelos | ✅ con `WORKER_CONCURRENCY=10` | Vigilar cap HTTP Functions (cada chunk es 1 invocación) |
| 10+ agentes / sesiones de horas en streaming | ⚠️ rozas el cap free de HTTP Functions | Considerar Pro de Netlify ($19/mes → 1M HTTP req + 500h runtime) |
| Producción multi-usuario | ❌ worker single-host | Necesita arquitectura redundante |

**Cuellos de botella reales**:

1. **HTTP Functions** (125k/mes free): cada respuesta streaming genera
   5-15 invocaciones de `/api/jobs/:id/chunks`. Es el primer cap que se
   alcanza con uso intenso.
2. **Cap 28.5 s del Edge Function**: respuestas que el provider tarda más
   de eso en producir se truncan para el cliente streaming, aunque el
   job se completa en archive y es recuperable por id.
3. **Rate limit del provider**: Anthropic ~50 req/min, OpenAI similar
   según tier. Te frena antes que Netlify en uso intenso.
4. **Worker single-host**: si tu Theia se apaga, todo cae.

**Tunables sin tocar código**:

```bash
# Más slots paralelos para alta concurrencia
export WORKER_CONCURRENCY=20

# Aceptar respuestas más largas (default 5 min)
export HTTP_TIMEOUT_MS=600000

# Ver lo que pasa en detalle
export VERBOSE=1
```

---

## Despliegue

### Netlify

`netlify.toml` ya define `publish = "public"` y
`functions = "netlify/functions"`. Las Edge Functions se autodetectan en
`netlify/edge-functions/`. Cada Function declara su propia `path` con
`export const config`.

```bash
# desde el repo
npm install
npx netlify deploy --prod
```

O conecta el repo desde el dashboard de Netlify: cada push a `main`
dispara deploy automático.

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
(<60 MB RAM con concurrencia 5, CPU casi cero en idle).

---

## Estructura del repositorio

```
netlify-backend/
├── README.md
├── package.json                        # @netlify/blobs ^10.7.4
├── netlify.toml                        # publish/functions config
├── netlify/
│   ├── functions/                      # HTTP Functions (cap 26s)
│   │   ├── proxy.js                    # /api/proxy
│   │   ├── run.js                      # /api/run
│   │   ├── jobs.js                     # /api/jobs/*  (cola + chunks endpoint)
│   │   └── ping.js                     # health check
│   └── edge-functions/                 # Edge Functions (cap 30s, sin runtime cap)
│       ├── gateway.js                  # /v1/*  /anthropic/*  /openai/*  con streaming SSE
│       └── jobs-next.js                # /api/jobs/next  long-poll con CAS atómico
├── worker/
│   └── worker.js                       # pool concurrente, runHttp + runHttpStream
├── public/
│   ├── index.html                      # dashboard
│   ├── manifest.webmanifest            # PWA
│   ├── icon.svg
│   ├── run/
│   │   └── index.html                  # terminal estilo macOS
│   └── tunnel/
│       ├── index.html                  # chat
│       ├── style.css
│       └── js/
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
│           ├── send.js                 # streaming + polling fallback
│           ├── status.js
│           ├── stream.js               # parser SSE async-iterable
│           ├── system-prompt.js
│           └── ui.js
└── clients/
    └── powershell/
        └── theia-tunnel.ps1            # cliente PowerShell para /api/proxy
```

---

## Limitaciones conocidas

### Worker

- El worker debe estar **encendido** para que cualquier llamada al
  gateway, `/tunnel/` o `/run/` funcione. Sin worker, los jobs se quedan
  en `pending` hasta que el cliente o la Function expiren.
- El worker hace polling continuo: con `LONG_POLL_SEC=24` consume
  ~3,600 invocaciones/día sobre `jobs/next` (Edge), unas 108k/mes.
  El plan free de Edge Functions cubre 1M, así que sobra.

### Cap del Edge Function (28.5 s)

- Para streaming, si el provider tarda más de 28.5 s en producir la
  respuesta completa, el cliente recibe los primeros chunks y luego un
  comentario `: edge_timeout id=<job_id>` y la conexión cierra.
- El job sigue completándose en el worker y la respuesta queda en
  `jobs-archive` durante un tiempo, recuperable con
  `GET /api/jobs/:id`.
- El chat web **no se ve afectado por este cap** porque el flujo via
  `/api/proxy` usa polling cliente con 10 min de margen.

### Body / archivos

- Body máximo ~6 MB por la limitación de Netlify Functions. Imágenes
  grandes en `/v1/messages` o adjuntos pesados en `/tunnel/` pueden
  topar.
- El cuerpo de la respuesta del worker (modo no-streaming) se trunca a
  1 MB (configurable con `HTTP_BODY_CAP`) para no reventar el blob.
- `localStorage` del navegador (~5–10 MB total) limita cuántos chats con
  imágenes en historial se pueden guardar; al toparse, el código avisa
  con un status en rojo.

### Streaming

- Body binario en respuesta (audio, imágenes generadas) sigue sin
  soporte completo en streaming; los endpoints
  `/v1/audio/speech`, `/v1/images/generations` con `b64_json` van por
  el flujo no-streaming (modo polling).

### Seguridad

- `JOBS_*_TOKEN` por defecto a `"admin"`: cualquier persona que
  descubra la URL pública del sitio puede ejecutar comandos shell y
  consumir las API keys del worker. Esto está pensado para desarrollo
  personal. En producción real conviene **setear** ambas variables en
  Netlify a un secreto fuerte y propagarlo al worker.
- `JOBS_CLIENT_TOKEN = ""` en Netlify deshabilita la validación del
  gateway. Útil para abrir endpoints públicos pero peligrosísimo si hay
  claves de pago en el worker.

### Otros

- No hay endpoint público de listado de chats (los chats viven solo en
  `localStorage` del navegador). Cambiar de navegador o limpiar datos =
  perderlos. No hay export/import.
- No hay registro de uso, métricas o quota por usuario/token. El gateway
  pasa todo al provider real y se cobra contra la cuenta del worker.

---

## Trabajo futuro

Pendientes priorizados:

1. **Refactor `_lib/queue.js`**: extraer la duplicación entre
   `proxy.js`, `run.js` y la parte HTTP del antiguo gateway que aún
   queda en `jobs.js`. ~120 líneas menos, una sola fuente de verdad.
2. **Persistencia de chats backend**: endpoint `/api/chats` con Blobs
   por token-hash, sincronización entre dispositivos, export/import.
3. **TTL automático de blobs viejos**: función diaria que limpia
   `archive` y `chunks` huérfanos > 24 h.
4. **Backoff adaptativo en worker idle**: si N polls vacíos
   consecutivos, dormir M minutos antes del siguiente. Ahorro extra de
   invocaciones a costa de latencia post-idle.
5. **Resume from chunk N**: endpoint que reanuda un stream desde donde
   quedó tras `edge_timeout`, para que clientes externos no pierdan la
   parte truncada.
6. **Worker multi-host con coordinación**: hoy el CAS atómico ya
   permite >1 worker hablando con el mismo sitio. Falta operacionalizar
   un esquema de health-check para failover.

---

## Licencia

MIT.
