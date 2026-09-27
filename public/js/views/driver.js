import { html, useState, useEffect } from '../lib.js';
import { t } from '../i18n.js';
import { store, useStore, update, enqueue, flush, withPending, logout, toast, ask } from '../store.js';
import { Button, Field, Icon, Status, Badge, Alert, Modal, Empty, KV, LangToggle, FilePick, Progress,
  fmtDT, fmtTime, fmtDate, fmtShort, duration, num, money, kmFmt, expiryState, getPosition, mapUrl, coords, byId } from '../ui.js';
import { PasswordForm } from './landing.js';
import { initials } from './staff.js';

const NAV = [
  { id: 'home', icon: 'home', label: 'home' },
  { id: 'tasks', icon: 'clipboard', label: 'tasks' },
  { id: 'fuel', icon: 'fuel', label: 'fuel' },
  { id: 'vehicle', icon: 'car', label: 'myVehicle' },
  { id: 'history', icon: 'clock', label: 'history' },
];

// Highest odometer reading this device knows for a vehicle (server + pending).
function lastOdo(d, vehicleId) {
  let best = null;
  const take = x => { if (x != null && !isNaN(x) && (best == null || +x > best)) best = +x; };
  const v = byId(d.vehicles, vehicleId);
  if (v) take(v.odometer);
  d.trips.filter(x => x.vehicleId === vehicleId).forEach(x => { take(x.startOdo); take(x.endOdo); });
  d.fuel.filter(x => x.vehicleId === vehicleId).forEach(x => take(x.odometer));
  return best;
}

const endOfToday = () => { const x = new Date(); x.setHours(23, 59, 59, 999); return x; };

