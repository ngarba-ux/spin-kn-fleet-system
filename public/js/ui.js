import { html, useState, useEffect, useRef } from './lib.js';
import { t, getLang, setLang } from './i18n.js';
import { store, update, useStore } from './store.js';

// ================================================================ formatting

const safe = fn => { try { return fn(); } catch { return '—'; } };

export const fmtDT = iso => iso ? safe(() => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '—';
export const fmtDate = iso => iso ? safe(() => new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })) : '—';
export const fmtTime = iso => iso ? safe(() => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : '—';
export const fmtShort = iso => iso ? safe(() => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : '—';
export const num = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-NG', { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = n => '₦' + num(n || 0);
export const kmFmt = n => n == null ? '—' : num(n) + ' km';

export function duration(a, b) {
  if (!a) return '—';
  const mins = Math.max(0, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return t('justNow');
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return fmtDate(iso);
}

// <input type=datetime-local> <-> ISO (browser local time)
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = v => v ? new Date(v).toISOString() : null;
export const todayStr = () => toLocalInput(new Date().toISOString()).slice(0, 10);

// Days until a yyyy-MM-dd date (negative when past).
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}
export function expiryState(dateStr, warnDays = 30) {
  const n = daysUntil(dateStr);
  if (n == null) return { key: 'none', days: null };
  return n < 0 ? { key: 'expired', days: n } : n <= warnDays ? { key: 'expiring', days: n } : { key: 'valid', days: n };
}

export const mapUrl = (lat, lng) => lat == null || lng == null ? null : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
export const coords = (lat, lng) => lat == null || lng == null ? '—' : `${(+lat).toFixed(4)}, ${(+lng).toFixed(4)}`;

// ================================================================ icons (lucide-style strokes)

const ICONS = {
  dashboard: ['r 3 3 7 9 1', 'r 14 3 7 5 1', 'r 14 12 7 9 1', 'r 3 16 7 5 1'],
  car: ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', 'c 7 17 2', 'M9 17h6', 'c 17 17 2'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'c 9 7 4', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'c 12 7 4'],
  clipboard: ['r 8 2 8 4 1', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
  route: ['c 6 19 3', 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15', 'c 18 5 3'],
  fuel: ['M3 22h12', 'M4 9h10', 'M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18', 'M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5'],
  chart: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  qr: ['r 3 3 5 5 1', 'r 16 3 5 5 1', 'r 3 16 5 5 1', 'M21 16h-3a2 2 0 0 0-2 2v3', 'M21 21v.01', 'M12 7v3a2 2 0 0 1-2 2H7', 'M3 12h.01', 'M12 3h.01', 'M12 16v.01', 'M16 12h1', 'M21 12v.01', 'M12 21v-1'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  clock: ['c 12 12 10', 'M12 6v6l4 2'],
  pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z', 'c 12 10 3'],
  mail: ['r 2 4 20 16 2', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  printer: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'r 6 14 12 8 0'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  search: ['c 11 11 8', 'm21 21-4.3-4.3'],
  refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
  wifiOff: ['M2 2l20 20', 'M8.5 16.5a5 5 0 0 1 7 0', 'M2 8.82a15 15 0 0 1 4.17-2.65', 'M10.66 5c4.01-.36 8.14.9 11.34 3.76', 'M16.85 11.25a10 10 0 0 1 2.22 1.68', 'M5 13a10 10 0 0 1 5.24-2.76', 'M12 20h.01'],
  wifi: ['M5 13a10 10 0 0 1 14 0', 'M8.5 16.5a5 5 0 0 1 7 0', 'M2 8.82a15 15 0 0 1 20 0', 'M12 20h.01'],
  play: ['M6 3l14 9-14 9V3z'],
  pause: ['r 6 4 4 16 1', 'r 14 4 4 16 1'],
  square: ['r 4 4 16 16 2'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z', 'c 12 12 3'],
  send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10', 'm9 12 2 2 4-4'],
  calendar: ['r 3 4 18 18 2', 'M16 2v4', 'M8 2v4', 'M3 10h18'],
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', 'c 12 13 3'],
  file: ['M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z', 'M14 2v6h6'],
  truck: ['M10 17h4V5H2v12h3', 'M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1', 'c 7.5 17.5 2.5', 'c 17.5 17.5 2.5'],
  home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  gauge: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
  key: ['c 7.5 15.5 5.5', 'm21 2-9.6 9.6', 'm15.5 7.5 3 3L22 7l-3-3'],
  globe: ['c 12 12 10', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  edit: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  ban: ['c 12 12 10', 'm4.9 4.9 14.2 14.2'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  info: ['c 12 12 10', 'M12 16v-4', 'M12 8h.01'],
  copy: ['r 9 9 13 13 2', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  database: ['e 12 5 9 3', 'M3 5v14a9 3 0 0 0 18 0V5', 'M3 12a9 3 0 0 0 18 0'],
  checkCircle: ['c 12 12 10', 'm9 12 2 2 4-4'],
  xCircle: ['c 12 12 10', 'm15 9-6 6', 'm9 9 6 6'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  navigation: ['M3 11l19-9-9 19-2-8-8-2z'],
};

export function Icon({ name, size = 18, cls = '' }) {
  const parts = ICONS[name] || [];
  return html`<svg class=${'icon ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    ${parts.map(p => {
      const a = p.split(' ');
      if (a[0] === 'c') return html`<circle cx=${a[1]} cy=${a[2]} r=${a[3]} />`;
      if (a[0] === 'r') return html`<rect x=${a[1]} y=${a[2]} width=${a[3]} height=${a[4]} rx=${a[5]} />`;
      if (a[0] === 'e') return html`<ellipse cx=${a[1]} cy=${a[2]} rx=${a[3]} ry=${a[4]} />`;
      return html`<path d=${p} />`;
    })}
  </svg>`;
}

// ================================================================ basic components

export function Button({ variant = 'primary', size, icon, children, cls = '', busy, ...rest }) {
  return html`<button type="button" class=${`btn btn-${variant} ${size ? 'btn-' + size : ''} ${children ? '' : 'btn-icon'} ${cls}`} aria-label=${children ? undefined : rest.title} disabled=${busy || rest.disabled} ...${rest}>
    ${busy ? html`<span class="spinner" />` : icon ? html`<${Icon} name=${icon} size=${size === 'sm' ? 15 : 17} />` : null}
    ${children ? html`<span>${children}</span>` : null}
  </button>`;
}

export function Badge({ tone = 'slate', children, dot }) {
  return html`<span class=${'badge tone-' + tone}>${dot ? html`<span class="dot" />` : null}${children}</span>`;
}

const STATUS_TONES = {
  available: 'green', assigned: 'sky', inTransit: 'amber', maintenance: 'violet', outOfService: 'red',
  active: 'green', inactive: 'slate', completed: 'green', cancelled: 'slate', scheduled: 'sky', inProgress: 'amber',
  expired: 'red', expiring: 'amber', valid: 'green', terminated: 'red', revoked: 'red', due: 'red', soon: 'amber', ok: 'green',
  queued: 'sky', sending: 'sky', sent: 'green', failed: 'red', not_configured: 'slate',
  SUBMITTED: 'sky', ACKNOWLEDGED: 'sky', UNDER_ADMIN_REVIEW: 'amber', RETURNED_FOR_CORRECTION: 'red', FORWARDED_TO_SPC: 'violet',
  APPROVED: 'green', REJECTED: 'red', CANCELLED: 'slate', DRIVER_ASSIGNED: 'teal', TRIP_COMPLETED: 'green', CLOSED: 'slate', DRAFT: 'slate',
};

export const REQ_LABEL = {
  SUBMITTED: 'Submitted', ACKNOWLEDGED: 'Acknowledged', UNDER_ADMIN_REVIEW: 'Under review', RETURNED_FOR_CORRECTION: 'Returned',
  FORWARDED_TO_SPC: 'With SPC', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', DRIVER_ASSIGNED: 'Driver assigned',
  TRIP_COMPLETED: 'Trip completed', CLOSED: 'Closed', DRAFT: 'Draft',
};

const EMAIL_LABEL = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', not_configured: 'Not sent (email off)' };

// Status pill for any entity status. `staff` switches request statuses to the staff-facing wording.
export function Status({ status, staff }) {
  let label;
  if (REQ_LABEL[status]) label = staff ? t('rs_' + status) : REQ_LABEL[status];
  else if (EMAIL_LABEL[status]) label = EMAIL_LABEL[status];
  else if (status === 'ok') label = 'OK';
  else if (status === 'soon') label = t('serviceDueSoon');
  else label = t('st_' + status);
  return html`<${Badge} tone=${STATUS_TONES[status] || 'slate'} dot>${label}<//>`;
}

export function Card({ title, sub, actions, children, cls = '', pad = true, icon }) {
  return html`<section class=${'card ' + cls}>
    ${title || actions ? html`<header class="card-hd">
      <div class="card-title">${icon ? html`<span class="card-icon"><${Icon} name=${icon} size=${16} /></span>` : null}<div><h3>${title}</h3>${sub ? html`<p>${sub}</p>` : null}</div></div>
      ${actions ? html`<div class="card-actions">${actions}</div>` : null}
    </header>` : null}
    <div class=${pad ? 'card-bd' : ''}>${children}</div>
  </section>`;
}

export function Stat({ label, value, sub, tone = 'slate', icon, onClick }) {
  return html`<button type="button" class=${'stat' + (onClick ? ' clickable' : '')} onClick=${onClick} disabled=${!onClick}>
    <span class=${'stat-icon tone-' + tone}><${Icon} name=${icon} size=${18} /></span>
    <span class="stat-body"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? html`<span class="stat-sub">${sub}</span>` : null}</span>
  </button>`;
}

export function Empty({ icon = 'inbox', text, children }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${28} /><p>${text}</p>${children}</div>`;
}

export function Field({ label, hint, error, required, children, cls = '' }) {
  return html`<label class=${'field ' + cls}>
    ${label ? html`<span class="field-label">${label}${required ? html`<span class="req">*</span>` : null}</span>` : null}
    ${children}
    ${error ? html`<span class="field-error">${error}</span>` : hint ? html`<span class="field-hint">${hint}</span>` : null}
  </label>`;
}

// Controlled input bound to form[key]
export function bind(form, setForm, key, transform) {
  return {
    value: form[key] ?? '',
    onInput: e => { const v = e.target.value; setForm(f => ({ ...f, [key]: transform ? transform(v) : v })); },
  };
}

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return html`<select class="input" value=${value ?? ''} onChange=${e => onChange(e.target.value || null)} ...${rest}>
    ${placeholder !== undefined ? html`<option value="">${placeholder}</option>` : null}
    ${options.map(o => typeof o === 'string' ? html`<option value=${o}>${o}</option>` : html`<option value=${o.value} disabled=${o.disabled}>${o.label}</option>`)}
  </select>`;
}

export function Tabs({ value, onChange, items }) {
  return html`<div class="tabs" role="tablist">
    ${items.map(it => html`<button type="button" role="tab" aria-selected=${value === it.value} class=${'tab' + (value === it.value ? ' active' : '')} onClick=${() => onChange(it.value)}>
      ${it.label}${it.count != null ? html`<span class="tab-count">${it.count}</span>` : null}
    </button>`)}
  </div>`;
}

export function SearchBox({ value, onInput, placeholder }) {
  return html`<div class="search"><${Icon} name="search" size=${16} /><input class="input" type="search" placeholder=${placeholder || t('search')} value=${value} onInput=${e => onInput(e.target.value)} /></div>`;
}

export function Modal({ title, sub, onClose, children, footer, wide, size }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, []);
  return html`<div class="modal-wrap" onMouseDown=${e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class=${'modal' + (wide ? ' modal-wide' : '') + (size === 'sm' ? ' modal-sm' : '')} role="dialog" aria-modal="true">
      <header class="modal-hd">
        <div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : null}</div>
        ${onClose ? html`<button type="button" class="icon-btn" onClick=${onClose} aria-label=${t('close')}><${Icon} name="x" /></button>` : null}
      </header>
      <div class="modal-bd">${children}</div>
      ${footer ? html`<footer class="modal-ft">${footer}</footer>` : null}
    </div>
  </div>`;
}

export function KV({ items }) {
  return html`<dl class="kv">${items.filter(Boolean).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd></div>`)}</dl>`;
}

export function LangToggle({ compact }) {
  useStore();
  const lang = getLang();
  return html`<div class="lang" title=${t('language')}>
    ${compact ? null : html`<${Icon} name="globe" size=${15} />`}
    <button type="button" class=${lang === 'en' ? 'on' : ''} onClick=${() => { setLang('en'); update({}); }}>EN</button>
    <button type="button" class=${lang === 'ha' ? 'on' : ''} onClick=${() => { setLang('ha'); update({}); }}>HA</button>
  </div>`;
}

export function Progress({ value, tone = 'green' }) {
  return html`<div class="progress"><div class=${'bar tone-' + tone} style=${{ width: Math.max(0, Math.min(100, value)) + '%' }} /></div>`;
}

export function Alert({ tone = 'amber', icon = 'alert', title, children, action }) {
  return html`<div class=${'alert tone-' + tone}><${Icon} name=${icon} size=${18} /><div class="alert-body">${title ? html`<strong>${title}</strong>` : null}<div>${children}</div></div>${action}</div>`;
}

// ================================================================ toasts & dialogs

export function Toasts() {
  const s = useStore();
  return html`<div class="toasts" aria-live="polite">
    ${s.toasts.map(x => html`<div key=${x.id} class=${'toast toast-' + x.type}>
      <${Icon} name=${x.type === 'error' ? 'xCircle' : x.type === 'warn' ? 'alert' : 'checkCircle'} size=${18} />
      <div><div class="toast-msg">${x.msg}</div>${x.sub ? html`<div class="toast-sub">${x.sub}</div>` : null}</div>
    </div>`)}
  </div>`;
}

export function DialogHost() {
  const s = useStore();
  const d = s.dialog;
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setText(d && d.input && d.input.value || ''); setErr(''); }, [d]);
  if (!d) return null;
  const close = v => { update({ dialog: null }); d.resolve(v); };
  const ok = () => {
    if (d.input) {
      if (d.input.required && !text.trim()) { setErr(t('provideReason')); return; }
      close(text.trim());
    } else close(true);
  };
  return html`<${Modal} title=${d.title} onClose=${() => close(false)} size="sm" footer=${html`
      <${Button} variant="ghost" onClick=${() => close(false)}>${d.cancelLabel || t('cancel')}<//>
      <${Button} variant=${d.tone === 'danger' ? 'danger' : 'primary'} onClick=${ok}>${d.confirmLabel || t('yes')}<//>`}>
    ${d.body ? html`<p class="muted">${d.body}</p>` : null}
    ${d.input ? html`<${Field} label=${d.input.label} required=${d.input.required} error=${err}>
      <textarea class="input" rows="3" placeholder=${d.input.placeholder || ''} value=${text} onInput=${e => setText(e.target.value)} autofocus></textarea>
    <//>` : null}
  <//>`;
}

// ================================================================ files, QR, print, CSV

// Read a file as a data URL, shrinking photos so they upload quickly on mobile data.
export async function readFile(file, { maxDim = 1400, quality = 0.7 } = {}) {
  if (!file) return null;
  const okType = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type);
  if (!okType && !/^image\//.test(file.type)) throw new Error(t('fileType'));
  const raw = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error(t('fileType'))); r.readAsDataURL(file); });
  if (!/^image\//.test(file.type)) {
    if (file.size > 5 * 1024 * 1024) throw new Error(t('fileTooBig'));
    return { name: file.name, data: raw };
  }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t('fileType'))); i.src = raw; });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', quality);
  if (data.length > 7 * 1024 * 1024) throw new Error(t('fileTooBig'));
  return { name: file.name.replace(/\.\w+$/, '') + '.jpg', data };
}

export function FilePick({ value, onChange, accept = 'image/*,application/pdf', capture, label, icon = 'file', opts }) {
  const ref = useRef();
  const [err, setErr] = useState('');
  const pick = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { setErr(''); onChange(await readFile(f, opts)); } catch (x) { setErr(x.message); }
  };
  return html`<div class="filepick">
    <input ref=${ref} type="file" accept=${accept} capture=${capture} onChange=${pick} hidden />
    ${value ? html`<div class="file-chip">
        ${/^data:image/.test(value.data) ? html`<img src=${value.data} alt="" />` : html`<${Icon} name="file" />`}
        <span>${value.name}</span>
        <button type="button" class="link" onClick=${() => onChange(null)}>${t('removeFile')}</button>
      </div>`
      : html`<${Button} variant="secondary" icon=${icon} onClick=${() => ref.current.click()}>${label || t('attachFile')}<//>`}
    ${err ? html`<span class="field-error">${err}</span>` : null}
  </div>`;
}

export function qrSvg(text, color = '#065f46') {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace(/fill="black"/g, `fill="${color}"`).replace(/fill="#000000"/g, `fill="${color}"`);
}

export function QR({ text, size = 180 }) {
  return html`<div class="qr" style=${{ width: size + 'px', height: size + 'px' }} dangerouslySetInnerHTML=${{ __html: qrSvg(text) }} />`;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Print arbitrary (already escaped) HTML using the current page, so no pop-up
// blocker or inline-script policy gets in the way.
export function printHtml(inner, title) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = inner;
  const prevTitle = document.title;
  if (title) document.title = title;
  document.body.classList.add('print-mode');
  const done = () => { document.body.classList.remove('print-mode'); root.innerHTML = ''; document.title = prevTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

export function downloadCsv(filename, rows) {
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}

// Best-effort GPS fix. Resolves {lat, lng} or {error}.
export function getPosition(timeout = 12000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ error: 'unsupported' });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
      e => resolve({ error: e.message || 'failed' }),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}

export const byId = (list, id) => (list || []).find(x => x.id === id);
export const sortBy = (list, fn, desc) => [...list].sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
export const qrLink = (token) => {
  const s = store.data && store.data.settings;
  const base = (s && s.publicBaseUrl) || location.origin;
  return base.replace(/\/$/, '') + '/#s=' + token;
};
