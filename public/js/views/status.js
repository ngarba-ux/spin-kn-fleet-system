import { html, useState, useEffect } from '../lib.js';
import { t } from '../i18n.js';
import { publicApi } from '../store.js';
import { Button, Status, Icon, KV, LangToggle, fmtDT, Alert } from '../ui.js';

// Staff-facing wording for each audit event. Internal steps (SPC etc.) are
// deliberately presented as the Logistics & Transport office.
const STEP = {
  TRIP_REQUEST_SUBMITTED: 'sf_submitted', TRIP_REQUEST_RESUBMITTED: 'sf_resubmitted', ADMIN_ACKNOWLEDGED: 'sf_received',
  ADMIN_REVIEWED: 'sf_review', FORWARDED_TO_SPC: 'sf_review', RETURNED_FOR_CORRECTION: 'sf_returned', SPC_APPROVED: 'sf_approved',
  SPC_REJECTED: 'sf_declined', TRIP_RESCHEDULED: 'sf_rescheduled', DRIVER_ASSIGNED: 'sf_assigned', REQUEST_CANCELLED: 'sf_cancelled',
  TRIP_COMPLETED: 'sf_completed', REQUEST_CLOSED: 'sf_closed',
};
const BAD = new Set(['RETURNED_FOR_CORRECTION', 'SPC_REJECTED', 'REQUEST_CANCELLED']);

export function Timeline({ items }) {
  const steps = [];
  for (const h of items) {
    const label = STEP[h.action];
    if (!label) continue;
    const last = steps[steps.length - 1];
    if (last && last.label === label && !h.note) continue;
    steps.push({ label, ts: h.ts, note: h.note, bad: BAD.has(h.action) });
  }
  return html`<ol class="timeline">
    ${steps.map((s, i) => html`<li class=${(s.bad ? 'bad' : '') + (i === steps.length - 1 ? ' current' : '')}>
      <span class="tl-dot"><${Icon} name=${s.bad ? 'x' : 'check'} size=${12} /></span>
      <div><div class="tl-label">${t(s.label)}</div><div class="tl-ts">${fmtDT(s.ts)}</div>${s.note ? html`<div class="tl-note">${s.note}</div>` : null}</div>
    </li>`)}
  </ol>`;
}

export function StatusDetails({ statusToken }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setD(await publicApi('status', { statusToken })); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [statusToken]);
  if (err && !d) return html`<${Alert} tone="red" icon="xCircle" title=${t('requestNotFound')}>${err}<//>`;
  if (!d) return html`<div class="loading"><span class="spinner dark" /> ${t('loading')}</div>`;
  return html`<div class="stack">
    <div class="row between wrap">
      <div><div class="eyebrow">${t('reference')}</div><div class="ref-big">${d.ref}</div></div>
      <div class="row gap-sm"><${Status} status=${d.status} staff /><${Button} variant="ghost" size="sm" icon="refresh" busy=${busy} onClick=${load}>${t('refresh')}<//></div>
    </div>
    ${d.driver ? html`<div class="assigned-box">
      <div class="eyebrow">${t('driverAssignedTitle')}</div>
      <div class="row gap wrap">
        <div class="row gap-sm"><span class="round-icon sm"><${Icon} name="user" size=${16} /></span><div><strong>${d.driver.name}</strong>${d.driver.phone ? html`<div><a href=${'tel:' + d.driver.phone.replace(/\s/g, '')}>${d.driver.phone}</a></div>` : null}</div></div>
        ${d.vehicle ? html`<div class="row gap-sm"><span class="round-icon sm"><${Icon} name="car" size=${16} /></span><div><strong>${d.vehicle.reg}</strong><div class="muted small">${d.vehicle.model}${d.vehicle.colour ? ' · ' + d.vehicle.colour : ''}</div></div></div>` : null}
      </div>
    </div>` : null}
    <${KV} items=${[
      [t('tripPurpose'), d.purpose], [t('destination'), d.destination], [t('drivingComponent'), d.component],
      [t('departure'), fmtDT(d.departTs)], [t('expectedReturn'), fmtDT(d.returnTs)], [t('numPassengers'), d.passengers],
      [t('priorityLbl'), d.priority === 'urgent' ? t('urgent') : t('normal')], [t('submittedOn'), fmtDT(d.createdTs)],
    ]} />
    <div><div class="eyebrow mb-sm">${t('auditTrail')}</div><${Timeline} items=${d.timeline} /></div>
  </div>`;
}

export function StaffHeader({ right }) {
  return html`<header class="staff-hd">
    <div class="row gap-sm"><img src="/logo.png" alt="" class="brand-logo sm" /><div><div class="brand-name sm">SPIN KN FLEET</div><div class="muted xsmall">${t('logisticsOffice')}</div></div></div>
    <div class="row gap-sm"><${LangToggle} compact />${right}</div>
  </header>`;
}

export function StatusPage({ token }) {
  return html`<div class="staff-page">
    <${StaffHeader} right=${html`<a class="btn btn-ghost btn-sm" href="#" aria-label=${t('backHome')}><${Icon} name="home" size=${16} /><span class="hide-sm">${t('backHome')}</span></a>`} />
    <main class="staff-main"><div class="card"><div class="card-bd"><h2 class="mb">${t('checkStatus')}</h2><${StatusDetails} statusToken=${token} /></div></div></main>
  </div>`;
}
