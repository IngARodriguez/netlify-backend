import {
  $, tokenInput, providerSel, modelSel, maxTokensInput, maxTokensValueEl,
  inputEl, formEl, sidebarEl, sidebarOverlayEl, attachBtnEl, fileInputEl,
  refreshBtn, overlayEl, paintRangeFill,
} from './dom.js';
import { setStatus, statusFooter } from './status.js';
import {
  populateModelSelect, fetchModels, updateMaxTokensSlider, MAX_TOKENS_STORAGE_KEY,
  getCacheAgeMs, CACHE_TTL_MS,
} from './models.js';
import {
  migrateLegacyHistory, getCurrentChat, persistCurrentChat,
} from './chats.js';
import { renderHistory, updateProviderMark } from './render.js';
import { renderChatList } from './chat-list.js';
import {
  openDrawer, closeDrawer, openSidebar, closeSidebar, autoresize,
} from './ui.js';
import {
  tryAddFile, pendingAttachments, clearAttachments,
} from './attachments.js';
import { send } from './send.js';
import { newChat } from './chats.js';
import './model-picker.js';
import './system-prompt.js';

/* ─── Composer events ─── */
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

/* ─── Attachments events ─── */
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

/* ─── Drawer / sidebar events ─── */
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
  renderHistory();
  closeSidebar();
  inputEl.focus();
});

$('menuToggle').addEventListener('click', () => {
  if (sidebarEl.classList.contains('open')) closeSidebar();
  else openSidebar();
});
sidebarOverlayEl.addEventListener('click', closeSidebar);

/* ─── Settings events ─── */
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
  // Refresco automático en background: el cache local ya pintó la lista,
  // y cuando llegue la respuesta populateModelSelect se llama de nuevo.
  fetchModels({ silent: true });
});
refreshBtn.addEventListener('click', () => fetchModels());
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

  // Si el cache de modelos del provider activo es más viejo que CACHE_TTL_MS
  // (1h), refrescamos en background.  Si nunca hubo cache también refresca.
  if (getCacheAgeMs(providerSel.value) > CACHE_TTL_MS) {
    fetchModels({ silent: true });
  }
})();
