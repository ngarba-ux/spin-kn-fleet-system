import { html, useState } from '../lib.js';
import { t } from '../i18n.js';
import { act, ask, toast } from '../store.js';
import { Button, Field, Icon, Status, Badge, Alert, Modal, Empty, KV, Tabs, SearchBox, Select, Card, Progress,
  fmtDT, fmtDate, fmtShort, num, money, kmFmt, duration, expiryState, toLocalInput, fromLocalInput, byId, sortBy, copyText, bind } from '../ui.js';
import { PageHead } from './office.js';

// Shows a one-time password after creating an account or resetting it.
export function TempPasswordModal({ info, onClose }) {
  const text = `SPIN-KN Fleet sign-in\nAddress: ${location.origin}\nEmail: ${info.email}\nTemporary password: ${info.tempPassword}`;
  return html`<${Modal} title="Account ready" size="sm" onClose=${onClose} footer=${html`<${Button} variant="secondary" icon="copy" onClick=${async () => { if (await copyText(text)) toast(t('copied')); }}>Copy details<//><${Button} onClick=${onClose}>${t('done')}<//>`}>
    <p class="small">Give these sign-in details to the person. They will be asked to choose their own password the first time they sign in.</p>
    <div class="cred-box"><div><span>Email</span><b>${info.email}</b></div><div><span>Temporary password</span><b class="mono">${info.tempPassword}</b></div></div>
    <p class="xsmall muted">This password is shown only once. You can reset it later if needed.</p>
  <//>`;
}

const expiryBadge = (date, warn) => {
  if (!date) return html`<span class="muted">—</span>`;
  const e = expiryState(date, warn);
  return html`<span class="nowrap">${fmtDate(date)} ${e.key !== 'valid' ? html`<${Status} status=${e.key} />` : null}</span>`;
};

// ================================================================ vehicles

