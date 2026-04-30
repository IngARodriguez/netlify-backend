import {
  providerSel, modelSel, refreshBtn, tokenInput,
  maxTokensInput, maxTokensValueEl, maxTokensMaxEl, paintRangeFill,
} from './dom.js';
import { setStatus } from './status.js';
import { openDrawer } from './ui.js';

export const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-4-7',
};

export const MODELS_URL = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
};

export const FAST_MODEL = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

const MAX_TOKENS_OVERRIDES = {
  'gpt-3.5-turbo': 4096,
  'gpt-4': 8192,
  'gpt-4-turbo': 4096,
  'gpt-4o': 16384,
  'gpt-4o-mini': 16384,
};
const MIN_OUTPUT_TOKENS = 256;

export const MAX_TOKENS_STORAGE_KEY = (model) => 'tunnel_max_tokens_' + model;

// OpenAI models that only work in /v1/responses (not /v1/chat/completions)
export function requiresResponsesAPI(modelId) {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  return /-pro(\b|-)/.test(id) || /-deep-research(\b|-)/.test(id);
}

export function maxTokensForModel(modelId) {
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

export function updateMaxTokensSlider() {
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

const getCachedModels = (p) =>
  JSON.parse(localStorage.getItem('tunnel_models_' + p) || 'null');
const setCachedModels = (p, ids) =>
  localStorage.setItem('tunnel_models_' + p, JSON.stringify(ids));

const MODELS_CHANGED_EVENT = 'openchaw:models-changed';
function emitModelsChanged() {
  document.dispatchEvent(new CustomEvent(MODELS_CHANGED_EVENT));
}
export function onModelsChanged(handler) {
  document.addEventListener(MODELS_CHANGED_EVENT, handler);
}

export function populateModelSelect() {
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
  emitModelsChanged();
}

export async function fetchModels() {
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
