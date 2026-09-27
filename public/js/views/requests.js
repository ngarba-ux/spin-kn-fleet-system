import { html, useState, useEffect, useMemo } from '../lib.js';
import { t } from '../i18n.js';
import { act, api, ask } from '../store.js';
import { Button, Field, Icon, Status, Badge, Alert, Modal, Empty, KV, Tabs, SearchBox, Select, Card,
  fmtDT, fmtShort, duration, toLocalInput, fromLocalInput, byId, REQ_LABEL } from '../ui.js';
import { PageHead } from './office.js';

export const needsAdmin = r => ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'APPROVED', 'TRIP_COMPLETED'].includes(r.status);
const FINISHED = ['TRIP_COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED'];
const OPEN = ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'RETURNED_FOR_CORRECTION', 'FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED'];

const ACTION_LABEL = {
  TRIP_REQUEST_SUBMITTED: 'Submitted', TRIP_REQUEST_RESUBMITTED: 'Corrected & resubmitted', ADMIN_ACKNOWLEDGED: 'Acknowledged',
  ADMIN_REVIEWED: 'Marked under review', FORWARDED_TO_SPC: 'Forwarded to SPC', RETURNED_FOR_CORRECTION: 'Returned for correction',
  SPC_APPROVED: 'Approved by SPC', SPC_REJECTED: 'Rejected by SPC', TRIP_RESCHEDULED: 'Rescheduled', DRIVER_ASSIGNED: 'Vehicle & driver assigned',
  REQUEST_CANCELLED: 'Cancelled', TRIP_COMPLETED: 'Trip completed', REQUEST_CLOSED: 'Closed', AUTO_DISPATCH_SKIPPED: 'Automatic assignment skipped',
};

const staffOf = (d, r) => byId(d.staff, r.staffId) || { fullName: 'Unknown staff', unit: '', unitCode: '' };

function matches(d, r, q) {
  if (!q) return true;
  const s = staffOf(d, r);
  return [r.ref, r.purpose, r.destination, s.fullName, s.unit, s.unitCode].join(' ').toLowerCase().includes(q.toLowerCase());
}

