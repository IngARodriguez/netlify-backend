const $ = (id) => document.getElementById(id);
const tokenInput      = $('token');
const providerSel     = $('provider');
const modelSel        = $('model');
const refreshBtn      = $('refreshModels');
const maxTokensInput  = $('maxTokens');
const inputEl         = $('input');
const messagesEl      = $('messages');
const conversationEl  = $('conversation');
const statusEl        = $('status');
const sendBtn         = $('send');
const formEl          = $('form');
const drawerEl        = $('drawer');
const overlayEl       = $('overlay');
const attachBarEl     = $('attachBar');
const attachBtnEl     = $('attachBtn');
const fileInputEl     = $('fileInput');

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-4-7',
};
const MODELS_URL = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
};

const BRAND_ICONS = {
  anthropic: '<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true"><path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/></svg>',
  openai: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="5" r="2"/><circle cx="17.5" cy="8" r="2"/><circle cx="17.5" cy="16" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="6.5" cy="16" r="2"/><circle cx="6.5" cy="8" r="2"/></svg>',
};
const brandSVG = (provider) => BRAND_ICONS[provider] || BRAND_ICONS.openai;

/* ─── Max output tokens per model ─── */
const MAX_TOKENS_OVERRIDES = {
  'gpt-3.5-turbo': 4096,
  'gpt-4': 8192,
  'gpt-4-turbo': 4096,
  'gpt-4o': 16384,
  'gpt-4o-mini': 16384,
};

function maxTokensForModel(modelId) {
  if (!modelId) return 4096;
  if (MAX_TOKENS_OVERRIDES[modelId]) return MAX_TOKENS_OVERRIDES[modelId];
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt-5'))      return 64000;
  if (id.startsWith('gpt-4.1'))    return 32768;
  if (id.startsWith('gpt-4o'))     return 16384;
  if (id.startsWith('gpt-4'))      return 8192;
  if (id.startsWith('gpt-3.5'))    return 4096;
  if (/^o[134](-|$)/.test(id))     return 100000;
  if (id.startsWith('claude-opus'))   return 32000;
  if (id.startsWith('claude-sonnet')) return 64000;
  if (id.startsWith('claude-haiku'))  return 8192;
  if (id.startsWith('claude-'))       return 8192;
  return 4096;
}

const MIN_OUTPUT_TOKENS = 256;
const MAX_TOKENS_STORAGE_KEY = (model) => 'tunnel_max_tokens_' + model;
const maxTokensValueEl = $('maxTokensValue');
const maxTokensMaxEl   = $('maxTokensMax');

function paintRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value) || 0;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--range-pct', pct.toFixed(2) + '%');
}

function updateMaxTokensSlider() {
  const model = modelSel.value;
  const max = maxTokensForModel(model);
  const min = Math.min(MIN_OUTPUT_TOKENS, max);
  const step = max <= 8192 ? 128 : (max <= 32000 ? 256 : 1024);
  const stored = Number(localStorage.getItem(MAX_TOKENS_STORAGE_KEY(model)));
  const fallback = Math.min(2048, max);
  let val = stored || Number(maxTokensInput.value) || fallback;
  val = Math.max(min, Math.min(val, max));
  val = Math.round(val / step) * step;
  if (val > max) val = max;
  if (val < min) val = min;

  maxTokensInput.min = min;
  maxTokensInput.max = max;
  maxTokensInput.step = step;
  maxTokensInput.value = val;
  maxTokensValueEl.textContent = val.toLocaleString();
  maxTokensMaxEl.textContent = max.toLocaleString();
  paintRangeFill(maxTokensInput);
}

/* ─── Attachments ─── */
const ATTACH_LIMIT_BYTES = 5 * 1024 * 1024;
const ATTACH_LIMIT_COUNT = 3;
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXTS = ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.tsx', '.jsx',
  '.py', '.css', '.html', '.xml', '.yml', '.yaml', '.sh', '.log', '.toml',
  '.go', '.rb', '.rs', '.java', '.c', '.cpp', '.h', '.sql'];
const ATTACH_ICONS = {
  pdf:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>',
};
const pendingAttachments = [];

function classifyFile(file) {
  if (IMAGE_MIME.has(file.type)) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  const lc = (file.name || '').toLowerCase();
  if (file.type.startsWith('text/') || TEXT_EXTS.some((e) => lc.endsWith(e))) return 'text';
  return null;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsText(file);
  });
}

