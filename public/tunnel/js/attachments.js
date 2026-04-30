import { providerSel, attachBarEl } from './dom.js';
import { setStatus } from './status.js';
import { ATTACH_ICONS } from './icons.js';

export const ATTACH_LIMIT_BYTES = 5 * 1024 * 1024;
export const ATTACH_LIMIT_COUNT = 3;

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_EXTS = ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.tsx', '.jsx',
  '.py', '.css', '.html', '.xml', '.yml', '.yaml', '.sh', '.log', '.toml',
  '.go', '.rb', '.rs', '.java', '.c', '.cpp', '.h', '.sql'];

export const pendingAttachments = [];

function classifyFile(file) {
  if (IMAGE_MIME.has(file.type)) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  const lc = (file.name || '').toLowerCase();
  if (file.type.startsWith('text/') || TEXT_EXTS.some((e) => lc.endsWith(e))) return 'text';
  return null;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsText(file);
  });
}

export async function tryAddFile(file) {
  if (!file) return;
  if (pendingAttachments.length >= ATTACH_LIMIT_COUNT) {
    setStatus('máx ' + ATTACH_LIMIT_COUNT + ' archivos por mensaje', 'error');
    return;
  }
  const kind = classifyFile(file);
  if (!kind) {
    setStatus('tipo no soportado: ' + (file.name || file.type), 'error');
    return;
  }
  if (kind === 'pdf' && providerSel.value === 'openai') {
    setStatus('OpenAI no soporta PDFs aquí — cambia a Anthropic', 'error');
    return;
  }
  if (file.size > ATTACH_LIMIT_BYTES) {
    setStatus(file.name + ': supera ' + formatSize(ATTACH_LIMIT_BYTES), 'error');
    return;
  }
  try {
    const att = {
      id: Math.random().toString(36).slice(2, 9),
      name: file.name || ('archivo.' + (kind === 'pdf' ? 'pdf' : kind)),
      mime: file.type || (kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'text/plain'),
      size: file.size,
      kind,
    };
    if (kind === 'image') {
      att.data = await readAsBase64(file);
      att.dataUri = 'data:' + att.mime + ';base64,' + att.data;
    } else if (kind === 'pdf') {
      att.data = await readAsBase64(file);
    } else {
      att.text = await readAsText(file);
    }
    pendingAttachments.push(att);
    renderAttachBar();
    setStatus('agregado: ' + att.name);
  } catch (e) {
    setStatus('error leyendo archivo: ' + e.message, 'error');
  }
}

export function removeAttachment(id) {
  const i = pendingAttachments.findIndex((a) => a.id === id);
  if (i >= 0) {
    pendingAttachments.splice(i, 1);
    renderAttachBar();
  }
}

export function renderAttachBar() {
  attachBarEl.innerHTML = '';
  if (!pendingAttachments.length) {
    attachBarEl.hidden = true;
    return;
  }
  attachBarEl.hidden = false;
  for (const a of pendingAttachments) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';

    const thumb = document.createElement('div');
    thumb.className = 'attach-chip-thumb';
    if (a.kind === 'image') {
      const img = document.createElement('img');
      img.src = a.dataUri;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = ATTACH_ICONS[a.kind] || ATTACH_ICONS.text;
    }
    chip.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'attach-chip-info';
    const name = document.createElement('span');
    name.className = 'attach-chip-name';
    name.textContent = a.name;
    info.appendChild(name);
    const size = document.createElement('span');
    size.className = 'attach-chip-size';
    size.textContent = formatSize(a.size);
    info.appendChild(size);
    chip.appendChild(info);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attach-remove';
    remove.setAttribute('aria-label', 'Quitar adjunto');
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    remove.addEventListener('click', () => removeAttachment(a.id));
    chip.appendChild(remove);

    attachBarEl.appendChild(chip);
  }
}

export function clearAttachments() {
  pendingAttachments.length = 0;
  renderAttachBar();
}

export function buildContentParts(prompt, attachments, provider) {
  if (!attachments.length) return prompt;
  const parts = [];
  if (provider === 'openai') {
    if (prompt) parts.push({ type: 'text', text: prompt });
    for (const a of attachments) {
      if (a.kind === 'image') {
        parts.push({ type: 'image_url', image_url: { url: a.dataUri || ('data:' + a.mime + ';base64,' + a.data) } });
      } else if (a.kind === 'text') {
        parts.push({ type: 'text', text: '```' + a.name + '\n' + a.text + '\n```' });
      }
    }
    return parts;
  }
  for (const a of attachments) {
    if (a.kind === 'image') {
      parts.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } });
    } else if (a.kind === 'pdf') {
      parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    } else if (a.kind === 'text') {
      parts.push({ type: 'text', text: '```' + a.name + '\n' + a.text + '\n```' });
    }
  }
  if (prompt) parts.push({ type: 'text', text: prompt });
  return parts;
}
