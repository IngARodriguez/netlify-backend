// Health checks live de las APIs disponibles via gateway.
//
// Sin endpoint backend nuevo: usamos /api/proxy y /v1/messages para detectar
// el estado real desde el navegador.  Cada check tiene timeout corto y
// devuelve { state, detail, ms }.
//
// Estados:
//   ok      → 200, healthy
//   warning → 429 / quota / rate-limit (esperado, vuelve solo)
//   error   → 5xx / timeout / auth fallida
//
// El worker NO se incluye aquí — esta página es sobre las APIs públicas.

const TIMEOUT_MS = 8000;

const CHECKS = [
  {
    id: 'openai',
    label: 'OpenAI',
    run: () => probeProxy('https://api.openai.com/v1/models', 'GET'),
  },
  {
    id: 'anthropic-stream',
    label: 'Anthropic streaming',
    run: () => probeAnthropicStream(),
  },
  {
    id: 'anthropic',
    label: 'Anthropic no-stream',
    run: () => probeProxy('https://api.anthropic.com/v1/models', 'GET', {
      'anthropic-version': '2023-06-01',
    }),
  },
];

function getToken() {
  return localStorage.getItem('JOBS_CLIENT_TOKEN') || 'admin';
}

async function probeProxy(url, method = 'GET', extraHeaders = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + getToken(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url, method,
        headers: extraHeaders,
        timeoutMs: 6000,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await r.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);

    if (!r.ok) {
      if (r.status === 401) return { state: 'error', detail: 'token inválido', ms };
      return { state: 'error', detail: `proxy HTTP ${r.status}`, ms };
    }
    if (data.status !== 'done' || !data.response) {
      return { state: 'error', detail: data.message || 'sin respuesta', ms };
    }

    const inner = data.response;
    if (inner.status === 200) return { state: 'ok', detail: `${ms}ms`, ms };
    if (inner.status === 429) {
      const msg = extractError(inner.body) || 'rate-limited';
      return { state: 'warning', detail: msg, ms };
    }
    return { state: 'error', detail: `provider HTTP ${inner.status}`, ms };
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    return {
      state: 'error',
      detail: err.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS}ms` : (err.message || 'error'),
      ms,
    };
  }
}

async function probeAnthropicStream() {
  const t0 = performance.now();
  let reader;
  try {
    const r = await fetch('/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': getToken(),
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!r.ok) {
      const ms = Math.round(performance.now() - t0);
      if (r.status === 401) return { state: 'error', detail: 'token inválido', ms };
      const text = await r.text().catch(() => '');
      const msg = extractError(text) || `HTTP ${r.status}`;
      return { state: r.status === 429 ? 'warning' : 'error', detail: msg, ms };
    }

    reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Suficiente con detectar el primer evento útil.
      if (buf.includes('message_start') || buf.includes('content_block_delta')) {
        const ms = Math.round(performance.now() - t0);
        return { state: 'ok', detail: `${ms}ms`, ms };
      }
      if (buf.includes('"error"')) {
        const ms = Math.round(performance.now() - t0);
        const msg = extractError(buf) || 'error en stream';
        return { state: 'warning', detail: msg, ms };
      }
    }
    const ms = Math.round(performance.now() - t0);
    return { state: 'error', detail: 'stream sin contenido', ms };
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    return {
      state: 'error',
      detail: err.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS}ms` : (err.message || 'error'),
      ms,
    };
  } finally {
    try { reader?.cancel(); } catch {}
  }
}

function extractError(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    const m = payload.match(/"error":\s*"([^"]+)"/) ||
              payload.match(/"message":\s*"([^"]+)"/);
    return m ? truncate(m[1], 80) : null;
  }
  if (typeof payload === 'object') {
    const msg =
      (typeof payload.error === 'string' ? payload.error : null) ||
      payload.error?.message ||
      payload.message;
    return msg ? truncate(msg, 80) : null;
  }
  return null;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Renderiza el panel.  `mode` puede ser:
//   'full'    → versión con label + detalle (para /gateway/)
//   'compact' → versión solo pills cortas (para /index)
export function renderStatusPanel(container, mode = 'full') {
  container.replaceChildren();
  const items = {};
  for (const c of CHECKS) {
    if (mode === 'compact') {
      const pill = document.createElement('span');
      pill.className = 'pill loading';
      pill.innerHTML = `<span class="dot"></span>${escapeHtml(c.label)}`;
      container.appendChild(pill);
      items[c.id] = { pill, mode };
    } else {
      const item = document.createElement('div');
      item.className = 'status-item';
      item.innerHTML = `
        <span class="pill loading"><span class="dot"></span>cargando</span>
        <span class="label">${escapeHtml(c.label)}</span>
        <span class="detail"></span>
      `;
      container.appendChild(item);
      items[c.id] = {
        pill: item.querySelector('.pill'),
        detail: item.querySelector('.detail'),
        mode,
      };
    }
  }
  return items;
}

export async function runHealthChecks(container, mode = 'full') {
  const items = renderStatusPanel(container, mode);

  await Promise.all(CHECKS.map(async (c) => {
    let result;
    try {
      result = await c.run();
    } catch (err) {
      result = { state: 'error', detail: err.message || 'error', ms: 0 };
    }
    const ui = items[c.id];
    if (!ui) return;

    const cls = result.state; // 'ok' | 'warning' | 'error'
    const stateText =
      cls === 'ok' ? 'disponible'
      : cls === 'warning' ? 'esperando'
      : 'error';

    ui.pill.className = 'pill ' + cls;
    if (ui.mode === 'compact') {
      ui.pill.innerHTML = `<span class="dot"></span>${escapeHtml(c.label)} · ${stateText}`;
    } else {
      ui.pill.innerHTML = `<span class="dot"></span>${stateText}`;
      if (ui.detail) ui.detail.textContent = result.detail || '';
    }
  }));

  return new Date();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
