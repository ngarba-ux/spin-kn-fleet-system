import { html, render } from './lib.js';
import { store, update, useStore, loadState, loadQueue, flush } from './store.js';
import { Toasts, DialogHost, Icon } from './ui.js';
import { setLang, getLang, t } from './i18n.js';
import { Landing, ForcedPasswordChange } from './views/landing.js';
import { StaffPortal } from './views/staff.js';
import { StatusPage } from './views/status.js';
import { DriverApp } from './views/driver.js';
import { OfficeApp } from './views/office.js';

// Routes: #s=<staff token>, #r=<status token>, #/<page>/<id>
function parseHash() {
  const h = location.hash || '';
  let m = h.match(/^#s=([\w-]+)/);
  if (m) return { kind: 'staff', token: m[1] };
  m = h.match(/^#r=([\w-]+)/);
  if (m) return { kind: 'status', token: m[1] };
  const parts = h.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  return { kind: 'app', page: parts[0] || '', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function App() {
  const s = useStore();
  const r = s.route;
  let view;
  if (r.kind === 'staff') view = html`<${StaffPortal} token=${r.token} />`;
  else if (r.kind === 'status') view = html`<${StatusPage} token=${r.token} />`;
  else if (!s.booted) view = html`<div class="splash"><img src="/logo.png" alt="" /><span class="spinner dark" /></div>`;
  else if (!s.data) view = html`<${Landing} />`;
  else if (s.data.me.mustChangePassword) view = html`<${ForcedPasswordChange} />`;
  else if (s.data.me.role === 'driver') view = html`<${DriverApp} />`;
  else view = html`<${OfficeApp} />`;
  return html`${view}<${Toasts} /><${DialogHost} />
    ${!s.online && s.data && s.data.me.role !== 'driver' ? html`<div class="net-banner"><${Icon} name="wifiOff" size=${16} />${t('networkError')}</div>` : null}`;
}

async function boot() {
  setLang(getLang());
  update({ route: parseHash() });
  window.addEventListener('hashchange', () => { update({ route: parseHash() }); window.scrollTo(0, 0); });
  window.addEventListener('online', () => { update({ online: true }); flush(); loadState(); });
  window.addEventListener('offline', () => update({ online: false }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && store.data) { flush(); loadState(); } });

  render(html`<${App} />`, document.getElementById('app'));
  try { await loadState(); } catch {}
  if (store.data && store.data.me.role === 'driver') { loadQueue(); flush(); }
  update({ booted: true });

  // Keep dashboards and the driver queue fresh.
  setInterval(() => {
    if (document.hidden || !store.data) return;
    if (store.queue.length) flush();
    else loadState();
  }, 20000);
}

boot();
