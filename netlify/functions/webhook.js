const { getStore } = require("@netlify/blobs");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: "Method not allowed. Use POST." }),
    };
  }

  let payload;
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const receivedAt = new Date().toISOString();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    receivedAt,
    ip: event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || null,
    userAgent: event.headers["user-agent"] || null,
    payload,
  };

  const store = getStore("messages");
  await store.setJSON(id, record);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify({ ok: true, id, receivedAt, echo: payload }),
  };
};
