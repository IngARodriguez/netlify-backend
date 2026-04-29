import { getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
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

  const store = getStore("messages");

  if (req.method === "DELETE") {
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, deleted: blobs.length });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed. Use GET." }, 405);
  }

  const { blobs } = await store.list();
  const messages = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: "json" }))
  );
  messages.sort((a, b) =>
    (b?.receivedAt || "").localeCompare(a?.receivedAt || "")
  );

  return json({ count: messages.length, messages });
};