export function VehiclesPage({ d, role }) {
  const admin = role === 'admin';
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const warn = d.settings.expiryWarnDays;
  const tabs = [
    { value: 'all', label: 'All', fn: () => true }, { value: 'available', label: t('st_available'), fn: v => v.status === 'available' || v.status === 'assigned' },
    { value: 'inTransit', label: t('st_inTransit'), fn: v => v.status === 'inTransit' }, { value: 'maintenance', label: t('maintenance'), fn: v => v.status === 'maintenance' || v.status === 'outOfService' },
    { value: 'attention', label: 'Needs attention', fn: v => v.serviceState !== 'ok' || expiryState(v.insuranceExpiry, warn).key !== 'valid' && v.insuranceExpiry || expiryState(v.roadworthinessExpiry, warn).key !== 'valid' && v.roadworthinessExpiry },
  ];
  const g = tabs.find(x => x.value === tab);
  const rows = sortBy(d.vehicles.filter(g.fn).filter(v => !q || [v.reg, v.model, v.assetId].join(' ').toLowerCase().includes(q.toLowerCase())), v => v.reg);
  const current = modal && modal.id ? byId(d.vehicles, modal.id) : null;

  return html`<div class="stack">
    <${PageHead} title=${t('vehicles')} sub=${`${d.vehicles.length} vehicles · service interval ${num(d.settings.serviceIntervalKm)} km`}
      actions=${admin ? html`<${Button} icon="plus" onClick=${() => setModal({ kind: 'edit' })}>Add vehicle<//>` : null} />
    <div class="toolbar"><${Tabs} value=${tab} onChange=${setTab} items=${tabs.map(x => ({ value: x.value, label: x.label, count: d.vehicles.filter(x.fn).length }))} /><${SearchBox} value=${q} onInput=${setQ} /></div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('vehicle')}</th><th>${t('driver')}</th><th>${t('status')}</th><th class="num">${t('odometerCol')}</th><th>${t('serviceStatus')}</th><th>Insurance</th><th>Roadworthy</th>${admin ? html`<th></th>` : null}</tr></thead>
        <tbody>${rows.map(v => {
          const drv = byId(d.drivers, v.driverId);
          const interval = v.serviceIntervalKm || d.settings.serviceIntervalKm;
          return html`<tr class="clickable" onClick=${() => setModal({ kind: 'view', id: v.id })}>
            <td class="nowrap"><b>${v.reg}</b><div class="xsmall muted">${v.model}</div></td>
            <td>${drv ? drv.name : html`<span class="muted">${t('unassigned')}</span>`}</td>
            <td><${Status} status=${v.status} /></td>
            <td class="num">${v.odometer != null ? num(v.odometer) : '—'}</td>
            <td style="min-width:130px"><${Progress} value=${((v.kmSinceService || 0) / interval) * 100} tone=${v.serviceState === 'due' ? 'red' : v.serviceState === 'soon' ? 'amber' : 'green'} /><div class="xsmall muted">${num(v.kmSinceService || 0)} / ${num(interval)} km</div></td>
            <td>${expiryBadge(v.insuranceExpiry, warn)}</td>
            <td>${expiryBadge(v.roadworthinessExpiry, warn)}</td>
            ${admin ? html`<td class="actions" onClick=${e => e.stopPropagation()}>
              <${Button} size="sm" variant="ghost" icon="edit" onClick=${() => setModal({ kind: 'edit', id: v.id })} title=${t('edit')} />
              <${Button} size="sm" variant="ghost" icon="wrench" onClick=${() => setModal({ kind: 'service', id: v.id })} title=${t('markServiced')} />
              <${Button} size="sm" variant="ghost" icon="sliders" onClick=${() => setModal({ kind: 'condition', id: v.id })} title=${t('changeStatus')} />
            </td>` : null}
          </tr>`;
        })}</tbody></table></div>` : html`<${Empty} icon="car" text=${q ? t('empty_search') : 'No vehicles.'} />`}
    <//>
    ${modal && modal.kind === 'edit' ? html`<${VehicleForm} d=${d} v=${current} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.kind === 'service' ? html`<${ServiceForm} v=${current} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.kind === 'condition' ? html`<${ConditionForm} v=${current} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.kind === 'view' && current ? html`<${VehicleDetail} d=${d} v=${current} admin=${admin} onClose=${() => setModal(null)} onAction=${k => setModal({ kind: k, id: current.id })} />` : null}
  </div>`;
}

function VehicleDetail({ d, v, admin, onClose, onAction }) {
  const drv = byId(d.drivers, v.driverId);
  const trips = d.trips.filter(x => x.vehicleId === v.id).slice(0, 8);
  const fuel = d.fuel.filter(x => x.vehicleId === v.id).slice(0, 6);
  const svc = (d.maintenance || []).filter(x => x.vehicleId === v.id).slice(0, 6);
  return html`<${Modal} wide title=${html`${v.reg} <${Status} status=${v.status} />`} sub=${v.model} onClose=${onClose}
      footer=${admin ? html`<${Button} variant="ghost" icon="sliders" onClick=${() => onAction('condition')}>${t('changeStatus')}<//><${Button} variant="secondary" icon="wrench" onClick=${() => onAction('service')}>${t('markServiced')}<//><${Button} icon="edit" onClick=${() => onAction('edit')}>${t('edit')}<//>` : null}>
    <div class="detail-grid">
      <div class="stack">
        <${KV} items=${[[t('assetId'), v.assetId], [t('colour'), v.colour], [t('engineNo'), v.engineNo], [t('chassisNo'), v.chassisNo], [t('assignedDriver'), drv ? drv.name : t('unassigned')],
          [t('odometerCol'), kmFmt(v.odometer)], ['Last service', v.lastServiceOdo != null ? `${num(v.lastServiceOdo)} km${v.lastServiceDate ? ' · ' + fmtDate(v.lastServiceDate) : ''}` : '—'],
          [t('insuranceExpiry'), expiryBadge(v.insuranceExpiry, d.settings.expiryWarnDays)], [t('roadworthinessExpiry'), expiryBadge(v.roadworthinessExpiry, d.settings.expiryWarnDays)], ['Notes', v.notes]]} />
      </div>
      <div class="stack">
        <section><h4 class="sec-title">Recent trips</h4>${trips.length ? html`<ul class="plain small">${trips.map(x => html`<li class="row between"><span>${fmtShort(x.startTs)} · ${(byId(d.drivers, x.driverId) || {}).name || ''}</span><span class="muted">${x.endOdo != null && x.startOdo != null ? num(x.endOdo - x.startOdo) + ' km' : x.status === 'inTransit' ? t('st_inTransit') : ''}</span></li>`)}</ul>` : html`<p class="small muted">${t('empty_trips')}</p>`}</section>
        <section><h4 class="sec-title">${t('fuel')}</h4>${fuel.length ? html`<ul class="plain small">${fuel.map(x => html`<li class="row between"><span>${fmtShort(x.ts)} · ${num(x.litres, 1)} L</span><span>${money(x.cost)}</span></li>`)}</ul>` : html`<p class="small muted">${t('empty_fuel')}</p>`}</section>
        <section><h4 class="sec-title">Service history</h4>${svc.length ? html`<ul class="plain small">${svc.map(x => html`<li class="row between"><span>${fmtDate(x.ts)}${x.notes ? ' · ' + x.notes : ''}</span><span class="muted">${x.odometer != null ? num(x.odometer) + ' km' : ''}${x.cost ? ' · ' + money(x.cost) : ''}</span></li>`)}</ul>` : html`<p class="small muted">No services recorded.</p>`}</section>
      </div>
    </div>
  <//>`;
}

