export const $ = (id) => document.getElementById(id);

export const tokenInput        = $('token');
export const providerSel       = $('provider');
export const modelSel          = $('model');
export const maxTokensInput    = $('maxTokens');
export const maxTokensValueEl  = $('maxTokensValue');
export const maxTokensMaxEl    = $('maxTokensMax');
export const inputEl           = $('input');
export const messagesEl        = $('messages');
export const conversationEl    = $('conversation');
export const statusEl          = $('status');
export const sendBtn           = $('send');
export const formEl            = $('form');
export const drawerEl          = $('drawer');
export const overlayEl         = $('overlay');
export const attachBarEl       = $('attachBar');
export const attachBtnEl       = $('attachBtn');
export const fileInputEl       = $('fileInput');
export const sidebarEl         = $('sidebar');
export const sidebarOverlayEl  = $('sidebarOverlay');
export const chatListEl        = $('chatList');

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function paintRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value) || 0;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--range-pct', pct.toFixed(2) + '%');
}
