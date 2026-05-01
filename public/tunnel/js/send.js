import {
  tokenInput, providerSel, modelSel, maxTokensInput,
  messagesEl, conversationEl, sendBtn,
} from './dom.js';
import { setStatus } from './status.js';
import { openDrawer } from './ui.js';
import { getHistory, setHistory, getCurrentChat } from './chats.js';
import { renderHistory, typingNode, appendInline } from './render.js';
import { brandSVG } from './icons.js';
import { renderMarkdown } from './markdown.js';
import {
  pendingAttachments, clearAttachments, buildContentParts,
} from './attachments.js';
import { requiresResponsesAPI, isImageModel } from './models.js';
import { iterSSE } from './stream.js';

function buildRequest(history, userMessage) {
  const provider = providerSel.value;
  const model = modelSel.value;
  const maxTokens = Number(maxTokensInput.value) || 2048;
  const systemPrompt = (getCurrentChat().systemPrompt || '').trim();

  if (provider === 'openai') {
    if (isImageModel(model)) {
      const promptText = extractPromptText(userMessage);
      return {
        kind: 'image',
        url: 'https://api.openai.com/v1/images/generations',
        body: { model, prompt: promptText, n: 1, size: '1024x1024' },
        extract: extractImageResponse,
      };
    }
    if (requiresResponsesAPI(model)) {
      const input = [...history, userMessage].map(toResponsesInput);
      const body = { model, input, max_output_tokens: maxTokens };
      if (systemPrompt) body.instructions = systemPrompt;
      return {
        kind: 'responses',
        url: 'https://api.openai.com/v1/responses',
        body,
        extract: extractResponsesText,
      };
    }
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...history, userMessage]
      : [...history, userMessage];
    return {
      kind: 'chat',
      url: 'https://api.openai.com/v1/chat/completions',
      body: { model, messages },
      extract: (r) => r.body.choices[0].message.content,
    };
  }
  const messages = [...history, userMessage];
  const body = { model, max_tokens: maxTokens, messages };
  if (systemPrompt) body.system = systemPrompt;
  return {
    kind: 'chat',
    url: 'https://api.anthropic.com/v1/messages',
    body,
    extract: (r) => r.body.content[0].text,
  };
}

function toResponsesInput(msg) {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content };
  }
  if (!Array.isArray(msg.content)) {
    return { role: msg.role, content: String(msg.content ?? '') };
  }
  const parts = msg.content.map((p) => {
    if (p.type === 'text') {
      return {
        type: msg.role === 'assistant' ? 'output_text' : 'input_text',
        text: p.text || '',
      };
    }
    if (p.type === 'image_url' && p.image_url) {
      return { type: 'input_image', image_url: p.image_url.url };
    }
    return p;
  });
  return { role: msg.role, content: parts };
}

function extractPromptText(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text || '')
      .join('\n')
      .trim();
  }
  return '';
}

function extractImageResponse(r) {
  const item = r.body && Array.isArray(r.body.data) ? r.body.data[0] : null;
  if (!item) return '';
  if (item.b64_json) {
    return [{
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: item.b64_json },
    }];
  }
  if (item.url) {
    return [{ type: 'image_url', image_url: { url: item.url } }];
  }
  return '';
}

function extractResponsesText(r) {
  const b = r.body || {};
  if (typeof b.output_text === 'string' && b.output_text.length) return b.output_text;
  const out = Array.isArray(b.output) ? b.output : [];
  for (const item of out) {
    if (item && item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c && c.type === 'output_text' && typeof c.text === 'string') return c.text;
      }
    }
  }
  return '';
}

const POLL_INTERVAL_MS = 1500;
const POLL_DEADLINE_MS = 10 * 60 * 1000; // 10 min

async function pollJobUntilDone(token, id, t0) {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const r = await fetch('/api/jobs/' + id, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await r.json();
    if (!r.ok) {
      throw new Error('polling HTTP ' + r.status + ': ' + (data.error || 'desconocido'));
    }
    const job = data.job;
    if (!job) throw new Error('polling: respuesta sin job');
    if (job.status === 'done' || job.status === 'error') return job;
    setStatus('pensando · ' + Math.floor((Date.now() - t0) / 1000) + 's');
  }
  throw new Error('superado el tope de espera (10 min)');
}

function makeAssistantNode(provider) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant msg-streaming';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = brandSVG(provider);
  const body = document.createElement('div');
  body.className = 'msg-body md';
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return { wrap, body };
}