export function DriverApp() {
  const s = useStore();
  const d = withPending(s.data, s.queue);
  const page = NAV.some(n => n.id === s.route.page) ? s.route.page : 'home';
  const [modal, setModal] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(i); }, []);

  const me = d.driver;
  if (!me) return html`<div class="center-page"><div class="card narrow"><div class="card-bd"><${Alert} tone="red">Your account is not linked to a driver record. Contact the fleet office.<//><${Button} cls="mt" onClick=${logout}>${t('logout')}<//></div></div></div>`;

  const active = d.trips.find(x => x.status === 'inTransit');
  const open = m => setModal(m);
  const close = () => setModal(null);

  let content;
  if (page === 'tasks') content = html`<${TasksPage} d=${d} active=${active} open=${open} />`;
  else if (page === 'fuel') content = html`<${FuelPage} d=${d} />`;
  else if (page === 'vehicle') content = html`<${VehiclePage} d=${d} />`;
  else if (page === 'history') content = html`<${HistoryPage} d=${d} />`;
  else content = html`<${HomePage} d=${d} active=${active} open=${open} />`;

  return html`<div class="driver-app">
    <header class="drv-hd">
      <div class="row gap-sm"><img src="/logo.png" alt="" class="brand-logo sm" /><div><div class="brand-name sm">SPIN-KN Fleet</div><div class="muted xsmall">${t('driver')} · ${me.name}</div></div></div>
      <div class="row gap-xs">
        <${ConnBadge} />
        <button type="button" class="avatar-btn" onClick=${() => open({ kind: 'profile' })} aria-label=${t('profile')}>${initials(me.name)}</button>
      </div>
    </header>
    ${!s.online ? html`<div class="offline-banner"><${Icon} name="wifiOff" size=${16} />${t('offlineBanner')}</div>` : null}
    ${s.syncErrors.length ? html`<div class="drv-wrap"><${Alert} tone="red" icon="xCircle" title=${t('syncFailed')} action=${html`<${Button} size="sm" variant="ghost" onClick=${() => update({ syncErrors: [] })}>${t('dismiss')}<//>`}>
      <ul class="plain">${s.syncErrors.map(e => html`<li>${fmtShort(e.item && e.item.ts)} — ${e.error}</li>`)}</ul>
    <//></div>` : null}
    <main class="drv-wrap">${content}</main>
    <nav class="drv-nav">
      ${NAV.map(n => html`<a href=${'#/' + n.id} class=${page === n.id ? 'on' : ''}><${Icon} name=${n.icon} size=${20} /><span>${t(n.label)}</span></a>`)}
    </nav>
    ${modal && modal.kind === 'start' ? html`<${StartTripModal} d=${d} task=${modal.task} onClose=${close} />` : null}
    ${modal && modal.kind === 'stop' ? html`<${StopModal} trip=${modal.trip} onClose=${close} />` : null}
    ${modal && modal.kind === 'end' ? html`<${EndTripModal} d=${d} trip=${modal.trip} onClose=${close} />` : null}
    ${modal && modal.kind === 'profile' ? html`<${ProfileModal} me=${me} onClose=${close} />` : null}
  </div>`;
}

function ConnBadge() {
  const s = useStore();
  if (!s.online) return html`<span class="conn off"><${Icon} name="wifiOff" size=${14} />${t('offline')}${s.queue.length ? ' · ' + s.queue.length : ''}</span>`;
  if (s.queue.length) return html`<button type="button" class="conn pending" onClick=${flush}>${s.syncing ? html`<span class="spinner dark sm" />` : html`<${Icon} name="refresh" size=${14} />`}${s.queue.length} ${s.queue.length === 1 ? t('queuedOne') : t('queuedMany')}</button>`;
  return html`<span class="conn on"><${Icon} name="wifi" size=${14} />${t('online')}</span>`;
}

function feedback(okTitle, okBody) {
  if (navigator.onLine) toast(okTitle, 'success', okBody);
  else toast(t('savedOffline'), 'warn', t('savedOfflineBody'));
}

// ---------------------------------------------------------------- home

function HomePage({ d, active, open }) {
  const me = d.driver;
  const vehicle = byId(d.vehicles, me.vehicleId);
  const due = d.tasks.filter(x => x.status === 'scheduled' && new Date(x.scheduledTs) <= endOfToday()).sort((a, b) => a.scheduledTs < b.scheduledTs ? -1 : 1);
  const lic = expiryState(me.licenceExpiry, d.settings.expiryWarnDays);
  const alerts = [];
  if (lic.key === 'expired') alerts.push(html`<${Alert} tone="red" title=${t('notif_licence')}>${t('licenceExpiredOn')} ${fmtDate(me.licenceExpiry)}.<//>`);
  else if (lic.key === 'expiring') alerts.push(html`<${Alert} tone="amber" title=${t('notif_licence')}>${t('licenceExpiresOn')} ${fmtDate(me.licenceExpiry)} (${lic.days}d).<//>`);
  if (vehicle && vehicle.serviceState === 'due') alerts.push(html`<${Alert} tone="amber" icon="wrench" title=${t('maintDue')}>${t('vehicleServiceDue')} (${vehicle.reg}, ${num(vehicle.kmSinceService)} ${t('kmSince')}).<//>`);
  if (vehicle && vehicle.status === 'maintenance') alerts.push(html`<${Alert} tone="violet" icon="wrench">${vehicle.reg}: ${t('st_maintenance')}<//>`);

  return html`<div class="stack">
    <div><div class="muted small">${t('welcome')},</div><h1 class="drv-hello">${me.name.split(' ')[0]}</h1></div>
    ${alerts}
    ${active ? html`<${ActiveTrip} d=${d} trip=${active} open=${open} />`
      : vehicle ? html`<div class="card start-card"><div class="card-bd">
          <div class="row between"><div><div class="eyebrow">${t('assignedVehicle')}</div><div class="plate">${vehicle.reg}</div><div class="muted small">${vehicle.model}</div></div><${Status} status=${vehicle.status} /></div>
          <${Button} size="xl" icon="play" cls="btn-block mt" disabled=${vehicle.status === 'maintenance' || vehicle.status === 'outOfService'} onClick=${() => open({ kind: 'start' })}>${t('startTrip')}<//>
          <p class="xsmall muted center mt-xs">${t('autoLocTime')}</p>
        </div></div>`
      : html`<${Alert} tone="slate" icon="car" title=${t('noVehicle')}>${t('noVehicleBody')}<//>`}
    <div>
      <div class="row between mb-sm"><h3>${t('dueTasks')} <span class="muted">(${due.length})</span></h3><a href="#/tasks" class="link small">${t('viewTasks')}</a></div>
      ${due.length ? html`<div class="stack-sm">${due.map(x => html`<${TaskCard} d=${d} task=${x} active=${active} open=${open} />`)}</div>` : html`<p class="muted small">${t('noDueTasks')}</p>`}
    </div>
  </div>`;
}

function ActiveTrip({ d, trip, open }) {
  const v = byId(d.vehicles, trip.vehicleId);
  const task = byId(d.tasks, trip.taskId);
  const openStop = (trip.stops || []).find(x => !x.endTs);
  const resume = async () => {
    const pos = await getPosition(6000);
    enqueue('trip.resume', { tripId: trip.id, lat: pos.lat, lng: pos.lng });
    feedback(t('tripResumed'));
  };
  return html`<div class=${'card trip-card' + (trip.paused ? ' paused' : '')}><div class="card-bd">
    <div class="row between">
      <span class=${'live-pill' + (trip.paused ? ' stopped' : '')}><span class="pulse" />${trip.paused ? t('st_stopped') : t('tripInProgress')}</span>
      ${trip.pending ? html`<${Badge} tone="amber">${t('pendingBadge')}<//>` : null}
    </div>
    <div class="plate mt-sm">${v ? v.reg : ''}</div>
    ${task ? html`<div class="small"><b>${task.purpose}</b><div class="muted">${task.origin} → ${task.destination}</div></div>` : null}
    <div class="trip-stats">
      <div><span>${t('startTime')}</span><b>${fmtTime(trip.startTs)}</b></div>
      <div><span>${t('duration')}</span><b>${duration(trip.startTs)}</b></div>
      <div><span>${t('stops')}</span><b>${(trip.stops || []).length}</b></div>
    </div>
    ${openStop ? html`<p class="small muted">${t('stoppedSince')} ${fmtTime(openStop.startTs)}${openStop.note ? ' · ' + openStop.note : ''}</p>` : null}
    <div class="grid-2 mt-sm">
      ${trip.paused
        ? html`<${Button} size="lg" icon="play" onClick=${resume}>${t('resumeTrip')}<//>`
        : html`<${Button} size="lg" variant="secondary" icon="pause" onClick=${() => open({ kind: 'stop', trip })}>${t('logStop')}<//>`}
      <${Button} size="lg" variant="danger" icon="flag" onClick=${() => open({ kind: 'end', trip })}>${t('endTrip')}<//>
    </div>
  </div></div>`;
}

// ---------------------------------------------------------------- tasks

function TaskCard({ d, task, active, open }) {
  const req = task.requestId ? byId(d.requests, task.requestId) : null;
  const overdue = task.status === 'scheduled' && new Date(task.scheduledTs) < new Date();
  const ack = () => { enqueue('task.ack', { taskId: task.id }); feedback(t('taskAcknowledged')); };
  const tone = { high: 'red', medium: 'amber', low: 'slate' }[task.priority] || 'slate';
  return html`<div class="card task-card"><div class="card-bd">
    <div class="row between wrap gap-xs">
      <div class="row gap-xs"><${Badge} tone=${tone}>${t(task.priority || 'medium')}<//>${task.acknowledged && task.status === 'scheduled' ? html`<${Badge} tone="green">${t('acknowledged')}<//>` : null}</div>
      <${Status} status=${overdue ? 'due' : task.status} />
    </div>
    <div class="task-purpose">${task.purpose}</div>
    <div class="small muted"><${Icon} name="pin" size=${13} /> ${task.origin || '—'} → <b>${task.destination}</b></div>
    <div class="small muted"><${Icon} name="calendar" size=${13} /> ${fmtDT(task.scheduledTs)}</div>
    ${req ? html`<div class="req-box small">
      <div><span class="muted">${t('requestedBy')}:</span> <b>${req.staffName}</b>${req.staffPhone ? html` · <a href=${'tel:' + req.staffPhone.replace(/\s/g, '')}>${req.staffPhone}</a>` : null}</div>
      <div><span class="muted">${t('passengers')}:</span> ${req.passengers} · <span class="muted">${t('returnBy')}:</span> ${fmtShort(req.returnTs)} · ${req.ref}</div>
    </div>` : null}
    ${task.notes && !req ? html`<p class="small">${task.notes}</p>` : null}
    ${task.status === 'scheduled' ? html`<div class="row gap-sm mt-sm wrap">
      ${!task.acknowledged ? html`<${Button} variant="secondary" size="sm" icon="check" onClick=${ack}>${t('acknowledge')}<//>` : null}
      ${!active ? html`<${Button} size="sm" icon="play" onClick=${() => open({ kind: 'start', task })}>${t('initiate')}<//>` : null}
    </div>` : null}
  </div></div>`;
}

