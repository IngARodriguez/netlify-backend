import {
  providerSel, modelSel,
  maxTokensInput, maxTokensValueEl, maxTokensMaxEl, paintRangeFill,
} from './dom.js';

// ─── Catálogo hard-coded ──────────────────────────────────────────────
// Lista curada de modelos disponibles por provider.  Sin fetch al
// provider: el chat carga instantáneamente y no consume quota para
// listar modelos.  Si aparece un modelo nuevo, edita esta tabla y
// recarga — la UI se actualiza al instante.

export const MODELS = {
  anthropic: [
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  openai: [
    'gpt-5-pro',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'chatgpt-4o-latest',
    'o3',
    'o4-mini',
    'gpt-image-1',
    'dall-e-3',
  ],
};

export const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-opus-4-7',
};

// Modelo "rápido" usado por greeting.js para saludos dinámicos.
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

// OpenAI image-generation models (use /v1/images/generations)
export function isImageModel(modelId) {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  return /^dall-e/.test(id) || /^gpt-image/.test(id) || /^chatgpt-image/.test(id);
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

const MODELS_CHANGED_EVENT = 'openchaw:models-changed';
function emitModelsChanged() {
  document.dispatchEvent(new CustomEvent(MODELS_CHANGED_EVENT));
}
export function onModelsChanged(handler) {
  document.addEventListener(MODELS_CHANGED_EVENT, handler);
}

export function populateModelSelect() {
  const provider = providerSel.value;
  const ids = [...(MODELS[provider] || [])];
  const current = localStorage.getItem('tunnel_model_' + provider) || DEFAULT_MODELS[provider];
  modelSel.innerHTML = '';
  // Si el usuario tenía guardado un modelo que ya no existe en la lista
  // (legacy), lo añadimos al inicio para no romper su selección — el
  // provider lo aceptará si todavía lo soporta.
  if (current && !ids.includes(current)) ids.unshift(current);
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === current) opt.selected = true;
    modelSel.appendChild(opt);
  }
  emitModelsChanged();
}