function VehicleForm({ d, v, onClose }) {
  const isNew = !v;
  const [f, setF] = useState(() => v ? { ...v, driverId: v.driverId || '' } : { reg: '', model: '', assetId: '', colour: '', engineNo: '', chassisNo: '', driverId: '', initialOdo: '', lastServiceOdo: '', serviceIntervalKm: '', insuranceExpiry: '', roadworthinessExpiry: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const b = k => bind(f, setF, k);
  const save = async () => {
    setBusy(true);
    // '' (not null) means "no driver", so the server unassigns rather than ignoring the field.
    const data = { ...f, id: v ? v.id : null, driverId: f.driverId || '' };
    const r = await act('vehicle.save', data, t('saved'));
    setBusy(false);
    if (r.ok) onClose();
  };
  return html`<${Modal} title=${isNew ? 'Add vehicle' : `${t('edit')} ${v.reg}`} onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${t('save')}<//>`}>
    <div class="stack">
      <div class="grid-2">
        <${Field} label=${t('registration')} required><input class="input" ...${b('reg')} /><//>
        <${Field} label=${t('model')} required><input class="input" placeholder="Toyota Hilux 2.4" ...${b('model')} /><//>
        <${Field} label=${t('assetId')}><input class="input" ...${b('assetId')} /><//>
        <${Field} label=${t('colour')}><input class="input" ...${b('colour')} /><//>
        <${Field} label=${t('engineNo')}><input class="input" ...${b('engineNo')} /><//>
        <${Field} label=${t('chassisNo')}><input class="input" ...${b('chassisNo')} /><//>
      </div>
      <${Field} label=${t('assignedDriver')} hint="A driver can have one vehicle; assigning here moves it from any previous driver.">
        <${Select} value=${f.driverId} onChange=${x => setF({ ...f, driverId: x || '' })} placeholder=${t('noneOption')} options=${d.drivers.filter(x => x.account === 'active').map(x => ({ value: x.id, label: x.name + (x.vehicleId && x.vehicleId !== (v && v.id) ? ` (has ${(byId(d.vehicles, x.vehicleId) || {}).reg || 'a vehicle'})` : '') }))} />
      <//>
      <div class="grid-3">
        ${isNew ? html`<${Field} label="Current odometer (km)"><input class="input" type="number" min="0" ...${b('initialOdo')} /><//>` : null}
        <${Field} label="Odometer at last service"><input class="input" type="number" min="0" ...${b('lastServiceOdo')} /><//>
        <${Field} label="Service interval (km)" hint=${`Blank = default ${num(d.settings.serviceIntervalKm)}`}><input class="input" type="number" min="0" ...${b('serviceIntervalKm')} /><//>
      </div>
      <div class="grid-2">
        <${Field} label=${t('insuranceExpiry')}><input class="input" type="date" ...${b('insuranceExpiry')} /><//>
        <${Field} label=${t('roadworthinessExpiry')}><input class="input" type="date" ...${b('roadworthinessExpiry')} /><//>
      </div>
      <${Field} label="Notes"><textarea class="input" rows="2" ...${b('notes')} /><//>
    </div>
  <//>`;
}

function ServiceForm({ v, onClose }) {
  const [f, setF] = useState({ odometer: v.odometer != null ? String(v.odometer) : '', cost: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act('vehicle.serviced', { id: v.id, ...f }, t('maintDone'));
    setBusy(false);
    if (r.ok) onClose();
  };
  return html`<${Modal} title=${`${t('markServiced')} — ${v.reg}`} size="sm" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} icon="wrench" busy=${busy} onClick=${save}>${t('markServiced')}<//>`}>
    <div class="stack">
      <${Field} label=${t('odometerReading')} hint=${v.odometer != null ? `${t('lastReading')}: ${num(v.odometer)} km` : null}><input class="input" type="number" min="0" ...${bind(f, setF, 'odometer')} /><//>
      <${Field} label=${t('cost') + ' (' + t('optional').toLowerCase() + ')'}><input class="input" type="number" min="0" ...${bind(f, setF, 'cost')} /><//>
      <${Field} label="Work done"><textarea class="input" rows="2" placeholder="Oil & filter change, brake pads…" ...${bind(f, setF, 'notes')} /><//>
    </div>
  <//>`;
}

function ConditionForm({ v, onClose }) {
  const [c, setC] = useState(v.condition || 'ok');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); const r = await act('vehicle.setCondition', { id: v.id, condition: c }, t('saved')); setBusy(false); if (r.ok) onClose(); };
  const opt = (value, label, sub) => html`<label class=${'choice' + (c === value ? ' on' : '')}><input type="radio" name="cond" checked=${c === value} onChange=${() => setC(value)} /><div><b>${label}</b><div class="xsmall muted">${sub}</div></div></label>`;
  return html`<${Modal} title=${`${t('changeStatus')} — ${v.reg}`} size="sm" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${t('save')}<//>`}>
    <div class="stack-sm">
      ${opt('ok', 'In service', 'Available for trips (shown as available / assigned / in transit automatically).')}
      ${opt('maintenance', t('st_maintenance'), 'Temporarily off the road; drivers cannot start trips.')}
      ${opt('outOfService', t('st_outOfService'), 'Grounded or retired.')}
    </div>
  <//>`;
}