async function tryAddFile(file) {
  if (!file) return;
  if (pendingAttachments.length >= ATTACH_LIMIT_COUNT) {
    setStatus('máx ' + ATTACH_LIMIT_COUNT + ' archivos por mensaje', 'error');
    return;
  }
  const kind = classifyFile(file);
  if (!kind) {
    setStatus('tipo no soportado: ' + (file.name || file.type), 'error');
    return;
  }
  if (kind === 'pdf' && providerSel.value === 'openai') {
    setStatus('OpenAI no soporta PDFs aquí — cambia a Anthropic', 'error');
    return;
  }
  if (file.size > ATTACH_LIMIT_BYTES) {
    setStatus(file.name + ': supera ' + formatSize(ATTACH_LIMIT_BYTES), 'error');
    return;
  }
  try {
    const att = {
      id: Math.random().toString(36).slice(2, 9),
      name: file.name || ('archivo.' + (kind === 'pdf' ? 'pdf' : kind)),
      mime: file.type || (kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'text/plain'),
      size: file.size,
      kind,
    };
    if (kind === 'image') {
      att.data = await readAsBase64(file);
      att.dataUri = 'data:' + att.mime + ';base64,' + att.data;
    } else if (kind === 'pdf') {
      att.data = await readAsBase64(file);
    } else {
      att.text = await readAsText(file);
    }
    pendingAttachments.push(att);
    renderAttachBar();
    setStatus('agregado: ' + att.name);
  } catch (e) {
    setStatus('error leyendo archivo: ' + e.message, 'error');
  }
}

function removeAttachment(id) {
  const i = pendingAttachments.findIndex((a) => a.id === id);
  if (i >= 0) {
    pendingAttachments.splice(i, 1);
    renderAttachBar();
  }
}

function renderAttachBar() {
  attachBarEl.innerHTML = '';
  if (!pendingAttachments.length) {
    attachBarEl.hidden = true;
    return;
  }
  attachBarEl.hidden = false;
  for (const a of pendingAttachments) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';

    const thumb = document.createElement('div');
    thumb.className = 'attach-chip-thumb';
    if (a.kind === 'image') {
      const img = document.createElement('img');
      img.src = a.dataUri;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = ATTACH_ICONS[a.kind] || ATTACH_ICONS.text;
    }
    chip.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'attach-chip-info';
    const name = document.createElement('span');
    name.className = 'attach-chip-name';
    name.textContent = a.name;
    info.appendChild(name);
    const size = document.createElement('span');
    size.className = 'attach-chip-size';
    size.textContent = formatSize(a.size);
    info.appendChild(size);
    chip.appendChild(info);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attach-remove';
    remove.setAttribute('aria-label', 'Quitar adjunto');
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    remove.addEventListener('click', () => removeAttachment(a.id));
    chip.appendChild(remove);

    attachBarEl.appendChild(chip);
  }
}

function clearAttachments() {
  pendingAttachments.length = 0;
  renderAttachBar();
}

function buildContentParts(prompt, attachments, provider) {
  if (!attachments.length) return prompt;
  const parts = [];
  if (provider === 'openai') {
    if (prompt) parts.push({ type: 'text', text: prompt });
    for (const a of attachments) {
      if (a.kind === 'image') {
        parts.push({ type: 'image_url', image_url: { url: a.dataUri || ('data:' + a.mime + ';base64,' + a.data) } });
      } else if (a.kind === 'text') {
        parts.push({ type: 'text', text: '```' + a.name + '\n' + a.text + '\n```' });
      }
    }
    return parts;
  }
  // Anthropic: media first, then text
  for (const a of attachments) {
    if (a.kind === 'image') {
      parts.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } });
    } else if (a.kind === 'pdf') {
      parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    } else if (a.kind === 'text') {
      parts.push({ type: 'text', text: '```' + a.name + '\n' + a.text + '\n```' });
    }
  }
  if (prompt) parts.push({ type: 'text', text: prompt });
  return parts;
}

