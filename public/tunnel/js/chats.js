import { setStatus } from './status.js';

export const Chats = {
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

const CHATS_CHANGED_EVENT = 'outpost:chats-changed';
function emitChatsChanged() {
  document.dispatchEvent(new CustomEvent(CHATS_CHANGED_EVENT));
}
export function onChatsChanged(handler) {
  document.addEventListener(CHATS_CHANGED_EVENT, handler);
}

function newChatId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newChat({ activate = true } = {}) {
  const id = newChatId();
  const now = new Date().toISOString();
  const chat = { id, title: 'Nueva conversación', createdAt: now, updatedAt: now, messages: [] };
  Chats.save(chat);
  const idx = Chats.index();
  idx.unshift({ id, title: chat.title, updatedAt: now });
  Chats.saveIndex(idx);
  if (activate) Chats.setCurrentId(id);
  emitChatsChanged();
  return chat;
}

export function getCurrentChat() {
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

export function persistCurrentChat(chat) {
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
  emitChatsChanged();
}

export function deriveTitle(content) {
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

export const getHistory = () => getCurrentChat().messages;

export function setHistory(messages) {
  const chat = getCurrentChat();
  chat.messages = messages;
  if ((chat.title === 'Nueva conversación' || !chat.title) && messages.length) {
    const firstUser = messages.find((m) => m.role === 'user');
    if (firstUser) chat.title = deriveTitle(firstUser.content);
  }
  persistCurrentChat(chat);
}

export function migrateLegacyHistory() {
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
  if (migrated) emitChatsChanged();
  return migrated;
}