// ================================================================ drivers

export function DriversPage({ d, role }) {
  const admin = role === 'admin';
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [cred, setCred] = useState(null);
  const warn = d.settings.expiryWarnDays;
  const since = Date.now() - 30 * 86400e3;
  const rows = sortBy(d.drivers.filter(x => !q || [x.name, x.email, x.driverNo, x.phone].join(' ').toLowerCase().includes(q.toLowerCase())), x => (x.account === 'active' ? '0' : '1') + x.name);
  const current = modal && modal.id ? byId(d.drivers, modal.id) : null;

  const toggle = async x => {
    const off = x.account === 'active';
    const ok = await ask({ title: `${off ? t('deactivate') : t('activate')} ${x.name}?`, body: off ? 'They will be signed out and cannot sign in until reactivated.' : 'They will be able to sign in again.', confirmLabel: off ? t('deactivate') : t('activate'), tone: off ? 'danger' : undefined });
    if (ok) act('driver.toggle', { id: x.id }, t('saved'));
  };
  const reset = async x => {
    const ok = await ask({ title: `Reset password for ${x.name}?`, body: 'A new temporary password will be generated. Their current sessions will end.', confirmLabel: 'Reset password' });
    if (!ok) return;
    const r = await act('user.resetPassword', { id: x.userId });
    if (r.ok) setCred(r.result);
  };

  return html`<div class="stack">
    <${PageHead} title=${t('drivers')} sub=${`${d.drivers.filter(x => x.account === 'active').length} active of ${d.drivers.length}`}
      actions=${admin ? html`<${Button} icon="plus" onClick=${() => setModal({ kind: 'edit' })}>Add driver<//>` : null} />
    <div class="toolbar"><div /><${SearchBox} value=${q} onInput=${setQ} /></div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('fullName')}</th><th>${t('phone')}</th><th>${t('assignedVehicle')}</th><th>${t('licenceExpiry')}</th><th>${t('contract')}</th><th>${t('accountStatus')}</th><th class="num">Trips (30d)</th>${admin ? html`<th></th>` : null}</tr></thead>
        <tbody>${rows.map(x => {
          const v = byId(d.vehicles, x.vehicleId);
          const trips = d.trips.filter(tr => tr.driverId === x.id && new Date(tr.startTs) > since).length;
          const active = d.trips.some(tr => tr.driverId === x.id && tr.status === 'inTransit');
          return html`<tr class=${x.account !== 'active' ? 'dim' : ''}>
            <td><b>${x.name}</b>${active ? html` <span class="live-dot" title=${t('tripInProgress')} />` : null}<div class="xsmall muted">${x.driverNo || ''}${x.email ? ' · ' + x.email : ''}</div></td>
            <td class="nowrap">${x.phone || '—'}</td>
            <td>${v ? html`${v.reg}<div class="xsmall muted">${v.model}</div>` : html`<span class="muted">${t('none')}</span>`}</td>
            <td>${expiryBadge(x.licenceExpiry, warn)}</td>
            <td><${Status} status=${x.contract} /></td>
            <td><${Status} status=${x.account} /></td>
            <td class="num">${trips}</td>
            ${admin ? html`<td class="actions">
              <${Button} size="sm" variant="ghost" icon="edit" title=${t('edit')} onClick=${() => setModal({ kind: 'edit', id: x.id })} />
              <${Button} size="sm" variant="ghost" icon="key" title="Reset password" onClick=${() => reset(x)} />
              <${Button} size="sm" variant="ghost" icon=${x.account === 'active' ? 'ban' : 'checkCircle'} title=${x.account === 'active' ? t('deactivate') : t('activate')} onClick=${() => toggle(x)} />
            </td>` : null}
          </tr>`;
        })}</tbody></table></div>` : html`<${Empty} icon="users" text=${t('empty_search')} />`}
    <//>
    ${modal ? html`<${DriverForm} d=${d} x=${current} onClose=${() => setModal(null)} onCreated=${setCred} />` : null}
    ${cred ? html`<${TempPasswordModal} info=${cred} onClose=${() => setCred(null)} />` : null}
  </div>`;
}

