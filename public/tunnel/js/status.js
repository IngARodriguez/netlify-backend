import { statusEl, providerSel, modelSel, maxTokensInput } from './dom.js';

export function setStatus(text, kind = '') {
  statusEl.textContent = text || '';
  statusEl.style.color = kind === 'error' ? 'var(--danger)' : '';
}

export function statusFooter() {
  const parts = [providerSel.value, modelSel.value, maxTokensInput.value + ' tokens'];
  setStatus(parts.filter(Boolean).join(' · '));
}
