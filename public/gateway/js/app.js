// Composición e inicialización de la app /gateway/.
// Carga datos, monta render, conecta eventos.

import { renderEndpointsTable, renderTabs } from './render.js';
import { runHealthChecks } from './status.js';
import { activateCopyButtons, fillPlaceholders } from '/shared/snippet.js';

const $ = (id) => document.getElementById(id);

// Render estático
fillPlaceholders(document.body);
activateCopyButtons(document.body);
renderEndpointsTable($('endpointsTable'));
renderTabs($('tabs'), $('examples'));

// ─── Status panel ─────────────────────────────────────────────────────
const STATUS_AUTO_REFRESH_MS = 60_000;
let statusTimer = null;

async function refreshStatus() {
  const meta = $('statusMeta');
  if (meta) meta.textContent = 'Verificando...';
  const t = await runHealthChecks($('statusItems'), 'full');
  if (meta) meta.textContent = `Última verificación: ${t.toLocaleTimeString()}`;
}

$('statusRefresh').addEventListener('click', () => refreshStatus());
refreshStatus();
statusTimer = setInterval(refreshStatus, STATUS_AUTO_REFRESH_MS);

// Pausamos el auto-refresh cuando la pestaña no está visible (ahorra
// requests y evita acumular reintentos cuando el usuario vuelve).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(statusTimer);
    statusTimer = null;
  } else if (!statusTimer) {
    refreshStatus();
    statusTimer = setInterval(refreshStatus, STATUS_AUTO_REFRESH_MS);
  }
});

// ─── Mantenimiento ────────────────────────────────────────────────────
$('cleanBtn').addEventListener('click', async () => {
  const btn = $('cleanBtn');
  const out = $('cleanStatus');
  const setOut = (text) => { out.textContent = text; };

  let token = localStorage.getItem('JOBS_CLIENT_TOKEN') || '';
  if (!token) {
    token = (prompt('JOBS_CLIENT_TOKEN:') || '').trim();
    if (!token) { setOut('Cancelado.'); return; }
    localStorage.setItem('JOBS_CLIENT_TOKEN', token);
    fillPlaceholders(document.body); // re-fill snippets con el nuevo token
  }
  if (!confirm('¿Borrar todos los blobs de archive y active? Esta acción no se puede deshacer.')) return;

  btn.disabled = true;
  setOut('Limpiando...');
  try {
    const headers = { 'Authorization': 'Bearer ' + token };
    const [r1, r2] = await Promise.all([
      fetch('/api/jobs/archive', { method: 'DELETE', headers }),
      fetch('/api/jobs/active',  { method: 'DELETE', headers }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    if (!r1.ok || !r2.ok) {
      const err = ((d1.error || '') + ' ' + (d2.error || '')).trim();
      setOut('Error: ' + err);
      if (r1.status === 401 || r2.status === 401) {
        localStorage.removeItem('JOBS_CLIENT_TOKEN');
        setOut('Token inválido. Vuelve a intentarlo.');
      }
      return;
    }
    setOut(`OK · archive=${d1.deleted} · active=${d2.deleted}`);
  } catch (e) {
    setOut('Fallo: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});
