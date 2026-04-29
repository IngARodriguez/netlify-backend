# netlify-backend

Backend serverless con **Netlify Functions** para recibir solicitudes POST y persistirlas en **Netlify Blobs**.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/webhook` | Recibe un JSON, lo guarda y devuelve `{ok, id, receivedAt, echo}` |
| `GET`  | `/api/messages` | Lista todos los mensajes recibidos (más recientes primero) |
| `DELETE` | `/api/messages` | Borra todos los mensajes |

También hay UI:
- `/` → formulario para enviar un POST de prueba.
- `/messages.html` → tabla con todo lo recibido (con auto-refresh opcional).

## Estructura

- `netlify/functions/webhook.js` — recibe POST y guarda en Blobs.
- `netlify/functions/messages.js` — GET (listar) / DELETE (borrar todos).
- `public/index.html` — UI para enviar POST.
- `public/messages.html` — UI para ver lo recibido.
- `netlify.toml` — redirects y configuración.

## Probar localmente

```bash
npm install
npm install -g netlify-cli
netlify dev
```

Luego:
```bash
curl -X POST http://localhost:8888/api/webhook -H 'Content-Type: application/json' -d '{"hola":"mundo"}'
curl http://localhost:8888/api/messages
```

## Desplegar

Conecta el repo desde el dashboard de Netlify (Add new site → Import from GitHub) y se desplegará en cada push.
