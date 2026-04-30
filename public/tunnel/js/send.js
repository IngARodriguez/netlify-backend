import {
  tokenInput, providerSel, modelSel, maxTokensInput,
  messagesEl, conversationEl, sendBtn,
} from './dom.js';
import { setStatus } from './status.js';
import { openDrawer } from './ui.js';
import { getHistory, setHistory, getCurrentChat } from './chats.js';
import { renderHistory, typingNode, appendInline } from './render.js';
import {
  pendingAttachments, clearAttachments, buildContentParts,
} from './attachments.js';
import { requiresResponsesAPI, isImageModel } from './models.js';

function buildRequest(history, userMessage) {
  const provider = providerSel.value;
  const model = modelSel.value;
  const maxTokens = Number(maxTokensInput.value) || 2048;
  const systemPrompt = (getCurrentChat().systemPrompt || '').trim();

  if (provider === 'openai') {
    if (isImageModel(model)) {
      const promptText = extractPromptText(userMessage);
      return {
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
        url: 'https://api.openai.com/v1/responses',
        body,
        extract: extractResponsesText,
      };
    }
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...history, userMessage]
      : [...history, userMessage];
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      body: { model, messages },
      extract: (r) => r.body.choices[0].message.content,
    };
  }
  const messages = [...history, userMessage];
  const body = { model, max_tokens: maxTokens, messages };
  if (systemPrompt) body.system = systemPrompt;
  return {
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
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: req.url, method: 'POST', body: req.body }),
    });
    const data = await r.json();
    if (!r.ok) {
      setStatus('HTTP ' + r.status + ': ' + (data.error || ''), 'error');
      appendInline('error', JSON.stringify(data, null, 2));
      return;
    }
    if (data.status !== 'done' || !data.response) {
      setStatus('status=' + data.status + ' ' + (data.message || data.error || ''), 'error');
      return;
    }
    let text;
    try { text = req.extract(data.response); }
    catch (e) {
      setStatus('parse error: ' + e.message, 'error');
      appendInline('error', JSON.stringify(data.response, null, 2));
      return;
    }
    setHistory([...newHistory, { role: 'assistant', content: text }]);
    renderHistory();
    setStatus('ok · ' + (Date.now() - t0) + ' ms');
  } catch (e) {
    setStatus('fallo: ' + e.message, 'error');
  } finally {
    if (typing.isConnected) typing.remove();
    sendBtn.disabled = false;
  }
}
