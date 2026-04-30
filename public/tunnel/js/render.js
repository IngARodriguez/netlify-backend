import {
  $, providerSel, modelSel, messagesEl, conversationEl, escapeHtml,
} from './dom.js';
import { brandSVG, ATTACH_ICONS } from './icons.js';
import { renderMarkdown } from './markdown.js';
import { getHistory } from './chats.js';
import { pickFallbackGreeting, fetchDynamicGreeting } from './greeting.js';

let greetingAbort = null;

export function updateProviderMark() {
  $('providerMark').innerHTML = brandSVG(providerSel.value);
}

export function renderHistory() {
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

export function emptyStateNode() {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const provider = providerSel.value;
  const greeting = pickFallbackGreeting();
  const meta = `${provider} · ${modelSel.value || 'modelo por defecto'}`;
  wrap.innerHTML = `
    <div class="logo-circle">${brandSVG(provider)}</div>
    <h2 class="greeting-text">${escapeHtml(greeting)}</h2>
    <p class="empty-meta">
      <span class="online-dot" aria-hidden="true"></span><span class="meta-text"></span><span class="meta-caret" aria-hidden="true">▎</span>
    </p>
  `;
  const metaText = wrap.querySelector('.meta-text');
  typewriter(metaText, meta);

  if (greetingAbort) greetingAbort.abort();
  greetingAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  fetchDynamicGreeting(greetingAbort).then((fresh) => {
    if (!fresh) return;
    if (!wrap.isConnected) return;
    const h2 = wrap.querySelector('.greeting-text');
    if (h2) {
      h2.textContent = fresh;
      h2.classList.add('greeting-fresh');
    }
  });
  return wrap;
}

function typewriter(el, text, speed = 32) {
  el.textContent = '';
  let i = 0;
  const tick = () => {
    if (i > 0 && !el.isConnected) return;
    if (i < text.length) {
      el.textContent += text.charAt(i++);
      setTimeout(tick, speed);
    } else {
      const caret = el.parentElement && el.parentElement.querySelector('.meta-caret');
      if (caret) caret.classList.add('idle');
    }
  };
  setTimeout(tick, 50);
}

export function messageNode(role, content) {
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

export function typingNode() {
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

export function appendInline(kind, text) {
  const node = messageNode(kind, text);
  messagesEl.appendChild(node);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}