/* ─── Chats store ─── */
const Chats = {
  indexKey: 'outpost_chat_index',
  currentKey: 'outpost_current_chat',
  key: (id) => 'outpost_chat_' + id,
  index: () => JSON.parse(localStorage.getItem(Chats.indexKey) || '[]'),
  saveIndex: (idx) => localStorage.setItem(Chats.indexKey, JSON.stringify(idx)),
  get: (id) => {
    const raw = localStorage.getItem(Chats.key(id));
    return raw ? JSON.parse(raw) : null;
  },
  save: (chat) => localStorage.setItem(Chats.key(chat.id), JSON.stringify(chat)),
  remove: (id) => {
    localStorage.removeItem(Chats.key(id));
    Chats.saveIndex(Chats.index().filter((c) => c.id !== id));
  },
  currentId: () => localStorage.getItem(Chats.currentKey),
  setCurrentId: (id) => {
    if (id) localStorage.setItem(Chats.currentKey, id);
    else localStorage.removeItem(Chats.currentKey);
  },
};

function newChatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function newChat({ activate = true } = {}) {
  const id = newChatId();
  const now = new Date().toISOString();
  const chat = { id, title: 'Nueva conversación', createdAt: now, updatedAt: now, messages: [] };
  Chats.save(chat);
  const idx = Chats.index();
  idx.unshift({ id, title: chat.title, updatedAt: now });
  Chats.saveIndex(idx);
  if (activate) Chats.setCurrentId(id);
  return chat;
}

function getCurrentChat() {
  const id = Chats.currentId();
  if (id) {
    const c = Chats.get(id);
    if (c) return c;
  }
  const idx = Chats.index();
  if (idx.length) {
    const c = Chats.get(idx[0].id);
    if (c) { Chats.setCurrentId(c.id); return c; }
  }
  return newChat();
}

function persistCurrentChat(chat) {
  chat.updatedAt = new Date().toISOString();
  try {
    Chats.save(chat);
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message))) {
      setStatus('localStorage lleno — borra chats viejos para guardar', 'error');
      return;
    }
    throw e;
  }
  const idx = Chats.index();
  const meta = idx.find((c) => c.id === chat.id);
  if (meta) {
    meta.title = chat.title;
    meta.updatedAt = chat.updatedAt;
  } else {
    idx.unshift({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt });
  }
  idx.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  Chats.saveIndex(idx);
  renderChatList();
}

function deriveTitle(content) {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const firstText = content.find((p) => p.type === 'text' && p.text);
    if (firstText) text = firstText.text;
    else {
      const hasImage = content.some((p) => p.type === 'image' || p.type === 'image_url');
      const hasDoc   = content.some((p) => p.type === 'document');
      text = hasImage ? 'Imagen adjunta' : hasDoc ? 'PDF adjunto' : 'Adjuntos';
    }
  }
  const trimmed = String(text).trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Nueva conversación';
  return trimmed.length > 42 ? trimmed.slice(0, 42) + '…' : trimmed;
}

const getHistory = () => getCurrentChat().messages;
const setHistory = (messages) => {
  const chat = getCurrentChat();
  chat.messages = messages;
  if ((chat.title === 'Nueva conversación' || !chat.title) && messages.length) {
    const firstUser = messages.find((m) => m.role === 'user');
    if (firstUser) chat.title = deriveTitle(firstUser.content);
  }
  persistCurrentChat(chat);
};

function migrateLegacyHistory() {
  let migrated = false;
  for (const provider of ['openai', 'anthropic']) {
    const old = localStorage.getItem('tunnel_hist_' + provider);
    if (!old) continue;
    try {
      const arr = JSON.parse(old);
      if (Array.isArray(arr) && arr.length) {
        const id = newChatId();
        const now = new Date().toISOString();
        const firstUser = arr.find((m) => m.role === 'user');
        const title = firstUser ? deriveTitle(firstUser.content) : 'Conversación ' + provider;
        const chat = { id, title, createdAt: now, updatedAt: now, messages: arr };
        Chats.save(chat);
        const idx = Chats.index();
        idx.unshift({ id, title, updatedAt: now });
        Chats.saveIndex(idx);
        migrated = true;
      }
    } catch {}
    localStorage.removeItem('tunnel_hist_' + provider);
  }
  return migrated;
}