async function sendStreaming({ token, provider, req, newHistory, typing, t0 }) {
  const isAnthropic = provider === 'anthropic';
  const path = isAnthropic ? '/v1/messages' : '/v1/chat/completions';
  const headers = isAnthropic
    ? { 'x-api-key': token, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  const r = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...req.body, stream: true }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    setStatus('HTTP ' + r.status + ': ' + text.slice(0, 120), 'error');
    if (typing.isConnected) typing.remove();
    appendInline('error', text || ('HTTP ' + r.status));
    return;
  }

  let assistantWrap = null;
  let assistantBody = null;
  let acc = '';
  let edgeTimeout = false;
  let streamError = null;
  let eventCount = 0;

  const ensureNode = () => {
    if (assistantBody) return;
    const node = makeAssistantNode(provider);
    assistantWrap = node.wrap;
    assistantBody = node.body;
    if (typing.isConnected) typing.replaceWith(assistantWrap);
    else messagesEl.appendChild(assistantWrap);
  };

  const repaint = () => {
    if (!assistantBody) return;
    assistantBody.innerHTML = renderMarkdown(acc);
    conversationEl.scrollTop = conversationEl.scrollHeight;
  };

  try {
    for await (const ev of iterSSE(r)) {
      eventCount++;
      if (ev.event === '__comment__') {
        if (ev.raw && ev.raw.includes(':edge_timeout')) edgeTimeout = true;
        continue;
      }

      let piece = '';
      if (isAnthropic) {
        if (ev.event === 'message_stop') break;
        if (ev.event === 'error') { streamError = ev.data; break; }
        if (ev.data && ev.data.type === 'error') { streamError = ev.data; break; }
        if (ev.event === 'content_block_delta') {
          piece = (ev.data && ev.data.delta && ev.data.delta.text) || '';
        }
      } else {
        if (ev.data === '[DONE]') break;
        if (ev.data && ev.data.error) { streamError = ev.data.error; break; }
        const choice = ev.data && ev.data.choices && ev.data.choices[0];
        piece = (choice && choice.delta && choice.delta.content) || '';
      }

      if (piece) {
        ensureNode();
        acc += piece;
        repaint();
        setStatus(
          'stream · ' + acc.length + ' chars · ' +
          Math.floor((Date.now() - t0) / 1000) + 's'
        );
      }
    }
  } catch (e) {
    streamError = streamError || { type: 'transport', message: e.message };
  }

  if (acc) {
    if (assistantWrap) assistantWrap.classList.remove('msg-streaming');
    setHistory([...newHistory, { role: 'assistant', content: acc }]);
    renderHistory();
    const ms = Date.now() - t0;
    if (streamError) {
      const m = streamError.message || streamError.error?.message || JSON.stringify(streamError);
      setStatus('parcial · ' + String(m).slice(0, 100), 'error');
    } else if (edgeTimeout) {
      setStatus('ok · ' + ms + ' ms (parcial · cap del Edge alcanzado)');
    } else {
      setStatus('ok · ' + ms + ' ms');
    }
  } else {
    if (typing.isConnected) typing.remove();
    if (streamError) {
      const m = streamError.message || streamError.error?.message || JSON.stringify(streamError);
      setStatus('error: ' + String(m).slice(0, 120), 'error');
      appendInline('error', JSON.stringify(streamError, null, 2));
    } else if (edgeTimeout) {
      setStatus('cap del Edge antes del primer chunk · 0 chars · ' + eventCount + ' eventos', 'error');
    } else {
      setStatus('sin contenido · ' + eventCount + ' eventos vistos', 'error');
    }
  }
}

async function sendViaProxy({ token, req, newHistory, typing, t0 }) {
  const r = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: req.url, method: 'POST', body: req.body }),
  });
  const data = await r.json();
  if (!r.ok && r.status !== 202) {
    setStatus('HTTP ' + r.status + ': ' + (data.error || ''), 'error');
    appendInline('error', JSON.stringify(data, null, 2));
    return;
  }

  let final = data;
  if (data.status === 'pending' || data.status === 'running') {
    try {
      const job = await pollJobUntilDone(token, data.id, t0);
      final = {
        status: job.status,
        response: job.response,
        error: job.error,
        durationMs: job.durationMs,
        id: job.id,
      };
    } catch (e) {
      setStatus(e.message, 'error');
      return;
    }
  }

  if (final.status === 'error' || final.error) {
    setStatus('error worker: ' + (final.error || 'sin detalle'), 'error');
    appendInline('error', JSON.stringify(final, null, 2));
    return;
  }
  if (final.status !== 'done' || !final.response) {
    setStatus('status=' + final.status + ' ' + (final.message || final.error || ''), 'error');
    return;
  }
  let text;
  try { text = req.extract(final.response); }
  catch (e) {
    setStatus('parse error: ' + e.message, 'error');
    appendInline('error', JSON.stringify(final.response, null, 2));
    return;
  }
  if (typing.isConnected) typing.remove();
  setHistory([...newHistory, { role: 'assistant', content: text }]);
  renderHistory();
  setStatus('ok · ' + (Date.now() - t0) + ' ms');
}

export async function send(prompt) {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus('falta el token en settings', 'error');
    openDrawer();
    return;
  }
  const provider = providerSel.value;
  const attachments = pendingAttachments.slice();
  if (!prompt && !attachments.length) return;

  const userContent = buildContentParts(prompt, attachments, provider);
  const userMessage = { role: 'user', content: userContent };
  const history = getHistory();
  const newHistory = [...history, userMessage];
  setHistory(newHistory);
  clearAttachments();
  renderHistory();

  const typing = typingNode();
  messagesEl.appendChild(typing);
  conversationEl.scrollTop = conversationEl.scrollHeight;

  sendBtn.disabled = true;
  setStatus('pensando...');
  const t0 = Date.now();
  try {
    const req = buildRequest(history, userMessage);
    if (req.kind === 'chat') {
      await sendStreaming({ token, provider, req, newHistory, typing, t0 });
    } else {
      // image / responses-api: por ahora no streamean, vamos por /api/proxy.
      await sendViaProxy({ token, req, newHistory, typing, t0 });
    }
  } catch (e) {
    setStatus('fallo: ' + e.message, 'error');
    if (typing.isConnected) typing.remove();
  } finally {
    sendBtn.disabled = false;
  }
}
