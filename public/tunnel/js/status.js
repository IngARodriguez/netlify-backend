import { $, statusEl, providerSel, modelSel, maxTokensInput } from './dom.js';

const KNOWN_CLASSES = ['status-idle', 'status-info', 'status-thinking', 'status-ok', 'status-error'];

function classifyStatus(text, kind) {
  if (kind === 'error') return 'error';
  if (!text) return 'idle';
  if (kind) return kind;
  const lc = text.toLowerCase();
  if (lc.startsWith('ok')) return 'ok';
  if (lc.startsWith('pensando') || lc.startsWith('cargando') || lc.startsWith('agregado') || lc.startsWith('limpiando')) return 'thinking';
  if (/error|fallo|falta|inválid|unauthor/.test(lc)) return 'error';
  return 'info';
}

export function setStatus(text, kind = '') {
  const footer = $('statusFooter');
  if (footer) {
    const cls = classifyStatus(text || '', kind);
    KNOWN_CLASSES.forEach((c) => footer.classList.remove(c));
    footer.classList.add('status-' + cls);
  }
  statusEl.textContent = text || '';
  statusEl.style.color = '';
}

export function statusFooter() {
  const parts = [providerSel.value, modelSel.value, maxTokensInput.value + ' tokens'];
  setStatus(parts.filter(Boolean).join(' · '));
}