function DriverForm({ d, x, onClose, onCreated }) {
  const [f, setF] = useState(() => x ? { ...x, vehicleId: x.vehicleId || '' } : { name: '', email: '', phone: '', driverNo: `DRV-${String(d.drivers.length + 1).padStart(3, '0')}`, licenceNo: '', licenceExpiry: '', contract: 'active', vehicleId: '' });
  const [busy, setBusy] = useState(false);
  const b = k => bind(f, setF, k);
  const save = async () => {
    setBusy(true);
    const r = await act('driver.save', { ...f, id: x ? x.id : null, vehicleId: f.vehicleId || null }, t('saved'));
    setBusy(false);
    if (r.ok) { onClose(); if (r.result) onCreated(r.result); }
  };
  return html`<${Modal} title=${x ? `${t('edit')} ${x.name}` : 'Add driver'} onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${t('save')}<//>`}>
    <div class="stack">
      <div class="grid-2">
        <${Field} label=${t('fullName')} required><input class="input" ...${b('name')} /><//>
        <${Field} label="Email / username" required hint=${x ? null : 'Used to sign in to the driver app.'}><input class="input" type="email" ...${b('email')} /><//>
        <${Field} label=${t('phone')}><input class="input" type="tel" ...${b('phone')} /><//>
        <${Field} label=${t('driverId')}><input class="input" ...${b('driverNo')} /><//>
        <${Field} label="Licence number"><input class="input" ...${b('licenceNo')} /><//>
        <${Field} label=${t('licenceExpiry')}><input class="input" type="date" ...${b('licenceExpiry')} /><//>
        <${Field} label=${t('contractStatus')}><${Select} value=${f.contract} onChange=${v => setF({ ...f, contract: v || 'active' })} options=${[{ value: 'active', label: t('st_active') }, { value: 'expired', label: t('st_expired') }, { value: 'terminated', label: t('st_terminated') }]} /><//>
        <${Field} label=${t('assignedVehicle')}><${Select} value=${f.vehicleId} onChange=${v => setF({ ...f, vehicleId: v || '' })} placeholder=${t('noneOption')} options=${d.vehicles.map(v => ({ value: v.id, label: v.reg + ' — ' + v.model + (v.driverId && v.driverId !== (x && x.id) ? ` (${(byId(d.drivers, v.driverId) || {}).name})` : '') }))} /><//>
      </div>
      ${!x ? html`<p class="xsmall muted">A temporary password is generated and shown once after saving.</p>` : null}
    </div>
  <//>`;
}

