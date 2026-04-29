# netlify-backend

Backend serverless con **Netlify Functions** para recibir solicitudes POST.

## Endpoint

```
POST https://<tu-sitio>.netlify.app/api/webhook
Content-Type: application/json
```

Devuelve un JSON con `ok: true`, `receivedAt` y un `echo` del payload recibido.

## Estructura

- `netlify/functions/webhook.js` — la función serverless que recibe el POST.
- `public/index.html` — página estática simple para probar el endpoint desde el navegador.
- `netlify.toml` — configuración (publish dir, functions dir, redirect `/api/webhook`).

## Probar localmente

```bash
npm install -g netlify-cli
netlify dev
```

Luego: `curl -X POST http://localhost:8888/api/webhook -H 'Content-Type: application/json' -d '{"hola":"mundo"}'`

## Desplegar

1. `netlify login`
2. `netlify init` (vincula el repo de GitHub)
3. `netlify deploy --prod`

O conecta el repo desde el dashboard de Netlify y se desplegará automáticamente en cada push.

## Probar el endpoint desplegado

```bash
curl -X POST https://<tu-sitio>.netlify.app/api/webhook \
  -H 'Content-Type: application/json' \
  -d '{"mensaje":"hola"}'
```