export function RequestsPage({ d, id, role }) {
  const [tab, setTab] = useState(role === 'admin' ? 'action' : 'all');
  const [q, setQ] = useState('');
  const [prio, setPrio] = useState('');
  const open = id ? byId(d.requests, id) : null;

  const groups = role === 'admin'
    ? [{ value: 'action', label: 'Needs action', fn: needsAdmin }, { value: 'progress', label: 'In progress', fn: r => OPEN.includes(r.status) && !needsAdmin(r) },
       { value: 'finished', label: 'Finished', fn: r => FINISHED.includes(r.status) && !needsAdmin(r) }, { value: 'all', label: 'All', fn: () => true }]
    : [{ value: 'spc', label: t('pending'), fn: r => r.status === 'FORWARDED_TO_SPC' }, { value: 'all', label: 'All', fn: () => true }];
  const g = groups.find(x => x.value === tab) || groups[0];
  const rows = d.requests.filter(g.fn).filter(r => matches(d, r, q)).filter(r => !prio || r.priority === prio)
    .sort((a, b) => tab === 'action' || tab === 'spc'
      ? (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || (a.departTs < b.departTs ? -1 : 1)
      : (a.createdTs < b.createdTs ? 1 : -1));

  return html`<div class="stack">
    <${PageHead} title=${t('tripRequests')} sub="Requests staff submitted by scanning their ID card QR code." />
    <div class="toolbar">
      <${Tabs} value=${g.value} onChange=${setTab} items=${groups.map(x => ({ value: x.value, label: x.label, count: d.requests.filter(x.fn).length }))} />
      <div class="row gap-sm wrap">
        <${SearchBox} value=${q} onInput=${setQ} placeholder="Ref, name, destination…" />
        <${Select} value=${prio} onChange=${v => setPrio(v || '')} placeholder=${t('allPriorities')} options=${[{ value: 'urgent', label: t('urgent') }, { value: 'normal', label: t('normal') }]} />
      </div>
    </div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('reference')}</th><th>${t('requestedBy')}</th><th>${t('destination')}</th><th>${t('tripDates')}</th><th class="num">${t('passengers')}</th><th>${t('status')}</th><th>${t('submittedOn')}</th></tr></thead>
        <tbody>${rows.map(r => {
          const s = staffOf(d, r);
          return html`<tr class="clickable" onClick=${() => (location.hash = '#/requests/' + r.id)}>
            <td><b>${r.ref}</b>${r.priority === 'urgent' ? html` <${Badge} tone="red">${t('urgent')}<//>` : null}</td>
            <td>${s.fullName}<div class="xsmall muted">${s.unitCode} · ${s.designation || ''}</div></td>
            <td>${r.destination}<div class="xsmall muted clamp">${r.purpose}</div></td>
            <td class="nowrap">${fmtShort(r.departTs)}<div class="xsmall muted">→ ${fmtShort(r.returnTs)}</div></td>
            <td class="num">${r.passengers}</td>
            <td><${Status} status=${r.status} /></td>
            <td class="nowrap xsmall muted">${fmtShort(r.createdTs)}</td>
          </tr>`;
        })}</tbody></table></div>` : html`<${Empty} icon="inbox" text=${q ? t('empty_search') : 'No requests here.'} />`}
    <//>
    ${open ? html`<${RequestDetail} d=${d} r=${open} role=${role} onClose=${() => (location.hash = '#/requests')} />` : null}
  </div>`;
}

export function ApprovalsPage({ d, id, role }) {
  const pending = d.requests.filter(r => r.status === 'FORWARDED_TO_SPC').sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || (a.departTs < b.departTs ? -1 : 1));
  const decided = d.requests.filter(r => r.spcDecision).sort((a, b) => (a.updatedTs < b.updatedTs ? 1 : -1)).slice(0, 8);
  const [open, setOpen] = useState(null);
  const current = open ? byId(d.requests, open) : null;
  return html`<div class="stack-lg">
    <${PageHead} title=${t('spcDashboard')} sub="Trip requests forwarded by Logistics & Transport for your decision." />
    ${pending.length ? html`<div class="approval-grid">${pending.map(r => {
      const s = staffOf(d, r);
      const drv = byId(d.drivers, r.proposedDriverId), veh = byId(d.vehicles, r.proposedVehicleId);
      return html`<div class="card approval"><div class="card-bd stack-sm">
        <div class="row between"><b>${r.ref}</b>${r.priority === 'urgent' ? html`<${Badge} tone="red">${t('urgent')}<//>` : html`<${Badge}>${t('normal')}<//>`}</div>
        <div class="approval-purpose">${r.purpose}</div>
        <div class="small"><${Icon} name="user" size=${13} /> ${s.fullName} <span class="muted">· ${s.designation}</span></div>
        <div class="small"><${Icon} name="pin" size=${13} /> ${r.destination}</div>
        <div class="small"><${Icon} name="calendar" size=${13} /> ${fmtShort(r.departTs)} → ${fmtShort(r.returnTs)} <span class="muted">(${duration(r.departTs, r.returnTs)})</span></div>
        <div class="small"><${Icon} name="users" size=${13} /> ${r.passengers} ${t('passengers').toLowerCase()} · ${r.vehicle}</div>
        ${r.priority === 'urgent' && r.urgentReason ? html`<div class="note-box tone-red small"><b>${t('urgentJustification')}:</b> ${r.urgentReason}</div>` : null}
        ${r.adminRemark ? html`<div class="note-box small"><b>${t('adminRemarkView')} (${r.forwardedByName}):</b> ${r.adminRemark}</div>` : null}
        ${drv ? html`<div class="small"><b>${t('proposedDriverLbl')}:</b> ${drv.name}${veh ? ' · ' + veh.reg : ''}</div>` : html`<div class="small muted">No driver proposed yet — Logistics will assign after approval.</div>`}
        <div class="row gap-sm wrap mt-sm">
          <${Button} size="sm" icon="check" onClick=${() => approve(r)}>${t('approve')}<//>
          <${Button} size="sm" variant="ghost-danger" icon="x" onClick=${() => reject(r)}>${t('reject')}<//>
          <${Button} size="sm" variant="ghost" onClick=${() => setOpen(r.id)}>${t('details')}<//>
        </div>
      </div></div>`;
    })}</div>` : html`<${Card}><${Empty} icon="checkCircle" text="No requests are waiting for your decision." /><//>`}
    ${decided.length ? html`<${Card} title="Your recent decisions" pad=${false}><div class="list-card flat">${decided.map(r => html`<a class="list-row" href=${'#/requests/' + r.id}><div><b>${r.ref}</b> · ${r.destination}<div class="xsmall muted">${staffOf(d, r).fullName} · ${fmtShort(r.departTs)}</div></div><${Status} status=${r.status} /></a>`)}</div><//>` : null}
    ${current ? html`<${RequestDetail} d=${d} r=${current} role=${role} onClose=${() => setOpen(null)} />` : null}
  </div>`;
}

async function approve(r) {
  const c = await ask({ title: `${t('approve')} ${r.ref}?`, body: r.proposedDriverId ? t('autoDispatched') : 'Logistics & Transport will be asked to assign a vehicle and driver.', input: { label: t('comment') + ' (' + t('optional').toLowerCase() + ')' }, confirmLabel: t('approve') });
  if (c === false) return;
  act('request.approve', { id: r.id, comment: c }, t('decisionRecorded'));
}

async function reject(r) {
  const c = await ask({ title: `${t('reject')} ${r.ref}?`, body: 'The requester will be emailed with your reason.', input: { label: t('reason'), required: true }, confirmLabel: t('reject'), tone: 'danger' });
  if (c === false) return;
  act('request.reject', { id: r.id, comment: c }, t('decisionRecorded'));
}

// ---------------------------------------------------------------- detail

function RequestDetail({ d, r, role, onClose }) {
  const [dialog, setDialog] = useState(null);
  const s = staffOf(d, r);
  const pDrv = byId(d.drivers, r.proposedDriverId), pVeh = byId(d.vehicles, r.proposedVehicleId);
  const dDrv = byId(d.drivers, r.dispatchDriverId), dVeh = byId(d.vehicles, r.dispatchVehicleId);
  const task = byId(d.tasks, r.taskId);
  const trip = task && task.tripId ? byId(d.trips, task.tripId) : null;
  const emails = (d.notifications || []).filter(n => n.requestId === r.id);
  const st = r.status;
  const admin = role === 'admin', spc = role === 'spc';

  const reason = async (title, type, label, tone) => {
    const c = await ask({ title, input: { label: label || t('reason'), required: true }, confirmLabel: title, tone });
    if (c === false) return;
    act(type, { id: r.id, comment: c }, t('actionRecorded'));
  };

  const actions = [];
  if (admin) {
    if (st === 'SUBMITTED') actions.push(html`<${Button} variant="secondary" icon="check" onClick=${() => act('request.ack', { id: r.id }, t('actionRecorded'))}>${t('ackAction')}<//>`);
    if (st === 'SUBMITTED' || st === 'ACKNOWLEDGED') actions.push(html`<${Button} variant="secondary" icon="eye" onClick=${() => act('request.review', { id: r.id }, t('actionRecorded'))}>${t('review')}<//>`);
    if (['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW'].includes(st)) actions.push(html`<${Button} icon="send" onClick=${() => setDialog('forward')}>${t('forwardToSpc')}<//>`);
    if (st === 'APPROVED') actions.push(html`<${Button} icon="truck" onClick=${() => setDialog('dispatch')}>${t('assignDispatch')}<//>`);
    if (st === 'DRIVER_ASSIGNED' && (!task || task.status === 'scheduled')) actions.push(html`<${Button} variant="secondary" icon="truck" onClick=${() => setDialog('dispatch')}>Reassign<//>`);
    if (st === 'TRIP_COMPLETED') actions.push(html`<${Button} icon="check" onClick=${() => act('request.close', { id: r.id }, t('actionRecorded'))}>Close request<//>`);
    if (OPEN.includes(st) && st !== 'RETURNED_FOR_CORRECTION' && !(task && task.status === 'inProgress')) actions.push(html`<${Button} variant="ghost" icon="calendar" onClick=${() => setDialog('reschedule')}>${t('reschedule')}<//>`);
    if (['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'FORWARDED_TO_SPC', 'APPROVED'].includes(st)) actions.push(html`<${Button} variant="ghost" icon="undo" onClick=${() => reason(t('returnForCorrection'), 'request.return', 'Reason (sent to the requester)')}>${t('returnForCorrection')}<//>`);
    if (OPEN.includes(st) && !(task && task.status === 'inProgress')) actions.push(html`<${Button} variant="ghost-danger" icon="ban" onClick=${() => reason(t('cancelRequest'), 'request.cancel', null, 'danger')}>${t('cancelRequest')}<//>`);
  }
  if (spc && st === 'FORWARDED_TO_SPC') {
    actions.push(html`<${Button} icon="check" onClick=${() => approve(r)}>${t('approve')}<//>`);
    actions.push(html`<${Button} variant="ghost" icon="calendar" onClick=${() => setDialog('reschedule')}>Approve with new dates<//>`);
    actions.push(html`<${Button} variant="ghost" icon="undo" onClick=${() => reason(t('returnForCorrection'), 'request.return', 'Reason (sent to the requester)')}>${t('returnForCorrection')}<//>`);
    actions.push(html`<${Button} variant="ghost-danger" icon="x" onClick=${() => reject(r)}>${t('reject')}<//>`);
  }

  return html`<${Modal} wide title=${html`${r.ref} <${Status} status=${st} />${r.priority === 'urgent' ? html` <${Badge} tone="red">${t('urgent')}<//>` : null}`}
      sub=${`${t('submittedOn')} ${fmtDT(r.createdTs)}`} onClose=${onClose}
      footer=${actions.length ? html`<div class="row gap-sm wrap">${actions}</div>` : null}>
    <div class="detail-grid">
      <div class="stack">
        <section><h4 class="sec-title">${t('requestDetails')}</h4>
          <${KV} items=${[
            [t('tripPurpose'), r.purpose], [t('destination'), r.destination], [t('drivingComponent'), r.component],
            [t('departure'), fmtDT(r.departTs)], [t('expectedReturn'), html`${fmtDT(r.returnTs)} <span class="muted">(${duration(r.departTs, r.returnTs)})</span>`],
            [t('numPassengers'), r.passengers], [t('vehicleRequirement'), r.vehicle],
            r.priority === 'urgent' && [t('urgentJustification'), r.urgentReason],
            [t('officialAssignment'), r.assignment], [t('additionalRemarks'), r.remarks],
            r.docId && [t('supportingDoc'), html`<a class="link" href=${'/api/files/' + r.docId} target="_blank" rel="noopener"><${Icon} name="file" size=${14} /> Open document</a>`],
            r.rescheduledFromDepart && [t('originalDate'), `${fmtShort(r.rescheduledFromDepart)} → ${fmtShort(r.rescheduledFromReturn)}`],
          ]} />
        </section>
        ${r.passengerList && r.passengerList.length ? html`<section><h4 class="sec-title">${t('passengerDetails')}</h4><ul class="plain small">${r.passengerList.map(p => html`<li>${p.name}${p.org ? html` <span class="muted">· ${p.org}</span>` : null}</li>`)}</ul></section>` : null}
        <section><h4 class="sec-title">${t('staffInformation')}</h4>
          <${KV} items=${[[t('fullName'), s.fullName], [t('designation'), s.designation], [t('unitSection'), `${s.unitCode || ''} — ${s.unit || ''}`], [t('officialEmail'), s.email], [t('phone'), s.phone]]} />
        </section>
      </div>
      <div class="stack">
        ${r.adminRemark || pDrv ? html`<section class="note-box"><h4 class="sec-title">${t('forwardToSpcTitle')}</h4>
          ${r.adminRemark ? html`<p class="small"><b>${t('adminRemarkView')}:</b> ${r.adminRemark} <span class="muted">— ${r.forwardedByName || ''}</span></p>` : null}
          ${pDrv ? html`<p class="small"><b>${t('proposedDriverLbl')}:</b> ${pDrv.name}${pVeh ? ' · ' + pVeh.reg : ''}</p>` : null}
        </section>` : null}
        ${dDrv ? html`<section class="assigned-box"><h4 class="sec-title">${t('driverAssignedChip')}</h4>
          <p class="small"><b>${dDrv.name}</b> · ${dDrv.phone || ''}<br />${dVeh ? html`${dVeh.reg} — ${dVeh.model}` : ''}</p>
          ${task ? html`<p class="small">Task: <${Status} status=${task.status} />${task.acknowledged ? html` <${Badge} tone="green">${t('acknowledged')}<//>` : null}</p>` : null}
          ${trip ? html`<p class="small">Trip started ${fmtShort(trip.startTs)}${trip.endTs ? ', ended ' + fmtShort(trip.endTs) : ''} · <a class="link" href=${'#/trips/' + trip.id}>open trip</a></p>` : null}
          <p class="xsmall muted">${t('dispatchedBy')} ${r.dispatchedByName || ''}</p>
        </section>` : null}
        <section><h4 class="sec-title">${t('auditTrail')}</h4>
          <ol class="audit">${[...r.history].reverse().map(h => html`<li>
            <div class="row between gap-sm"><b class="small">${ACTION_LABEL[h.action] || h.action}</b><span class="xsmall muted nowrap">${fmtShort(h.ts)}</span></div>
            <div class="xsmall muted">${h.actor}${h.from !== h.to ? ` · ${REQ_LABEL[h.from] || h.from} → ${REQ_LABEL[h.to] || h.to}` : ''}</div>
            ${h.comment ? html`<div class="small audit-comment">${h.comment}</div>` : null}
          </li>`)}</ol>
        </section>
        ${role === 'admin' && emails.length ? html`<section><h4 class="sec-title">${t('emailLog')}</h4>
          <ul class="plain small">${emails.map(n => html`<li class="row between gap-sm"><span class="clamp">${n.subject} <span class="muted">→ ${n.to || '—'}</span></span><${Status} status=${n.status} /></li>`)}</ul>
        </section>` : null}
      </div>
    </div>
    ${dialog === 'forward' ? html`<${AssignDialog} d=${d} r=${r} mode="forward" onClose=${() => setDialog(null)} />` : null}
    ${dialog === 'dispatch' ? html`<${AssignDialog} d=${d} r=${r} mode="dispatch" onClose=${() => setDialog(null)} />` : null}
    ${dialog === 'reschedule' ? html`<${RescheduleDialog} r=${r} role=${role} onClose=${() => setDialog(null)} />` : null}
  <//>`;
}

// ---------------------------------------------------------------- dialogs

function driverOptions(d) {
  return d.drivers.filter(x => x.account === 'active').map(x => {
    const v = byId(d.vehicles, x.vehicleId);
    return { value: x.id, label: `${x.name}${v ? ' — ' + v.reg : ' — no vehicle'}${x.contract !== 'active' ? ' (contract ' + x.contract + ')' : ''}` };
  });
}

function vehicleOptions(d) {
  return d.vehicles.map(v => ({ value: v.id, label: `${v.reg} — ${v.model}${v.status === 'maintenance' || v.status === 'outOfService' ? ' (' + t('st_' + v.status) + ')' : ''}`, disabled: v.status === 'maintenance' || v.status === 'outOfService' }));
}

function Conflicts({ list, checking, driverId }) {
  if (checking) return html`<p class="xsmall muted"><span class="spinner dark sm" /> Checking schedule…</p>`;
  if (!list) return null;
  if (!list.length) return driverId ? html`<p class="small tone-text-green"><${Icon} name="checkCircle" size=${14} /> ${t('overlapClear')}</p>` : null;
  return html`<${Alert} tone="amber" title=${t('overlapWarn')}><ul class="plain">${list.map(x => html`<li>${x}</li>`)}</ul><//>`;
}

function AssignDialog({ d, r, mode, onClose }) {
  const forward = mode === 'forward';
  const [f, setF] = useState({ driverId: forward ? r.proposedDriverId : (r.dispatchDriverId || r.proposedDriverId), vehicleId: forward ? r.proposedVehicleId : (r.dispatchVehicleId || r.proposedVehicleId), remark: r.adminRemark || '', comment: '' });
  const [conflicts, setConflicts] = useState(null);
  const [checking, setChecking] = useState(false);
  const [forceable, setForceable] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickDriver = id => {
    const drv = byId(d.drivers, id);
    setF(x => ({ ...x, driverId: id, vehicleId: drv && drv.vehicleId ? drv.vehicleId : x.vehicleId }));
  };

  useEffect(() => {
    if (!f.driverId && !f.vehicleId) { setConflicts(null); return; }
    let live = true;
    setChecking(true);
    api('/api/action', { type: 'request.checkConflicts', data: { id: r.id, driverId: f.driverId, vehicleId: f.vehicleId } })
      .then(st => { if (live) setConflicts(st.result || []); })
      .catch(() => { if (live) setConflicts(null); })
      .finally(() => live && setChecking(false));
    return () => { live = false; };
  }, [f.driverId, f.vehicleId]);

  const submit = async force => {
    if (!forward && !f.driverId) return;
    setBusy(true);
    const res = forward
      ? await act('request.forward', { id: r.id, driverId: f.driverId, vehicleId: f.vehicleId, remark: f.remark, force }, t('pushedToSpc'))
      : await act('request.dispatch', { id: r.id, driverId: f.driverId, vehicleId: f.vehicleId, comment: f.comment, force }, t('actionRecorded'));
    setBusy(false);
    if (res.ok) onClose();
    else if (res.error && res.error.code === 'conflict') { setConflicts(res.error.details || []); setForceable(true); }
  };

  return html`<${Modal} title=${forward ? t('forwardToSpcTitle') : t('assignDispatch')} sub=${`${r.ref} · ${r.destination} · ${fmtShort(r.departTs)} → ${fmtShort(r.returnTs)}`} onClose=${onClose}
      footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//>
        ${forceable && conflicts && conflicts.length ? html`<${Button} variant="amber" busy=${busy} onClick=${() => submit(true)}>${t('overlapProceed')}<//>`
          : html`<${Button} icon=${forward ? 'send' : 'truck'} busy=${busy} disabled=${!forward && !f.driverId} onClick=${() => submit(false)}>${forward ? t('sendToSpc') : t('assign')}<//>`}`}>
    <div class="stack">
      ${forward ? html`<${Field} label=${t('adminRemarkLbl')} hint=${t('adminRemarkHint')}><textarea class="input" rows="3" value=${f.remark} onInput=${e => setF({ ...f, remark: e.target.value })} /><//>` : null}
      <div class="grid-2">
        <${Field} label=${forward ? t('proposeDriver') : t('driver')} required=${!forward}>
          <${Select} value=${f.driverId} onChange=${pickDriver} placeholder=${t('noneOption')} options=${driverOptions(d)} />
        <//>
        <${Field} label=${forward ? t('proposeVehicle') : t('vehicle')}>
          <${Select} value=${f.vehicleId} onChange=${v => setF({ ...f, vehicleId: v })} placeholder=${t('noneOption')} options=${vehicleOptions(d)} />
        <//>
      </div>
      <${Conflicts} list=${conflicts} checking=${checking} driverId=${f.driverId} />
      ${!forward ? html`<${Field} label=${t('comment') + ' (' + t('optional').toLowerCase() + ')'}><input class="input" value=${f.comment} onInput=${e => setF({ ...f, comment: e.target.value })} /><//>` : null}
      ${!forward ? html`<p class="xsmall muted">A task is created for the driver and the requester is emailed the driver and vehicle details.</p>` : null}
    </div>
  <//>`;
}

function RescheduleDialog({ r, role, onClose }) {
  const [dep, setDep] = useState(toLocalInput(r.departTs));
  const [ret, setRet] = useState(toLocalInput(r.returnTs));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async force => {
    if (!dep || !ret) return setErr(t('v_date'));
    if (new Date(ret) < new Date(dep)) return setErr(t('v_returnBeforeDeparture'));
    if (!reason.trim()) return setErr(t('provideReason'));
    setErr(''); setBusy(true);
    const res = await act('request.reschedule', { id: r.id, departTs: fromLocalInput(dep), returnTs: fromLocalInput(ret), comment: reason, force }, t('decisionRecorded'));
    setBusy(false);
    if (res.ok) onClose();
    else if (res.error && res.error.code === 'conflict') setConflicts(res.error.details || []);
  };
  return html`<${Modal} title=${role === 'spc' ? 'Approve with new dates' : t('reschedule')} sub=${r.ref} onClose=${onClose} size="sm"
      footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//>
        ${conflicts && conflicts.length ? html`<${Button} variant="amber" busy=${busy} onClick=${() => submit(true)}>${t('proceed')}<//>` : html`<${Button} icon="calendar" busy=${busy} onClick=${() => submit(false)}>${role === 'spc' ? t('approve') : t('reschedule')}<//>`}`}>
    <div class="stack">
      ${err ? html`<${Alert} tone="red">${err}<//>` : null}
      <p class="small muted">${t('originalDate')}: ${fmtShort(r.departTs)} → ${fmtShort(r.returnTs)}</p>
      <${Field} label=${t('departure')}><input class="input" type="datetime-local" value=${dep} onInput=${e => setDep(e.target.value)} /><//>
      <${Field} label=${t('expectedReturn')}><input class="input" type="datetime-local" value=${ret} onInput=${e => setRet(e.target.value)} /><//>
      <${Field} label=${t('reason')} required hint="Sent to the requester."><textarea class="input" rows="2" value=${reason} onInput=${e => setReason(e.target.value)} /><//>
      ${conflicts && conflicts.length ? html`<${Alert} tone="amber" title=${t('overlapWarn')}><ul class="plain">${conflicts.map(x => html`<li>${x}</li>`)}</ul><//>` : null}
    </div>
  <//>`;
}