// ================================================================ tasks

export function TasksPage({ d }) {
  const [tab, setTab] = useState('open');
  const [driver, setDriver] = useState('');
  const [modal, setModal] = useState(null);
  const tabs = [
    { value: 'open', label: 'Open', fn: x => x.status === 'scheduled' || x.status === 'inProgress' },
    { value: 'completed', label: t('st_completed'), fn: x => x.status === 'completed' },
    { value: 'cancelled', label: t('st_cancelled'), fn: x => x.status === 'cancelled' },
    { value: 'all', label: 'All', fn: () => true },
  ];
  const g = tabs.find(x => x.value === tab);
  const rows = sortBy(d.tasks.filter(g.fn).filter(x => !driver || x.driverId === driver), x => x.scheduledTs, tab !== 'open');
  const cancel = async x => {
    const ok = await ask({ title: t('cancelTaskQ'), body: t('cancelTaskBody'), confirmLabel: t('cancelTask'), cancelLabel: t('keepTask'), tone: 'danger' });
    if (ok) act('task.cancel', { id: x.id }, t('taskCancelled'));
  };
  return html`<div class="stack">
    <${PageHead} title=${t('tasks')} sub="Jobs assigned to drivers. Trip-request dispatches appear here automatically." actions=${html`<${Button} icon="plus" onClick=${() => setModal({})}>${t('assignTask')}<//>`} />
    <div class="toolbar">
      <${Tabs} value=${tab} onChange=${setTab} items=${tabs.map(x => ({ value: x.value, label: x.label, count: d.tasks.filter(x.fn).length }))} />
      <${Select} value=${driver} onChange=${v => setDriver(v || '')} placeholder=${t('allDrivers')} options=${d.drivers.map(x => ({ value: x.id, label: x.name }))} />
    </div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('scheduledFor')}</th><th>${t('driver')}</th><th>${t('taskPurpose')}</th><th>${t('origin')} → ${t('destination')}</th><th>${t('priority')}</th><th>${t('status')}</th><th></th></tr></thead>
        <tbody>${rows.map(x => {
          const drv = byId(d.drivers, x.driverId), v = byId(d.vehicles, x.vehicleId), req = x.requestId ? byId(d.requests, x.requestId) : null;
          const overdue = x.status === 'scheduled' && new Date(x.scheduledTs) < Date.now();
          return html`<tr>
            <td class="nowrap">${fmtShort(x.scheduledTs)}${overdue ? html`<div><${Badge} tone="red">Overdue<//></div>` : null}</td>
            <td>${drv ? drv.name : '—'}<div class="xsmall muted">${v ? v.reg : ''}</div></td>
            <td>${x.purpose}${req ? html`<div class="xsmall"><a class="link" href=${'#/requests/' + req.id}>${req.ref}</a></div>` : null}</td>
            <td class="small">${x.origin || '—'} → ${x.destination}</td>
            <td><${Badge} tone=${{ high: 'red', medium: 'amber', low: 'slate' }[x.priority] || 'slate'}>${t(x.priority || 'medium')}<//></td>
            <td><${Status} status=${x.status} />${x.status === 'scheduled' ? html`<div class="xsmall ${x.acknowledged ? 'tone-text-green' : 'muted'}">${x.acknowledged ? t('acknowledged') : 'Not acknowledged'}</div>` : null}</td>
            <td class="actions">${x.status === 'scheduled' && !x.requestId ? html`
              <${Button} size="sm" variant="ghost" icon="edit" title=${t('edit')} onClick=${() => setModal({ task: x })} />
              <${Button} size="sm" variant="ghost" icon="ban" title=${t('cancelTask')} onClick=${() => cancel(x)} />` : null}</td>
          </tr>`;
        })}</tbody></table></div>` : html`<${Empty} icon="clipboard" text=${t('noTasks')} />`}
    <//>
    ${modal ? html`<${TaskForm} d=${d} task=${modal.task} onClose=${() => setModal(null)} />` : null}
  </div>`;
}

function TaskForm({ d, task, onClose }) {
  const [f, setF] = useState(() => task ? { ...task, scheduledLocal: toLocalInput(task.scheduledTs) } : { driverId: '', vehicleId: '', purpose: '', origin: d.settings.defaultOrigin, destination: '', scheduledLocal: '', priority: 'medium', notes: '' });
  const [busy, setBusy] = useState(false);
  const b = k => bind(f, setF, k);
  const pickDriver = id => { const drv = byId(d.drivers, id); setF(x => ({ ...x, driverId: id || '', vehicleId: drv && drv.vehicleId ? drv.vehicleId : x.vehicleId })); };
  const save = async () => {
    setBusy(true);
    const r = await act('task.save', { id: task ? task.id : null, driverId: f.driverId, vehicleId: f.vehicleId || null, purpose: f.purpose, origin: f.origin, destination: f.destination, scheduledTs: fromLocalInput(f.scheduledLocal), priority: f.priority, notes: f.notes }, t('saved'));
    setBusy(false);
    if (r.ok) onClose();
  };
  return html`<${Modal} title=${task ? t('taskDetails') : t('newTask')} onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${task ? t('save') : t('assignTask')}<//>`}>
    <div class="stack">
      <div class="grid-2">
        <${Field} label=${t('driver')} required><${Select} value=${f.driverId} onChange=${pickDriver} placeholder=${t('selectPlaceholder')} options=${d.drivers.filter(x => x.account === 'active').map(x => ({ value: x.id, label: x.name }))} /><//>
        <${Field} label=${t('vehicle')}><${Select} value=${f.vehicleId} onChange=${v => setF({ ...f, vehicleId: v || '' })} placeholder=${t('noneOption')} options=${d.vehicles.map(v => ({ value: v.id, label: v.reg + ' — ' + v.model }))} /><//>
      </div>
      <${Field} label=${t('taskPurpose')} required><input class="input" ...${b('purpose')} /><//>
      <div class="grid-2">
        <${Field} label=${t('origin')}><input class="input" ...${b('origin')} /><//>
        <${Field} label=${t('destination')} required><input class="input" ...${b('destination')} /><//>
        <${Field} label=${t('scheduledFor')} required><input class="input" type="datetime-local" ...${b('scheduledLocal')} /><//>
        <${Field} label=${t('priority')}><${Select} value=${f.priority} onChange=${v => setF({ ...f, priority: v || 'medium' })} options=${[{ value: 'high', label: t('high') }, { value: 'medium', label: t('medium') }, { value: 'low', label: t('low') }]} /><//>
      </div>
      <${Field} label="Notes for the driver"><textarea class="input" rows="2" ...${b('notes')} /><//>
    </div>
  <//>`;
}
