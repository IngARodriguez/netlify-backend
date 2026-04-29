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

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const receivedAt = new Date().toISOString();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    receivedAt,
    ip:
      req.headers.get("x-nf-client-connection-ip") ||
      req.headers.get("x-forwarded-for") ||
      null,
    userAgent: req.headers.get("user-agent") || null,
    payload,
  };

  const store = getStore("messages");
  await store.setJSON(id, record);

  return json({ ok: true, id, receivedAt, echo: payload });
};

export const config = { path: "/api/webhook" };