/* ─── Markdown ─── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderMarkdown(text) {
  if (!text) return '';
  const codeBlocks = [];
  const inlineCodes = [];

  let s = String(text).replace(/```([a-zA-Z0-9_+\-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code });
    return ' CB' + (codeBlocks.length - 1) + ' ';
  });

  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return ' IC' + (inlineCodes.length - 1) + ' ';
  });

  s = escapeHtml(s);

  s = s.replace(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm, (_, h, content) => {
    const lvl = h.length;
    return '<h' + lvl + '>' + content + '</h' + lvl + '>';
  });

  s = s.replace(/^---+$|^\*\*\*+$/gm, '<hr>');

  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');

  s = s.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (m, txt, url) => {
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) return m;
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
  });

  const lines = s.split('\n');
  const out = [];
  let listType = null;
  const closeList = () => {
    if (listType) out.push('</' + listType + '>');
    listType = null;
  };
  for (const line of lines) {
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push('<li>' + ul[1] + '</li>');
    } else if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push('<li>' + ol[1] + '</li>');
    } else {
      closeList();
      out.push(line);
    }
  }
  closeList();
  s = out.join('\n');

  s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  s = s.split(/\n{2,}/).map((block) => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr)/i.test(block)) return block;
    if (/^ CB\d+ $/.test(block)) return block;
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).filter(Boolean).join('\n');

  s = s.replace(/ IC(\d+) /g, (_, idx) =>
    '<code class="md-inline">' + escapeHtml(inlineCodes[Number(idx)]) + '</code>');

  s = s.replace(/ CB(\d+) /g, (_, idx) => {
    const { lang, code } = codeBlocks[Number(idx)];
    const langAttr = lang ? ' data-lang="' + escapeHtml(lang) + '"' : '';
    return '<pre class="md-code"' + langAttr + '><code>' + escapeHtml(code) + '</code></pre>';
  });

  return s;
}

/* ─── Render ─── */
function renderHistory() {
  const history = getHistory();
  messagesEl.innerHTML = '';
  if (!history.length) {
    messagesEl.appendChild(emptyStateNode());
    return;
  }
  for (const m of history) {
    messagesEl.appendChild(messageNode(m.role, m.content));
  }
  requestAnimationFrame(() => {
    conversationEl.scrollTop = conversationEl.scrollHeight;
  });
}

function emptyStateNode() {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const provider = providerSel.value;
  wrap.innerHTML = `
    <div class="logo-circle">${brandSVG(provider)}</div>
    <h2>¿En qué te ayudo hoy?</h2>
    <p>Conversación con ${provider} · ${modelSel.value || 'modelo por defecto'}</p>
  `;
  return wrap;
}

function messageNode(role, content) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-' + role;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (role === 'user') {
    avatar.textContent = 'You';
  } else if (role === 'assistant') {
    avatar.innerHTML = brandSVG(providerSel.value);
  } else {
    avatar.textContent = '!';
  }
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (role === 'assistant') {
    body.classList.add('md');
    body.innerHTML = renderMarkdown(typeof content === 'string' ? content : '');
  } else if (role === 'user' && Array.isArray(content)) {
    body.classList.add('user-content');
    renderUserParts(body, content);
  } else {
    body.textContent = typeof content === 'string' ? content : JSON.stringify(content);
  }
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function renderUserParts(body, parts) {
  for (const p of parts) {
    if (p.type === 'text') {
      const div = document.createElement('div');
      div.className = 'user-text';
      div.textContent = p.text || '';
      body.appendChild(div);
    } else if (p.type === 'image_url' && p.image_url) {
      const img = document.createElement('img');
      img.className = 'user-image';
      img.loading = 'lazy';
      img.src = p.image_url.url;
      img.alt = '';
      img.addEventListener('click', () => window.open(p.image_url.url, '_blank'));
      body.appendChild(img);
    } else if (p.type === 'image' && p.source) {
      const img = document.createElement('img');
      img.className = 'user-image';
      img.loading = 'lazy';
      img.src = 'data:' + p.source.media_type + ';base64,' + p.source.data;
      img.alt = '';
      img.addEventListener('click', () => window.open(img.src, '_blank'));
      body.appendChild(img);
    } else if (p.type === 'document' && p.source) {
      const chip = document.createElement('div');
      chip.className = 'user-doc-chip';
      chip.innerHTML = ATTACH_ICONS.pdf + '<span class="user-doc-chip-name">PDF adjunto</span>';
      body.appendChild(chip);
    }
  }
}

