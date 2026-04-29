const { getStore } = require("@netlify/blobs");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const store = getStore("messages");

  if (event.httpMethod === "DELETE") {
    const { blobs } = await store.list();
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ ok: true, deleted: blobs.length }),
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: "Method not allowed. Use GET." }),
    };
  }

  const { blobs } = await store.list();
  const messages = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: "json" }))
  );
  messages.sort((a, b) => (b?.receivedAt || "").localeCompare(a?.receivedAt || ""));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify({ count: messages.length, messages }),
  };
};
