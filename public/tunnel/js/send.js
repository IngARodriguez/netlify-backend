import {
  tokenInput, providerSel, modelSel, maxTokensInput,
  messagesEl, conversationEl, sendBtn,
} from './dom.js';
import { setStatus } from './status.js';
import { openDrawer } from './ui.js';
import { getHistory, setHistory } from './chats.js';
import { renderHistory, typingNode, appendInline } from './render.js';
import {
  pendingAttachments, clearAttachments, buildContentParts,
} from './attachments.js';

function buildRequest(history, userMessage) {
  const provider = providerSel.value;
  const model = modelSel.value;
  const maxTokens = Number(maxTokensInput.value) || 2048;
  const messages = [...history, userMessage];
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      body: { model, messages },
      extract: (r) => r.body.choices[0].message.content,
    };
  }
  return {
    url: 'https://api.anthropic.com/v1/messages',
    body: { model, max_tokens: maxTokens, messages },
    extract: (r) => r.body.content[0].text,
  };
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
