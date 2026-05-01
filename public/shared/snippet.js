// Helpers para snippets de código copiables y placeholders dinámicos.
//
// Convención HTML:
//   <pre class="snippet" data-copy>
//     <button type="button" class="copy-btn">copy</button>
//     curl <span class="g-base">BASE</span>/v1/messages -H "x-api-key: <span class="g-token">TOKEN</span>"
//   </pre>
//
// `fillPlaceholders` reemplaza el texto interno de `.g-base` por
// `location.origin` y de `.g-token` por el token guardado en localStorage
// (default "admin").
//
// `activateCopyButtons` añade el handler del botón.  Ambas son idempotentes:
// llamarlas dos veces no duplica handlers ni texto.

export function fillPlaceholders(root = document) {
  const base = location.origin;
  for (const el of root.querySelectorAll('.g-base')) {
    el.textContent = base;
  }
  const token = localStorage.getItem('JOBS_CLIENT_TOKEN') || 'admin';
  for (const el of root.querySelectorAll('.g-token')) {
    el.textContent = token;
  }
}

export function activateCopyButtons(root = document) {
  const snippets = root.querySelectorAll('pre.snippet[data-copy]');
  for (const pre of snippets) {
    const btn = pre.querySelector('.copy-btn');
    if (!btn || btn.dataset.bound) continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const clone = pre.cloneNode(true);
      clone.querySelector('.copy-btn')?.remove();
      const text = clone.textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        flash(btn, 'copied', 'copy', 1400);
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1400);
      } catch {
        flash(btn, 'fail', 'copy', 1400);
      }
    });
  }
}

function flash(btn, on, off, ms) {
  btn.textContent = on;
  setTimeout(() => { btn.textContent = off; }, ms);
}
