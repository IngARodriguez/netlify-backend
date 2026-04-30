import { chatListEl, inputEl } from './dom.js';
import { Chats, newChat, onChatsChanged } from './chats.js';
import { renderHistory } from './render.js';
import { clearAttachments } from './attachments.js';
import { closeSidebar } from './ui.js';

export function renderChatList() {
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

export function switchToChat(id) {
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

export function deleteChat(id) {
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

onChatsChanged(renderChatList);