function updateProviderMark() {
  $('providerMark').innerHTML = brandSVG(providerSel.value);
}

function typingNode() {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-assistant msg-typing';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.innerHTML = brandSVG(providerSel.value);
  const body = document.createElement('div');
  body.className = 'msg-body typing-dots';
  body.innerHTML = '<span></span><span></span><span></span>';
  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

/* ─── Models ─── */
const getCachedModels = (p) =>
  JSON.parse(localStorage.getItem('tunnel_models_' + p) || 'null');
const setCachedModels = (p, ids) =>
  localStorage.setItem('tunnel_models_' + p, JSON.stringify(ids));

function populateModelSelect() {
  const provider = providerSel.value;
  const cached = getCachedModels(provider);
  const ids = (cached && cached.length) ? [...cached] : [DEFAULT_MODELS[provider]];
  const current = localStorage.getItem('tunnel_model_' + provider) || DEFAULT_MODELS[provider];
  modelSel.innerHTML = '';
  if (!ids.includes(current)) ids.unshift(current);
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === current) opt.selected = true;
    modelSel.appendChild(opt);
  }
}

async function fetchModels() {
  const token = tokenInput.value.trim();
  if (!token) { setStatus('falta el token en settings', 'error'); openDrawer(); return; }
  const provider = providerSel.value;
  refreshBtn.disabled = true;
  setStatus('cargando modelos...');
  try {
    const r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: MODELS_URL[provider], method: 'GET' }),
    });
    const data = await r.json();
    if (!r.ok || !data.response) {
      setStatus('error: ' + (data.error || 'HTTP ' + r.status), 'error');
      return;
    }
    const items = data.response.body && data.response.body.data;
    if (!Array.isArray(items)) {
      setStatus('respuesta inesperada', 'error');
      return;
    }
    const ids = items.map((m) => m.id).filter(Boolean).sort();
    setCachedModels(provider, ids);
    populateModelSelect();
    setStatus(ids.length + ' modelos disponibles');
  } catch (e) {
    setStatus('fallo: ' + e.message, 'error');
  } finally {
    refreshBtn.disabled = false;
  }
}

/* ─── Status ─── */
function setStatus(text, kind = '') {
  statusEl.textContent = text || '';
  statusEl.style.color = kind === 'error' ? 'var(--danger)' : '';
}
function statusFooter() {
  const parts = [providerSel.value, modelSel.value, maxTokensInput.value + ' tokens'];
  setStatus(parts.filter(Boolean).join(' · '));
}

/* ─── Send ─── */
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

async function send(prompt) {
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

function appendInline(kind, text) {
  const node = messageNode(kind, text);
  messagesEl.appendChild(node);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

/* ─── Drawer ─── */
function openDrawer() {
  drawerEl.classList.add('open');
  overlayEl.classList.add('open');
  drawerEl.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  drawerEl.classList.remove('open');
  overlayEl.classList.remove('open');
  drawerEl.setAttribute('aria-hidden', 'true');
}

/* ─── Sidebar (chat list) ─── */
const sidebarEl        = $('sidebar');
const sidebarOverlayEl = $('sidebarOverlay');
const chatListEl       = $('chatList');

function openSidebar() {
  sidebarEl.classList.add('open');
  sidebarOverlayEl.classList.add('open');
}
function closeSidebar() {
  sidebarEl.classList.remove('open');
  sidebarOverlayEl.classList.remove('open');
}

function renderChatList() {
  const idx = Chats.index();
  const currentId = Chats.currentId();
  chatListEl.innerHTML = '';
  if (!idx.length) {
    const e = document.createElement('div');
    e.className = 'chat-empty';
    e.textContent = 'Aún no hay conversaciones';
    chatListEl.appendChild(e);
    return;
  }
  for (const c of idx) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === currentId ? ' active' : '');
    item.dataset.id = c.id;

    const title = document.createElement('span');
    title.className = 'chat-item-title';
    title.textContent = c.title || 'Sin título';

    const del = document.createElement('button');
    del.className = 'chat-delete';
    del.setAttribute('aria-label', 'Borrar conversación');
    del.title = 'Borrar';
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    item.appendChild(title);
    item.appendChild(del);

    item.addEventListener('click', () => switchToChat(c.id));
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(c.id);
    });
    chatListEl.appendChild(item);
  }
}