function TasksPage({ d, active, open }) {
  const eod = endOfToday();
  const sched = d.tasks.filter(x => x.status === 'scheduled').sort((a, b) => a.scheduledTs < b.scheduledTs ? -1 : 1);
  const due = sched.filter(x => new Date(x.scheduledTs) <= eod);
  const upcoming = sched.filter(x => new Date(x.scheduledTs) > eod);
  const running = d.tasks.filter(x => x.status === 'inProgress');
  const doneList = d.tasks.filter(x => x.status === 'completed').sort((a, b) => a.scheduledTs < b.scheduledTs ? 1 : -1).slice(0, 10);
  const section = (title, list) => list.length ? html`<div><h3 class="mb-sm">${title} <span class="muted">(${list.length})</span></h3><div class="stack-sm">${list.map(x => html`<${TaskCard} d=${d} task=${x} active=${active} open=${open} />`)}</div></div>` : null;
  if (!sched.length && !running.length && !doneList.length) return html`<${Empty} icon="clipboard" text=${t('noTasks')} />`;
  return html`<div class="stack">
    ${!active ? html`<${Button} variant="secondary" icon="play" cls="btn-block" onClick=${() => open({ kind: 'start' })} disabled=${!d.driver.vehicleId}>${t('startWithoutTask')}<//>` : null}
    ${section(t('st_inProgress'), running)}
    ${section(t('dueNow'), due)}
    ${section(t('upcoming'), upcoming)}
    ${section(t('completedTasks'), doneList)}
  </div>`;
}

// ---------------------------------------------------------------- trip modals

function useGps(timeout) {
  const [gps, setGps] = useState({ state: 'loading' });
  const run = async () => {
    setGps({ state: 'loading' });
    const p = await getPosition(timeout);
    setGps(p.error ? { state: 'fail', error: p.error } : { state: 'ok', ...p });
  };
  useEffect(() => { run(); }, []);
  return [gps, run];
}

function GpsLine({ gps, retry }) {
  if (gps.state === 'loading') return html`<div class="gps"><span class="spinner dark sm" /> ${t('captureGps')}</div>`;
  if (gps.state === 'ok') return html`<div class="gps ok"><${Icon} name="pin" size=${15} /> ${t('gpsCaptured')} · ${coords(gps.lat, gps.lng)}${gps.acc ? ` (±${gps.acc} m)` : ''}</div>`;
  return html`<div class="gps fail"><${Icon} name="alert" size=${15} /><div>${t('gpsUnavailable')}<div class="xsmall">${location.protocol !== 'https:' && location.hostname !== 'localhost' ? t('gpsSecureNote') : ''}</div></div><button type="button" class="link" onClick=${retry}>${t('retry')}</button></div>`;
}

function OdoField({ value, onInput, last, error, label }) {
  return html`<${Field} label=${label || t('odometerReading')} error=${error} hint=${last != null ? `${t('lastOdo')}: ${num(last)} km` : t('odoOptional')}>
    <input class="input input-lg" type="number" inputmode="numeric" min="0" value=${value} onInput=${e => onInput(e.target.value)} />
  <//>`;
}

