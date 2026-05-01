// Rendering puro: recibe datos de examples.js, devuelve y monta DOM.
// No hace fetch ni gestiona estado; sólo construye elementos.

import { ENDPOINTS, TABS } from './examples.js';
import { activateCopyButtons, fillPlaceholders } from '/shared/snippet.js';

export function renderEndpointsTable(container) {
  const t = document.createElement('table');
  t.className = 'endpoints';
  t.innerHTML = `
    <thead>
      <tr>
        <th>Método</th>
        <th>Path</th>
        <th>Provider</th>
        <th>Stream</th>
        <th>Notas</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  for (const e of ENDPOINTS) {
    const tr = document.createElement('tr');
    const method = e.method.toLowerCase();
    const cls =
      method === 'post' ? 'post'
      : method === 'delete' ? 'del'
      : method === 'get' ? 'get'
      : 'any';
    tr.innerHTML = `
      <td><span class="method ${cls}">${e.method}</span></td>
      <td><code>${e.path}</code></td>
      <td>${e.provider}</td>
      <td>${e.stream}</td>
      <td>${e.notes}</td>
    `;
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  container.replaceChildren(t);
}

export function renderTabs(tabsEl, examplesEl) {
  let activeId = TABS[0].id;

  function paintExamples() {
    const tab = TABS.find((x) => x.id === activeId);
    examplesEl.replaceChildren();
    for (const ex of tab.examples) {
      const block = document.createElement('div');
      block.className = 'example-block';
      // Construimos con innerHTML porque ex.body contiene <span> markup
      // que `fillPlaceholders` necesita encontrar para reemplazar BASE/TOKEN.
      block.innerHTML = `
        <h3>${escapeHtml(ex.title)}</h3>
        <pre class="snippet" data-copy><button type="button" class="copy-btn">copy</button>${ex.body}</pre>
      `;
      examplesEl.appendChild(block);
    }
    fillPlaceholders(examplesEl);
    activateCopyButtons(examplesEl);
  }

  function paintTabs() {
    tabsEl.replaceChildren();
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab' + (t.id === activeId ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => {
        if (activeId === t.id) return;
        activeId = t.id;
        paintTabs();
        paintExamples();
      });
      tabsEl.appendChild(btn);
    }
  }

  paintTabs();
  paintExamples();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
