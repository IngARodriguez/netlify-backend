import { $, modelSel, providerSel } from './dom.js';
import { maxTokensForModel, onModelsChanged } from './models.js';

const triggerEl = $('modelPickerBtn');
const labelEl   = $('modelPickerLabel');
const menuEl    = $('modelPickerMenu');

let isOpen = false;

function fmt(n) { return n.toLocaleString(); }

function providerLabel(provider) {
  return provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
}

function setOpen(open) {
  isOpen = !!open;
  menuEl.hidden = !isOpen;
  triggerEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  triggerEl.classList.toggle('is-open', isOpen);
}

function openMenu() {
  if (isOpen) return;
  refreshMenu();
  setOpen(true);
}

function closeMenu() {
  if (!isOpen) return;
  setOpen(false);
}

function pick(value) {
  if (!value) return;
  if (modelSel.value !== value) {
    modelSel.value = value;
    modelSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  refreshLabel();
  closeMenu();
}

function refreshLabel() {
  const value = modelSel.value || '—';
  labelEl.textContent = value;
}

function refreshMenu() {
  menuEl.innerHTML = '';
  const current = modelSel.value;
  const provider = providerSel.value;
  const opts = Array.from(modelSel.options).map((o) => o.value).filter(Boolean);
  if (!opts.length) {
    const empty = document.createElement('div');
    empty.className = 'model-picker-empty';
    empty.textContent = 'Sin modelos. Pulsa "Refrescar lista" en Settings.';
    menuEl.appendChild(empty);
    return;
  }
  for (const id of opts) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'model-picker-item' + (id === current ? ' is-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', id === current ? 'true' : 'false');
    item.dataset.value = id;

    const main = document.createElement('div');
    main.className = 'model-picker-item-main';
    const name = document.createElement('span');
    name.className = 'model-picker-item-name';
    name.textContent = id;
    const meta = document.createElement('span');
    meta.className = 'model-picker-item-meta';
    meta.textContent = fmt(maxTokensForModel(id)) + ' tokens · ' + providerLabel(provider);
    main.appendChild(name);
    main.appendChild(meta);

    const check = document.createElement('span');
    check.className = 'model-picker-check';
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    item.appendChild(main);
    item.appendChild(check);
    item.addEventListener('click', () => pick(id));
    menuEl.appendChild(item);
  }
}

export function refreshModelPicker() {
  refreshLabel();
  if (isOpen) refreshMenu();
}

triggerEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isOpen) closeMenu();
  else openMenu();
});

document.addEventListener('click', (e) => {
  if (!isOpen) return;
  if (e.target.closest('#modelPicker')) return;
  closeMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen) closeMenu();
});

modelSel.addEventListener('change', refreshLabel);
onModelsChanged(() => {
  refreshLabel();
  if (isOpen) refreshMenu();
});

refreshLabel();