function StartTripModal({ d, task, onClose }) {
  const me = d.driver;
  const vehicleId = (task && task.vehicleId) || me.vehicleId;
  const v = byId(d.vehicles, vehicleId);
  const last = lastOdo(d, vehicleId);
  const [gps, retry] = useGps(15000);
  const [odo, setOdo] = useState('');
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState('');
  const go = () => {
    const n = odo === '' ? null : Number(odo);
    if (n != null && (isNaN(n) || n < 0)) return setErr(t('v_positive'));
    if (n != null && last != null && n < last) return setErr(t('v_odoLow') + ` (${num(last)} km)`);
    enqueue('trip.start', { taskId: task ? task.id : null, vehicleId, odo: n, lat: gps.lat, lng: gps.lng, photo });
    feedback(task ? t('taskInitiated') : t('startedOk'), t('startedOkBody'));
    onClose();
  };
  return html`<${Modal} title=${t('confirmStart')} onClose=${onClose} footer=${html`
      <${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//>
      <${Button} icon="play" onClick=${go} disabled=${gps.state === 'loading'}>${t('startTrip')}<//>`}>
    <div class="stack">
      <div class="row between"><div><div class="eyebrow">${t('vehicle')}</div><div class="plate">${v ? v.reg : '—'}</div><div class="muted small">${v ? v.model : ''}</div></div></div>
      ${task ? html`<div class="req-box small"><b>${task.purpose}</b><div class="muted">${task.origin} → ${task.destination}</div></div>` : null}
      <${OdoField} value=${odo} onInput=${v2 => { setOdo(v2); setErr(''); }} last=${last} error=${err} />
      <${Field} label=${t('photoOptional')} hint=${t('odometerHint')}><${FilePick} value=${photo} onChange=${setPhoto} accept="image/*" capture="environment" icon="camera" label=${t('takePhoto')} opts=${{ maxDim: 1024, quality: 0.6 }} /><//>
      <${GpsLine} gps=${gps} retry=${retry} />
    </div>
  <//>`;
}

function StopModal({ trip, onClose }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const pos = await getPosition(6000);
    enqueue('trip.stop', { tripId: trip.id, note: note.trim(), lat: pos.lat, lng: pos.lng });
    feedback(t('stopLogged'));
    onClose();
  };
  return html`<${Modal} title=${t('logStop')} onClose=${onClose} size="sm" footer=${html`
      <${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//>
      <${Button} icon="pause" busy=${busy} onClick=${go}>${t('logStop')}<//>`}>
    <${Field} label=${t('stopReason')}><input class="input" maxlength="300" placeholder=${t('stopReasonPh')} value=${note} onInput=${e => setNote(e.target.value)} autofocus /><//>
    <p class="xsmall muted">${t('autoLocTime')}</p>
  <//>`;
}

function EndTripModal({ d, trip, onClose }) {
  const v = byId(d.vehicles, trip.vehicleId);
  const [gps, retry] = useGps(15000);
  const [odo, setOdo] = useState('');
  const [photo, setPhoto] = useState(null);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const start = trip.startOdo;
  const dist = odo !== '' && start != null ? Number(odo) - start : null;
  const go = () => {
    const n = odo === '' ? null : Number(odo);
    if (n != null && (isNaN(n) || n < 0)) return setErr(t('v_positive'));
    if (n != null && start != null && n < start) return setErr(t('endReadingLow'));
    enqueue('trip.end', { tripId: trip.id, odo: n, lat: gps.lat, lng: gps.lng, photo, notes: notes.trim() });
    feedback(t('endedOk'), t('endedOkBody'));
    onClose();
  };
  return html`<${Modal} title=${t('confirmEnd')} onClose=${onClose} footer=${html`
      <${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//>
      <${Button} variant="danger" icon="flag" onClick=${go} disabled=${gps.state === 'loading'}>${t('endTrip')}<//>`}>
    <div class="stack">
      <div class="trip-stats">
        <div><span>${t('vehicle')}</span><b>${v ? v.reg : '—'}</b></div>
        <div><span>${t('duration')}</span><b>${duration(trip.startTs)}</b></div>
        <div><span>${t('stops')}</span><b>${(trip.stops || []).length}</b></div>
      </div>
      <${OdoField} value=${odo} onInput=${x => { setOdo(x); setErr(''); }} last=${start} error=${err} />
      ${dist != null && dist >= 0 ? html`<p class="small"><b>${t('distance')}:</b> ${num(dist)} km</p>` : null}
      <${Field} label=${t('photoOptional')} hint=${t('odometerHint')}><${FilePick} value=${photo} onChange=${setPhoto} accept="image/*" capture="environment" icon="camera" label=${t('takePhoto')} opts=${{ maxDim: 1024, quality: 0.6 }} /><//>
      <${Field} label=${t('tripNotes')}><textarea class="input" rows="2" maxlength="1000" value=${notes} onInput=${e => setNotes(e.target.value)} /><//>
      <${GpsLine} gps=${gps} retry=${retry} />
    </div>
  <//>`;
}

// ---------------------------------------------------------------- fuel

function FuelPage({ d }) {
  const me = d.driver;
  const options = d.vehicles.filter(v => v.id === me.vehicleId || d.tasks.some(x => x.vehicleId === v.id && x.status !== 'cancelled'));
  const [f, setF] = useState({ vehicleId: me.vehicleId || (options[0] && options[0].id) || '', litres: '', cost: '', odometer: '', station: '', receipt: null });
  const [errs, setErrs] = useState({});
  const last = f.vehicleId ? lastOdo(d, f.vehicleId) : null;
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => {
    const e = {};
    if (!f.vehicleId) e.vehicleId = t('v_required');
    if (!(Number(f.litres) > 0)) e.litres = t('v_positive');
    if (f.cost === '' || Number(f.cost) < 0 || isNaN(Number(f.cost))) e.cost = t('v_positive');
    if (f.odometer !== '' && last != null && Number(f.odometer) < last) e.odometer = t('v_odoLow') + ` (${num(last)} km)`;
    setErrs(e);
    if (Object.keys(e).length) return;
    enqueue('fuel.add', { vehicleId: f.vehicleId, litres: Number(f.litres), cost: Number(f.cost), odometer: f.odometer === '' ? null : Number(f.odometer), station: f.station.trim(), receipt: f.receipt });
    feedback(t('fuelRecorded'));
    setF(x => ({ ...x, litres: '', cost: '', odometer: '', station: '', receipt: null }));
  };
  const list = d.fuel.slice(0, 20);
  const perL = Number(f.litres) > 0 && Number(f.cost) > 0 ? Number(f.cost) / Number(f.litres) : null;
  return html`<div class="stack">
    <div class="card"><div class="card-bd stack">
      <h3>${t('recordFuel')}</h3>
      ${!options.length ? html`<${Alert} tone="slate" icon="car">${t('noVehicleBody')}<//>` : html`
        ${options.length > 1 ? html`<${Field} label=${t('vehicle')} error=${errs.vehicleId}><select class="input" value=${f.vehicleId} onChange=${e => set('vehicleId', e.target.value)}>${options.map(v => html`<option value=${v.id}>${v.reg} — ${v.model}</option>`)}</select><//>`
          : html`<p class="small"><b>${options[0].reg}</b> · ${options[0].model}</p>`}
        <div class="grid-2">
          <${Field} label=${t('litres')} error=${errs.litres}><input class="input input-lg" type="number" inputmode="decimal" min="0" step="0.1" value=${f.litres} onInput=${e => set('litres', e.target.value)} /><//>
          <${Field} label=${t('cost')} error=${errs.cost} hint=${perL ? money(perL) + ' ' + t('perLitre') : null}><input class="input input-lg" type="number" inputmode="numeric" min="0" value=${f.cost} onInput=${e => set('cost', e.target.value)} /><//>
        </div>
        <${OdoField} value=${f.odometer} onInput=${x => set('odometer', x)} last=${last} error=${errs.odometer} />
        <${Field} label=${t('station')}><input class="input" maxlength="120" value=${f.station} onInput=${e => set('station', e.target.value)} /><//>
        <${Field} label=${t('receipt')}><${FilePick} value=${f.receipt} onChange=${v => set('receipt', v)} accept="image/*" capture="environment" icon="camera" label=${t('captureReceipt')} opts=${{ maxDim: 1200, quality: 0.6 }} /><//>
        <${Button} size="lg" icon="check" cls="btn-block" onClick=${save}>${t('recordFuel')}<//>`}
    </div></div>
    <div>
      <h3 class="mb-sm">${t('fuel')}</h3>
      ${list.length ? html`<div class="list-card">${list.map(x => {
        const v = byId(d.vehicles, x.vehicleId);
        return html`<div class="list-row"><div><b>${num(x.litres, 1)} L</b> · ${money(x.cost)}<div class="muted xsmall">${fmtDT(x.ts)} · ${v ? v.reg : ''}${x.odometer ? ' · ' + num(x.odometer) + ' km' : ''}${x.station ? ' · ' + x.station : ''}</div></div>${x.pending ? html`<${Badge} tone="amber">${t('pendingBadge')}<//>` : x.receiptId ? html`<a class="link small" href=${'/api/files/' + x.receiptId} target="_blank" rel="noopener">${t('viewReceipt')}</a>` : null}</div>`;
      })}</div>` : html`<p class="muted small">${t('empty_fuel')}</p>`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- vehicle & history

function VehiclePage({ d }) {
  const v = byId(d.vehicles, d.driver.vehicleId);
  if (!v) return html`<${Alert} tone="slate" icon="car" title=${t('noVehicle')}>${t('noVehicleBody')}<//>`;
  const interval = v.serviceIntervalKm || d.settings.serviceIntervalKm;
  const ins = expiryState(v.insuranceExpiry, d.settings.expiryWarnDays), rw = expiryState(v.roadworthinessExpiry, d.settings.expiryWarnDays);
  return html`<div class="stack">
    <div class="card"><div class="card-bd">
      <div class="row between"><div><div class="plate">${v.reg}</div><div class="muted">${v.model}</div></div><${Status} status=${v.status} /></div>
      <${KV} items=${[[t('assetId'), v.assetId], [t('colour'), v.colour], [t('engineNo'), v.engineNo], [t('chassisNo'), v.chassisNo], [t('odometerNow'), kmFmt(v.odometer)]]} />
    </div></div>
    <div class="card"><div class="card-bd stack-sm">
      <div class="row between"><h3>${t('serviceStatus')}</h3><${Status} status=${v.serviceState} /></div>
      <${Progress} value=${((v.kmSinceService || 0) / interval) * 100} tone=${v.serviceState === 'due' ? 'red' : v.serviceState === 'soon' ? 'amber' : 'green'} />
      <p class="small muted">${num(v.kmSinceService || 0)} / ${num(interval)} ${t('kmSince')}</p>
      <div class="row between small"><span>${t('insuranceExpiry')}</span><span>${fmtDate(v.insuranceExpiry)} ${v.insuranceExpiry ? html`<${Status} status=${ins.key} />` : null}</span></div>
      <div class="row between small"><span>${t('roadworthinessExpiry')}</span><span>${fmtDate(v.roadworthinessExpiry)} ${v.roadworthinessExpiry ? html`<${Status} status=${rw.key} />` : null}</span></div>
    </div></div>
  </div>`;
}

function HistoryPage({ d }) {
  const trips = d.trips;
  if (!trips.length) return html`<${Empty} icon="route" text=${t('noTripsYet')} />`;
  return html`<div class="stack-sm">
    ${trips.map(x => {
      const v = byId(d.vehicles, x.vehicleId);
      const task = byId(d.tasks, x.taskId);
      const dist = x.endOdo != null && x.startOdo != null ? x.endOdo - x.startOdo : null;
      return html`<div class="card"><div class="card-bd">
        <div class="row between wrap gap-xs"><b>${fmtDate(x.startTs)} · ${v ? v.reg : ''}</b>${x.pending ? html`<${Badge} tone="amber">${t('pendingBadge')}<//>` : html`<${Status} status=${x.status} />`}</div>
        ${task ? html`<div class="small">${task.purpose} → ${task.destination}</div>` : null}
        <div class="trip-stats small-stats">
          <div><span>${t('startTime')}</span><b>${fmtTime(x.startTs)}</b></div>
          <div><span>${t('endTime')}</span><b>${fmtTime(x.endTs)}</b></div>
          <div><span>${t('duration')}</span><b>${duration(x.startTs, x.endTs)}</b></div>
          <div><span>${t('distance')}</span><b>${dist == null ? '—' : num(dist) + ' km'}</b></div>
        </div>
        <div class="row gap-sm small wrap">
          ${mapUrl(x.startLat, x.startLng) ? html`<a class="link" target="_blank" rel="noopener" href=${mapUrl(x.startLat, x.startLng)}><${Icon} name="pin" size=${13} /> ${t('startLoc')}</a>` : null}
          ${mapUrl(x.endLat, x.endLng) ? html`<a class="link" target="_blank" rel="noopener" href=${mapUrl(x.endLat, x.endLng)}><${Icon} name="pin" size=${13} /> ${t('endLoc')}</a>` : null}
          ${(x.stops || []).length ? html`<span class="muted">${x.stops.length} ${t('stopsRecorded')}</span>` : null}
        </div>
      </div></div>`;
    })}
  </div>`;
}

function ProfileModal({ me, onClose }) {
  const s = useStore();
  const [pw, setPw] = useState(false);
  const lic = expiryState(me.licenceExpiry, s.data.settings.expiryWarnDays);
  return html`<${Modal} title=${t('profile')} onClose=${onClose}>
    <div class="stack">
      <div class="row gap-sm"><span class="avatar lg">${initials(me.name)}</span><div><b>${me.name}</b><div class="muted small">${me.email}</div></div></div>
      <${KV} items=${[[t('driverId'), me.driverNo], [t('phone'), me.phone], [t('licenceExpiry'), html`${fmtDate(me.licenceExpiry)} ${me.licenceExpiry ? html`<${Status} status=${lic.key} />` : ''}`], [t('contractStatus'), html`<${Status} status=${me.contract} />`]]} />
      <div class="row between"><span>${t('language')}</span><${LangToggle} /></div>
      <div class="row between"><span>${t('lastSync')}</span><span class="small muted">${s.lastSync ? fmtShort(s.lastSync.toISOString()) : t('neverSynced')}</span></div>
      ${pw ? html`<div class="card"><div class="card-bd"><${PasswordForm} onDone=${() => setPw(false)} /></div></div>` : html`<${Button} variant="secondary" icon="key" onClick=${() => setPw(true)}>${t('changePassword')}<//>`}
      <${Button} variant="ghost-danger" icon="logout" onClick=${signOut}>${t('logout')}<//>
    </div>
  <//>`;
}

// Queued actions stay on this device (stored per user) and upload after the
// next sign-in, but signing out with unsent work deserves a warning.
async function signOut() {
  if (store.queue.length) {
    const ok = await ask({ title: t('logout') + '?', body: `${store.queue.length} ${store.queue.length === 1 ? t('queuedOne') : t('queuedMany')}. ${t('uploadsWhenOnline')}.`, confirmLabel: t('logout'), tone: 'danger' });
    if (!ok) return;
  }
  logout();
}
