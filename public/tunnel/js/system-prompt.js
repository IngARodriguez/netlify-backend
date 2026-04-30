import { $ } from './dom.js';
import {
  Chats,
  getCurrentChat,
  persistCurrentChat,
  onChatsChanged,
} from './chats.js';

const tabBtn   = $('systemTab');
const panelEl  = $('systemPanel');
const inputEl  = $('systemPromptInput');
const metaEl   = $('systemPanelMeta');

let isOpen = false;
let suppressSave = false;
let lastLoadedChatId = null;

function setOpen(open) {
  isOpen = !!open;
  panelEl.hidden = !isOpen;
  tabBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  tabBtn.classList.toggle('is-open', isOpen);
  if (isOpen) inputEl.focus();
}

function toggle() {
  setOpen(!isOpen);
}

function refreshTabState() {
  const value = (inputEl.value || '').trim();
  tabBtn.classList.toggle('has-content', value.length > 0);
}

function refreshMeta() {
  const value = (inputEl.value || '').trim();
  if (!value) {
    metaEl.textContent = 'solo para esta conversación';
    metaEl.classList.remove('active');
  } else {
    metaEl.textContent = value.length + ' chars · activo';
    metaEl.classList.add('active');
  }
}

function loadFromChat() {
  const chat = getCurrentChat();
  lastLoadedChatId = chat.id;
  suppressSave = true;
  inputEl.value = chat.systemPrompt || '';
  suppressSave = false;
  refreshTabState();
  refreshMeta();
}

function saveToChat() {
  if (suppressSave) return;
  const chat = getCurrentChat();
  const value = inputEl.value.trim();
  const stored = (chat.systemPrompt || '').trim();
  if (value === stored) return;
  chat.systemPrompt = value;
  persistCurrentChat(chat);
  refreshTabState();
}

inputEl.addEventListener('input', () => {
  refreshTabState();
  refreshMeta();
});
inputEl.addEventListener('change', saveToChat);
inputEl.addEventListener('blur', saveToChat);

tabBtn.addEventListener('click', toggle);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen) {
    saveToChat();
    setOpen(false);
  }
});

onChatsChanged(() => {
  const id = Chats.currentId();
  if (id !== lastLoadedChatId) loadFromChat();
});

loadFromChat();
