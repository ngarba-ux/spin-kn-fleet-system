import { html, useState } from '../lib.js';
import { t } from '../i18n.js';
import { act } from '../store.js';
import { Button, Field, Icon, Status, Badge, Modal, Empty, KV, Tabs, SearchBox, Select, Card, Stat,
  fmtDT, fmtShort, fmtDate, num, money, duration, mapUrl, coords, byId, sortBy, bind, toLocalInput, fromLocalInput } from '../ui.js';
import { PageHead } from './office.js';

const dist = x => x.endOdo != null && x.startOdo != null ? x.endOdo - x.startOdo : null;

const MapLink = ({ lat, lng, label }) => {
  const u = mapUrl(lat, lng);
  return u ? html`<a class="link" href=${u} target="_blank" rel="noopener"><${Icon} name="pin" size=${13} /> ${label || coords(lat, lng)}</a>` : html`<span class="muted">—</span>`;
};

// ================================================================ trips

export function TripsPage({ d, id, role }) {
  const [tab, setTab] = useState('all');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const tabs = [
    { value: 'all', label: 'All', fn: () => true },
    { value: 'active', label: t('st_inTransit'), fn: x => x.status === 'inTransit' },
    { value: 'completed', label: t('st_completed'), fn: x => x.status === 'completed' },
  ];
  const g = tabs.find(x => x.value === tab);
  const rows = sortBy(d.trips.filter(g.fn).filter(x => (!vehicle || x.vehicleId === vehicle) && (!driver || x.driverId === driver)), x => x.startTs, true);
  const open = id ? byId(d.trips, id) : null;
  const total = rows.reduce((s, x) => s + (dist(x) || 0), 0);

  return html`<div class="stack">
    <${PageHead} title=${t('trips')} sub=${`${rows.length} trip(s) · ${num(total)} km recorded`} />
    <div class="toolbar">
      <${Tabs} value=${tab} onChange=${setTab} items=${tabs.map(x => ({ value: x.value, label: x.label, count: d.trips.filter(x.fn).length }))} />
      <div class="row gap-sm wrap">
        <${Select} value=${vehicle} onChange=${v => setVehicle(v || '')} placeholder=${t('allVehicles')} options=${d.vehicles.map(v => ({ value: v.id, label: v.reg }))} />
        <${Select} value=${driver} onChange=${v => setDriver(v || '')} placeholder=${t('allDrivers')} options=${d.drivers.map(x => ({ value: x.id, label: x.name }))} />
      </div>
    </div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('vehicle')}</th><th>${t('driver')}</th><th>${t('linkedTask')}</th><th>${t('startTime')}</th><th>${t('endTime')}</th><th>${t('duration')}</th><th class="num">${t('distance')}</th><th class="num">${t('stops')}</th><th>${t('status')}</th></tr></thead>
        <tbody>${rows.map(x => {
          const v = byId(d.vehicles, x.vehicleId), dr = byId(d.drivers, x.driverId), tk = byId(d.tasks, x.taskId);
          return html`<tr class="clickable" onClick=${() => (location.hash = '#/trips/' + x.id)}>
            <td><b>${v ? v.reg : '—'}</b></td>
            <td>${dr ? dr.name : '—'}</td>
            <td class="small">${tk ? html`${tk.purpose}<div class="xsmall muted">→ ${tk.destination}</div>` : html`<span class="muted">Ad-hoc</span>`}</td>
            <td class="nowrap">${fmtShort(x.startTs)}</td>
            <td class="nowrap">${x.endTs ? fmtShort(x.endTs) : '—'}</td>
            <td class="nowrap">${duration(x.startTs, x.endTs)}</td>
            <td class="num">${dist(x) != null ? num(dist(x)) + ' km' : '—'}</td>
            <td class="num">${x.stops.length}</td>
            <td>${x.status === 'inTransit' ? (x.paused ? html`<${Status} status="stopped" />` : html`<${Status} status="inTransit" />`) : html`<${Status} status=${x.status} />`}</td>
          </tr>`;
        })}</tbody></table></div>` : html`<${Empty} icon="route" text=${t('empty_trips')} />`}
    <//>
    ${open ? html`<${TripDetail} d=${d} x=${open} admin=${role === 'admin'} onClose=${() => (location.hash = '#/trips')} />` : null}
  </div>`;
}

function TripDetail({ d, x, admin, onClose }) {
  const v = byId(d.vehicles, x.vehicleId), dr = byId(d.drivers, x.driverId), tk = byId(d.tasks, x.taskId);
  const req = x.requestId ? byId(d.requests, x.requestId) : null;
  const [ending, setEnding] = useState(false);
  return html`<${Modal} wide title=${html`${v ? v.reg : 'Trip'} · ${dr ? dr.name : ''} <${Status} status=${x.status === 'inTransit' && x.paused ? 'stopped' : x.status} />`} sub=${fmtDT(x.startTs)} onClose=${onClose}
      footer=${admin && x.status === 'inTransit' ? html`<${Button} variant="ghost-danger" icon="flag" onClick=${() => setEnding(true)}>End trip on driver's behalf<//>` : null}>
    <div class="detail-grid">
      <div class="stack">
        <${KV} items=${[
          [t('startTime'), fmtDT(x.startTs)], [t('startLoc'), html`<${MapLink} lat=${x.startLat} lng=${x.startLng} />`], ['Start odometer', x.startOdo != null ? num(x.startOdo) + ' km' : '—'],
          [t('endTime'), x.endTs ? fmtDT(x.endTs) : '—'], [t('endLoc'), html`<${MapLink} lat=${x.endLat} lng=${x.endLng} />`], ['End odometer', x.endOdo != null ? num(x.endOdo) + ' km' : '—'],
          [t('duration'), duration(x.startTs, x.endTs)], [t('distance'), dist(x) != null ? num(dist(x)) + ' km' : '—'],
          tk && [t('linkedTask'), `${tk.purpose} → ${tk.destination}`], req && ['Trip request', html`<a class="link" href=${'#/requests/' + req.id}>${req.ref}</a>`],
          x.startPhotoId && [t('startPhoto'), html`<a class="link" href=${'/api/files/' + x.startPhotoId} target="_blank" rel="noopener">View photo</a>`],
          x.endPhotoId && [t('endPhoto'), html`<a class="link" href=${'/api/files/' + x.endPhotoId} target="_blank" rel="noopener">View photo</a>`],
          x.notes && ['Notes', html`<span class="pre">${x.notes}</span>`], x.endedBy && ['Ended by', x.endedBy],
        ]} />
      </div>
      <div><h4 class="sec-title">${t('stops')} (${x.stops.length})</h4>
        ${x.stops.length ? html`<ol class="audit">${x.stops.map(s => html`<li>
          <div class="row between"><b class="small">${s.note || 'Stop'}</b><span class="xsmall muted">${duration(s.startTs, s.endTs)}${s.endTs ? '' : ' · ' + t('ongoing')}</span></div>
          <div class="xsmall muted">${fmtShort(s.startTs)}${s.endTs ? ' → ' + fmtShort(s.endTs) : ''} · <${MapLink} lat=${s.lat} lng=${s.lng} /></div>
        </li>`)}</ol>` : html`<p class="small muted">No stops logged.</p>`}
      </div>
    </div>
    ${ending ? html`<${ForceEnd} x=${x} onClose=${() => setEnding(false)} />` : null}
  <//>`;
}

