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
  // Lista cruda tal como la devuelve la cuenta de Skills Network.
  // Incluye modelos que NO son de chat (whisper, tts-*, text-embedding-*,
  // omni-moderation-*, *-realtime*, *-transcribe*, sora-*, etc.) — esos
  // modelos van a fallar si se seleccionan en /tunnel/ porque el chat
  // siempre llama a /v1/chat/completions, /v1/responses o
  // /v1/images/generations según `requiresResponsesAPI` / `isImageModel`.
  // Si quieres una lista curada, edita esta tabla.
  openai: [
    'text-embedding-ada-002',
    'whisper-1',
    'gpt-3.5-turbo',
    'tts-1',
    'gpt-3.5-turbo-16k',
    'gpt-4-0613',
    'gpt-4',
    'davinci-002',
    'babbage-002',
    'gpt-3.5-turbo-instruct',
    'gpt-3.5-turbo-instruct-0914',
    'dall-e-3',
    'dall-e-2',
    'gpt-3.5-turbo-1106',
    'tts-1-hd',
    'tts-1-1106',
    'tts-1-hd-1106',
    'text-embedding-3-small',
    'text-embedding-3-large',
    'gpt-3.5-turbo-0125',
    'gpt-4-turbo',
    'gpt-4-turbo-2024-04-09',
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-mini-2024-07-18',
    'gpt-4o-mini',
    'gpt-4o-2024-08-06',
    'gpt-4o-audio-preview',
    'gpt-4o-realtime-preview',
    'omni-moderation-latest',
    'omni-moderation-2024-09-26',
    'gpt-4o-realtime-preview-2024-12-17',
    'gpt-4o-audio-preview-2024-12-17',
    'gpt-4o-mini-realtime-preview-2024-12-17',
    'gpt-4o-mini-audio-preview-2024-12-17',
    'o1-2024-12-17',
    'o1',
    'gpt-4o-mini-realtime-preview',
    'gpt-4o-mini-audio-preview',
    'computer-use-preview',
    'o3-mini',
    'o3-mini-2025-01-31',
    'gpt-4o-2024-11-20',
    'computer-use-preview-2025-03-11',
    'gpt-4o-mini-search-preview-2025-03-11',
    'gpt-4o-mini-search-preview',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
    'o1-pro-2025-03-19',
    'o1-pro',
    'gpt-4o-mini-tts',
    'o3-2025-04-16',
    'o4-mini-2025-04-16',
    'o3',
    'o4-mini',
    'gpt-4.1-2025-04-14',
    'gpt-4.1',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-mini',
    'gpt-4.1-nano-2025-04-14',
    'gpt-4.1-nano',
    'gpt-image-1',
    'o3-pro',
    'gpt-4o-realtime-preview-2025-06-03',
    'gpt-4o-audio-preview-2025-06-03',
    'o3-pro-2025-06-10',
    'o4-mini-deep-research',
    'o3-deep-research',
    'gpt-4o-transcribe-diarize',
    'o3-deep-research-2025-06-26',
    'o4-mini-deep-research-2025-06-26',
    'gpt-5-chat-latest',
    'gpt-5-2025-08-07',
    'gpt-5',
    'gpt-5-mini-2025-08-07',
    'gpt-5-mini',
    'gpt-5-nano-2025-08-07',
    'gpt-5-nano',
    'gpt-audio-2025-08-28',
    'gpt-realtime',
    'gpt-realtime-2025-08-28',
    'gpt-audio',
    'gpt-5-codex',
    'gpt-image-1-mini',
    'gpt-5-pro-2025-10-06',
    'gpt-5-pro',
    'gpt-audio-mini',
    'gpt-audio-mini-2025-10-06',
    'gpt-5-search-api',
    'gpt-realtime-mini',
    'gpt-realtime-mini-2025-10-06',
    'sora-2',
    'sora-2-pro',
    'gpt-5-search-api-2025-10-14',
    'gpt-5.1-chat-latest',
    'gpt-5.1-2025-11-13',
    'gpt-5.1',
    'gpt-5.1-codex',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex-max',
    'gpt-image-1.5',
    'gpt-5.2-2025-12-11',
    'gpt-5.2',
    'gpt-5.2-pro-2025-12-11',
    'gpt-5.2-pro',
    'gpt-5.2-chat-latest',
    'gpt-4o-mini-transcribe-2025-12-15',
    'gpt-4o-mini-transcribe-2025-03-20',
    'gpt-4o-mini-tts-2025-03-20',
    'gpt-4o-mini-tts-2025-12-15',
    'gpt-realtime-mini-2025-12-15',
    'gpt-audio-mini-2025-12-15',
    'chatgpt-image-latest',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
    'gpt-realtime-1.5',
    'gpt-audio-1.5',
    'gpt-4o-search-preview',
    'gpt-4o-search-preview-2025-03-11',
    'gpt-5.3-chat-latest',
    'gpt-5.4-2026-03-05',
    'gpt-5.4-pro',
    'gpt-5.4-pro-2026-03-05',
    'gpt-5.4',
    'gpt-5.4-nano-2026-03-17',
    'gpt-5.4-nano',
    'gpt-5.4-mini-2026-03-17',
    'gpt-5.4-mini',
    'gpt-image-2',
    'gpt-image-2-2026-04-21',
    'gpt-5.5',
    'gpt-5.5-2026-04-23',
    'gpt-5.5-pro',
    'gpt-5.5-pro-2026-04-23',
    'davinci:ft-skills-network-2023-08-14-20-44-51',
    'curie:ft-skills-network-2023-08-14-18-58-26',
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
