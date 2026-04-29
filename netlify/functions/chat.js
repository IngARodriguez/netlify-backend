import { getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(
      { error: "ANTHROPIC_API_KEY no está configurada en las env vars de Netlify." },
      500
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const {
    prompt,
    messages,
    system,
    model = "claude-haiku-4-5-20251001",
    max_tokens = 1024,
  } = body;

  const finalMessages = Array.isArray(messages) && messages.length
    ? messages
    : prompt
      ? [{ role: "user", content: prompt }]
      : null;

  if (!finalMessages) {
    return json({ error: "Falta 'prompt' (string) o 'messages' (array)." }, 400);
  }

  const anthropicBody = { model, max_tokens, messages: finalMessages };
  if (system) {
    anthropicBody.system = [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ];
  }

  const startedAt = Date.now();
  let r, data;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(anthropicBody),
    });
    data = await r.json();
  } catch (err) {
    return json({ error: "Fetch a Anthropic falló", message: err.message }, 502);
  }

  if (!r.ok) {
    return json({ error: "Anthropic error", status: r.status, details: data }, r.status);
  }

  const text = data.content?.[0]?.text ?? "";
  const latencyMs = Date.now() - startedAt;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    receivedAt: new Date().toISOString(),
    type: "chat",
    model: data.model,
    latencyMs,
    payload: { input: finalMessages, system: system || null },
    response: { text, usage: data.usage, stop_reason: data.stop_reason },
  };
  await getStore("messages").setJSON(id, record);

  return json({
    ok: true,
    id,
    text,
    model: data.model,
    usage: data.usage,
    latencyMs,
  });
};