function ForceEnd({ x, onClose }) {
  const [f, setF] = useState({ reason: '', odometer: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); const r = await act('trip.forceEnd', { id: x.id, ...f }, t('endedOk')); setBusy(false); if (r.ok) onClose(); };
  return html`<${Modal} title="End trip" size="sm" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} variant="danger" busy=${busy} onClick=${save}>${t('endTrip')}<//>`}>
    <div class="stack">
      <p class="small muted">Use this when a driver cannot end the trip themselves (lost phone, no network for days).</p>
      <${Field} label=${t('reason')} required><input class="input" ...${bind(f, setF, 'reason')} /><//>
      <${Field} label="End odometer (km)" hint=${x.startOdo != null ? `Start: ${num(x.startOdo)} km` : null}><input class="input" type="number" min="0" ...${bind(f, setF, 'odometer')} /><//>
    </div>
  <//>`;
}

// ================================================================ fuel & maintenance

export function FuelPage({ d, role }) {
  const [tab, setTab] = useState('fuel');
  const [vehicle, setVehicle] = useState('');
  const [adding, setAdding] = useState(false);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const fuel = sortBy(d.fuel.filter(x => !vehicle || x.vehicleId === vehicle), x => x.ts, true);
  const month = d.fuel.filter(x => new Date(x.ts) >= monthStart && (!vehicle || x.vehicleId === vehicle));
  const litres = month.reduce((s, x) => s + x.litres, 0), cost = month.reduce((s, x) => s + x.cost, 0);
  const svc = sortBy((d.maintenance || []).filter(x => !vehicle || x.vehicleId === vehicle), x => x.ts, true);
  const who = x => x.enteredBy === 'driver' ? ((byId(d.drivers, x.driverId) || {}).name || 'Driver') : x.enteredBy;

  return html`<div class="stack">
    <${PageHead} title="Fuel & service" actions=${role === 'admin' && tab === 'fuel' ? html`<${Button} icon="plus" onClick=${() => setAdding(true)}>${t('recordFuel')}<//>` : null} />
    <div class="stats">
      <${Stat} icon="fuel" tone="sky" label=${t('totalLitres') + ' · this month'} value=${num(litres, 1)} />
      <${Stat} icon="chart" tone="brand" label=${t('totalCost') + ' · this month'} value=${money(cost)} />
      <${Stat} icon="gauge" tone="amber" label="Average price" value=${litres ? money(cost / litres) : '—'} sub=${t('perLitre')} />
      <${Stat} icon="wrench" tone="violet" label="Services · this month" value=${(d.maintenance || []).filter(x => new Date(x.ts) >= monthStart && (!vehicle || x.vehicleId === vehicle)).length} />
    </div>
    <div class="toolbar">
      <${Tabs} value=${tab} onChange=${setTab} items=${[{ value: 'fuel', label: t('fuel'), count: fuel.length }, { value: 'service', label: 'Service log', count: svc.length }]} />
      <${Select} value=${vehicle} onChange=${v => setVehicle(v || '')} placeholder=${t('allVehicles')} options=${d.vehicles.map(v => ({ value: v.id, label: v.reg }))} />
    </div>
    <${Card} pad=${false}>
      ${tab === 'fuel' ? (fuel.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('date')}</th><th>${t('vehicle')}</th><th>Recorded by</th><th class="num">${t('litres')}</th><th class="num">${t('cost')}</th><th class="num">₦/L</th><th class="num">${t('odometerCol')}</th><th>${t('station')}</th><th>${t('receipt')}</th></tr></thead>
        <tbody>${fuel.map(x => html`<tr>
          <td class="nowrap">${fmtShort(x.ts)}</td><td><b>${(byId(d.vehicles, x.vehicleId) || {}).reg || '—'}</b></td><td>${who(x)}</td>
          <td class="num">${num(x.litres, 1)}</td><td class="num">${money(x.cost)}</td><td class="num">${x.litres ? num(x.cost / x.litres) : '—'}</td>
          <td class="num">${x.odometer != null ? num(x.odometer) : '—'}</td><td>${x.station || '—'}</td>
          <td>${x.receiptId ? html`<a class="link" href=${'/api/files/' + x.receiptId} target="_blank" rel="noopener">${t('viewReceipt')}</a>` : html`<span class="muted">${t('noReceipt')}</span>`}</td>
        </tr>`)}</tbody></table></div>` : html`<${Empty} icon="fuel" text=${t('empty_fuel')} />`)
      : (svc.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('date')}</th><th>${t('vehicle')}</th><th class="num">${t('odometerCol')}</th><th class="num">${t('cost')}</th><th>Work done</th><th>Recorded by</th></tr></thead>
        <tbody>${svc.map(x => html`<tr><td class="nowrap">${fmtDate(x.ts)}</td><td><b>${(byId(d.vehicles, x.vehicleId) || {}).reg || '—'}</b></td><td class="num">${x.odometer != null ? num(x.odometer) : '—'}</td><td class="num">${x.cost ? money(x.cost) : '—'}</td><td>${x.notes || '—'}</td><td>${x.by}</td></tr>`)}</tbody></table></div>`
        : html`<${Empty} icon="wrench" text="No services recorded. Use “Mark serviced” on the Vehicles page." />`)}
    <//>
    ${adding ? html`<${AdminFuel} d=${d} onClose=${() => setAdding(false)} />` : null}
  </div>`;
}

function AdminFuel({ d, onClose }) {
  const [f, setF] = useState({ vehicleId: '', driverId: '', litres: '', cost: '', odometer: '', station: '', when: toLocalInput(new Date().toISOString()) });
  const [busy, setBusy] = useState(false);
  const b = k => bind(f, setF, k);
  const save = async () => {
    setBusy(true);
    const r = await act('fuel.adminAdd', { ...f, driverId: f.driverId || null, ts: fromLocalInput(f.when) }, t('fuelRecorded'));
    setBusy(false);
    if (r.ok) onClose();
  };
  return html`<${Modal} title=${t('recordFuel')} onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${t('save')}<//>`}>
    <div class="grid-2">
      <${Field} label=${t('vehicle')} required><${Select} value=${f.vehicleId} onChange=${v => setF({ ...f, vehicleId: v || '' })} placeholder=${t('selectPlaceholder')} options=${d.vehicles.map(v => ({ value: v.id, label: v.reg }))} /><//>
      <${Field} label=${t('driver')}><${Select} value=${f.driverId} onChange=${v => setF({ ...f, driverId: v || '' })} placeholder=${t('noneOption')} options=${d.drivers.map(x => ({ value: x.id, label: x.name }))} /><//>
      <${Field} label=${t('litres')} required><input class="input" type="number" min="0" step="0.1" ...${b('litres')} /><//>
      <${Field} label=${t('cost')} required><input class="input" type="number" min="0" ...${b('cost')} /><//>
      <${Field} label=${t('odometerReading')}><input class="input" type="number" min="0" ...${b('odometer')} /><//>
      <${Field} label=${t('date')}><input class="input" type="datetime-local" ...${b('when')} /><//>
      <${Field} label=${t('station')} cls="span-2"><input class="input" ...${b('station')} /><//>
    </div>
  <//>`;
}