function switchToChat(id) {
  if (Chats.currentId() === id) {
    closeSidebar();
    return;
  }
  Chats.setCurrentId(id);
  clearAttachments();
  renderChatList();
  renderHistory();
  closeSidebar();
  inputEl.focus();
}

function deleteChat(id) {
  const meta = Chats.index().find((c) => c.id === id);
  const label = meta ? '"' + (meta.title || 'Sin título') + '"' : 'esta conversación';
  if (!confirm('¿Borrar ' + label + '?')) return;
  Chats.remove(id);
  if (Chats.currentId() === id) {
    const remaining = Chats.index();
    if (remaining.length) {
      Chats.setCurrentId(remaining[0].id);
    } else {
      newChat();
    }
  }
  renderChatList();
  renderHistory();
}

/* ─── Auto-resize textarea ─── */
function autoresize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 220) + 'px';
}

/* ─── Events ─── */
formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const prompt = inputEl.value.trim();
  if (!prompt && !pendingAttachments.length) return;
  inputEl.value = '';
  autoresize();
  send(prompt);
});

inputEl.addEventListener('input', autoresize);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

attachBtnEl.addEventListener('click', () => fileInputEl.click());
fileInputEl.addEventListener('change', async (e) => {
  for (const file of e.target.files) await tryAddFile(file);
  fileInputEl.value = '';
});

inputEl.addEventListener('paste', async (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        await tryAddFile(f);
      }
    }
  }
});

let dragDepth = 0;
formEl.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  formEl.classList.add('drag-over');
});
formEl.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) formEl.classList.remove('drag-over');
});
formEl.addEventListener('dragover', (e) => e.preventDefault());
formEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  formEl.classList.remove('drag-over');
  const files = (e.dataTransfer && e.dataTransfer.files) || [];
  for (const file of files) await tryAddFile(file);
});

$('clear').addEventListener('click', () => {
  const chat = getCurrentChat();
  if (!chat.messages.length) {
    closeDrawer();
    return;
  }
  if (confirm('¿Borrar mensajes de "' + chat.title + '"?')) {
    chat.messages = [];
    chat.title = 'Nueva conversación';
    persistCurrentChat(chat);
    renderHistory();
    statusFooter();
    closeDrawer();
  }
});

$('newChatBtn').addEventListener('click', () => {
  newChat();
  clearAttachments();
  renderChatList();
  renderHistory();
  closeSidebar();
  inputEl.focus();
});

$('menuToggle').addEventListener('click', () => {
  if (sidebarEl.classList.contains('open')) closeSidebar();
  else openSidebar();
});
sidebarOverlayEl.addEventListener('click', closeSidebar);

tokenInput.addEventListener('change', () => {
  localStorage.setItem('tunnel_token', tokenInput.value.trim());
});
modelSel.addEventListener('change', () => {
  localStorage.setItem('tunnel_model_' + providerSel.value, modelSel.value);
  updateMaxTokensSlider();
  statusFooter();
});
maxTokensInput.addEventListener('input', () => {
  maxTokensValueEl.textContent = Number(maxTokensInput.value).toLocaleString();
  paintRangeFill(maxTokensInput);
  localStorage.setItem(MAX_TOKENS_STORAGE_KEY(modelSel.value), maxTokensInput.value);
  statusFooter();
});
providerSel.addEventListener('change', () => {
  localStorage.setItem('tunnel_provider', providerSel.value);
  populateModelSelect();
  updateProviderMark();
  updateMaxTokensSlider();
  renderHistory();
  statusFooter();
});
refreshBtn.addEventListener('click', fetchModels);
$('settingsToggleSidebar').addEventListener('click', openDrawer);
$('settingsClose').addEventListener('click', closeDrawer);
overlayEl.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    closeSidebar();
  }
});

/* ─── Init ─── */
(function init() {
  tokenInput.value     = localStorage.getItem('tunnel_token') || '';
  providerSel.value    = localStorage.getItem('tunnel_provider') || 'openai';
  migrateLegacyHistory();
  populateModelSelect();
  updateProviderMark();
  updateMaxTokensSlider();
  renderChatList();
  renderHistory();
  statusFooter();
  autoresize();
  inputEl.focus();
})();
