// Catálogo de endpoints del gateway y ejemplos de uso.
// Datos puros — sin DOM, sin fetch.  Render lo consume en render.js.

export const ENDPOINTS = [
  { method: 'POST', path: '/v1/messages',           provider: 'Anthropic', stream: 'sí', notes: 'Mensajes (Claude)' },
  { method: 'POST', path: '/v1/chat/completions',   provider: 'OpenAI',    stream: 'sí', notes: 'Chat completions' },
  { method: 'GET',  path: '/v1/models',             provider: 'auto',      stream: 'no', notes: 'Lista de modelos del provider activo' },
  { method: 'POST', path: '/v1/embeddings',         provider: 'OpenAI',    stream: 'no', notes: 'Embeddings' },
  { method: 'POST', path: '/v1/images/generations', provider: 'OpenAI',    stream: 'no', notes: 'Image gen (DALL-E, gpt-image)' },
  { method: 'POST', path: '/v1/audio/speech',       provider: 'OpenAI',    stream: 'no', notes: 'Text-to-speech' },
  { method: 'POST', path: '/v1/responses',          provider: 'OpenAI',    stream: 'no', notes: 'Responses API (gpt-5-pro, deep-research)' },
  { method: '*',    path: '/anthropic/*',           provider: 'Anthropic', stream: 'sí', notes: 'Prefijo explícito Anthropic' },
  { method: '*',    path: '/openai/*',              provider: 'OpenAI',    stream: 'sí', notes: 'Prefijo explícito OpenAI' },
];

// Cada ejemplo: { title, body }.  El body usa <span class="g-base"></span>
// y <span class="g-token"></span> que `fillPlaceholders` rellena en runtime.

export const TABS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    examples: [
      {
        title: 'curl — streaming',
        body: `curl -N <span class="g-base">BASE</span>/v1/messages \\
  -H "x-api-key: <span class="g-token">TOKEN</span>" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "stream": true,
    "messages": [{"role":"user","content":"Hola Claude"}]
  }'`,
      },
      {
        title: 'curl — no streaming',
        body: `curl <span class="g-base">BASE</span>/v1/messages \\
  -H "x-api-key: <span class="g-token">TOKEN</span>" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"Hola"}]
  }'`,
      },
      {
        title: 'Python SDK',
        body: `from anthropic import Anthropic

client = Anthropic(
    api_key="<span class="g-token">TOKEN</span>",
    base_url="<span class="g-base">BASE</span>",
)

# Streaming
with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=2048,
    messages=[{"role": "user", "content": "cuenta una historia"}],
) as s:
    for text in s.text_stream:
        print(text, end="", flush=True)`,
      },
      {
        title: 'JavaScript SDK',
        body: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey:  "<span class="g-token">TOKEN</span>",
  baseURL: "<span class="g-base">BASE</span>",
});

const stream = await client.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hola" }],
});
for await (const ev of stream) {
  if (ev.type === "content_block_delta") {
    process.stdout.write(ev.delta.text);
  }
}`,
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    examples: [
      {
        title: 'curl — streaming',
        body: `curl -N <span class="g-base">BASE</span>/v1/chat/completions \\
  -H "Authorization: Bearer <span class="g-token">TOKEN</span>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "stream": true,
    "messages": [{"role":"user","content":"Hola"}]
  }'`,
      },
      {
        title: 'curl — no streaming',
        body: `curl <span class="g-base">BASE</span>/v1/chat/completions \\
  -H "Authorization: Bearer <span class="g-token">TOKEN</span>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"Hola"}]
  }'`,
      },
      {
        title: 'Python SDK',
        body: `from openai import OpenAI

client = OpenAI(
    api_key="<span class="g-token">TOKEN</span>",
    base_url="<span class="g-base">BASE</span>/v1",
)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "cuenta una historia"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
      },
      {
        title: 'JavaScript SDK',
        body: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey:  "<span class="g-token">TOKEN</span>",
  baseURL: "<span class="g-base">BASE</span>/v1",
});

const stream = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hola" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}`,
      },
    ],
  },
  {
    id: 'tools',
    label: 'Cline / Cursor / OpenCode',
    examples: [
      {
        title: 'Cline — settings.json',
        body: `{
  "apiProvider": "anthropic",
  "anthropicBaseUrl": "<span class="g-base">BASE</span>",
  "anthropicApiKey": "<span class="g-token">TOKEN</span>",
  "anthropicModelId": "claude-sonnet-4-6"
}`,
      },
      {
        title: 'Cursor — Settings → Models',
        body: `OpenAI API Key:    <span class="g-token">TOKEN</span>
OpenAI Base URL:   <span class="g-base">BASE</span>/v1

Anthropic API Key: <span class="g-token">TOKEN</span>
Anthropic Base URL: <span class="g-base">BASE</span>`,
      },
      {
        title: 'OpenCode — opencode.json',
        body: `{
  "providers": {
    "anthropic": {
      "baseUrl": "<span class="g-base">BASE</span>",
      "apiKey":  "<span class="g-token">TOKEN</span>"
    },
    "openai": {
      "baseUrl": "<span class="g-base">BASE</span>/v1",
      "apiKey":  "<span class="g-token">TOKEN</span>"
    }
  }
}`,
      },
    ],
  },
];
