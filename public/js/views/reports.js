import { html, useState, useMemo } from '../lib.js';
import { t } from '../i18n.js';
import { Button, Card, Stat, Select, Field, Icon, num, money, fmtDT, fmtDate, fmtShort, byId, downloadCsv, REQ_LABEL } from '../ui.js';
import { HBars } from '../charts.js';
import { PageHead } from './office.js';

const day = 86400e3;
const iso = d => d.toISOString().slice(0, 10);

function rangeFor(preset, from, to) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  switch (preset) {
    case 'lastMonth': return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];
    case 'last30': return [new Date(Date.now() - 30 * day), new Date(Date.now() + 1000)];
    case 'year': return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
    case 'all': return [new Date(2000, 0, 1), new Date(Date.now() + day)];
    case 'custom': return [from ? new Date(from + 'T00:00:00') : start, to ? new Date(new Date(to + 'T00:00:00').getTime() + day) : new Date(Date.now() + day)];
    default: return [start, new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  }
}

const hours = (a, b) => Math.max(0, ((b ? new Date(b) : new Date()) - new Date(a)) / 3600e3);
const dist = x => x.endOdo != null && x.startOdo != null ? x.endOdo - x.startOdo : 0;

function Table({ head, rows, foot }) {
  return html`<div class="table-wrap"><table class="table compact">
    <thead><tr>${head.map((h, i) => html`<th class=${i ? 'num' : ''}>${h}</th>`)}</tr></thead>
    <tbody>${rows.map(r => html`<tr>${r.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}</tr>`)}</tbody>
    ${foot ? html`<tfoot><tr>${foot.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}</tr></tfoot>` : null}
  </table></div>`;
}

const CsvBtn = ({ onClick }) => html`<${Button} size="sm" variant="ghost" icon="download" onClick=${onClick}>${t('exportCsv')}<//>`;

export function ReportsPage({ d }) {
  const [preset, setPreset] = useState('month');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * day)));
  const [to, setTo] = useState(iso(new Date()));
  const [a, b] = rangeFor(preset, from, to);
  const inR = ts => { const x = new Date(ts); return x >= a && x < b; };
  const label = preset === 'all' ? 'All time' : `${fmtDate(a.toISOString())} – ${fmtDate(new Date(b - 1).toISOString())}`;
  const tag = preset === 'all' ? 'all-time' : `${iso(a)}_to_${iso(new Date(b - 1))}`;

  const r = useMemo(() => {
    const trips = d.trips.filter(x => inR(x.startTs));
    const fuel = d.fuel.filter(x => inR(x.ts));
    const reqs = d.requests.filter(x => inR(x.createdTs));
    const spanDays = Math.max(1, Math.round((Math.min(b, Date.now()) - a) / day));
    const veh = d.vehicles.map(v => {
      const tv = trips.filter(x => x.vehicleId === v.id), fv = fuel.filter(x => x.vehicleId === v.id);
      const km = tv.reduce((s, x) => s + dist(x), 0), l = fv.reduce((s, x) => s + x.litres, 0), c = fv.reduce((s, x) => s + x.cost, 0);
      const days = new Set(tv.map(x => new Date(x.startTs).toDateString())).size;
      return { v, trips: tv.length, km, hrs: tv.reduce((s, x) => s + hours(x.startTs, x.endTs), 0), days, util: Math.min(100, (days / spanDays) * 100), litres: l, cost: c, kmpl: l ? km / l : null, cpk: km ? c / km : null };
    });
    const drv = d.drivers.map(x => {
      const tx = trips.filter(y => y.driverId === x.id), fx = fuel.filter(y => y.driverId === x.id);
      const last = [...tx.map(y => y.endTs || y.startTs), ...fx.map(y => y.ts)].sort().pop();
      return { x, trips: tx.length, km: tx.reduce((s, y) => s + dist(y), 0), hrs: tx.reduce((s, y) => s + hours(y.startTs, y.endTs), 0), stops: tx.reduce((s, y) => s + y.stops.length, 0), fuel: fx.reduce((s, y) => s + y.cost, 0), last };
    });
    const byStatus = {};
    reqs.forEach(x => { byStatus[x.status] = (byStatus[x.status] || 0) + 1; });
    const byUnit = {};
    reqs.forEach(x => { const s = byId(d.staff, x.staffId); const k = s ? s.unitCode : '—'; byUnit[k] = (byUnit[k] || 0) + 1; });
    const decisionHrs = reqs.map(x => {
      const sub = x.history.find(h => h.action === 'TRIP_REQUEST_SUBMITTED');
      const dec = x.history.find(h => ['SPC_APPROVED', 'SPC_REJECTED', 'TRIP_RESCHEDULED'].includes(h.action) && h.to !== h.from);
      return sub && dec ? hours(sub.ts, dec.ts) : null;
    }).filter(x => x != null);
    return { trips, fuel, reqs, veh, drv, byStatus, byUnit, avgDecision: decisionHrs.length ? decisionHrs.reduce((s, x) => s + x, 0) / decisionHrs.length : null };
  }, [d, a.getTime(), b.getTime()]);

  const totKm = r.veh.reduce((s, x) => s + x.km, 0), totL = r.fuel.reduce((s, x) => s + x.litres, 0), totC = r.fuel.reduce((s, x) => s + x.cost, 0);
  const vname = id => (byId(d.vehicles, id) || {}).reg || '';
  const dname = id => (byId(d.drivers, id) || {}).name || '';

  const exportTrips = () => downloadCsv(`trips_${tag}.csv`, [['Start', 'End', 'Vehicle', 'Driver', 'Task', 'Destination', 'Start odometer', 'End odometer', 'Distance km', 'Duration h', 'Stops', 'Status', 'Start lat', 'Start lng', 'End lat', 'End lng'],
    ...r.trips.map(x => { const tk = byId(d.tasks, x.taskId); return [fmtDT(x.startTs), x.endTs ? fmtDT(x.endTs) : '', vname(x.vehicleId), dname(x.driverId), tk ? tk.purpose : '', tk ? tk.destination : '', x.startOdo ?? '', x.endOdo ?? '', dist(x) || '', hours(x.startTs, x.endTs).toFixed(1), x.stops.length, x.status, x.startLat ?? '', x.startLng ?? '', x.endLat ?? '', x.endLng ?? '']; })]);
  const exportFuel = () => downloadCsv(`fuel_${tag}.csv`, [['Date', 'Vehicle', 'Driver', 'Litres', 'Cost (NGN)', 'NGN per litre', 'Odometer', 'Station'],
    ...r.fuel.map(x => [fmtDT(x.ts), vname(x.vehicleId), dname(x.driverId), x.litres, x.cost, x.litres ? (x.cost / x.litres).toFixed(2) : '', x.odometer ?? '', x.station || ''])]);
  const exportReqs = () => downloadCsv(`trip-requests_${tag}.csv`, [['Reference', 'Submitted', 'Requester', 'Unit', 'Purpose', 'Component', 'Destination', 'Departure', 'Return', 'Passengers', 'Priority', 'Status', 'Driver', 'Vehicle'],
    ...r.reqs.map(x => { const s = byId(d.staff, x.staffId) || {}; return [x.ref, fmtDT(x.createdTs), s.fullName || '', s.unitCode || '', x.purpose, x.component, x.destination, fmtDT(x.departTs), fmtDT(x.returnTs), x.passengers, x.priority, REQ_LABEL[x.status] || x.status, dname(x.dispatchDriverId), vname(x.dispatchVehicleId)]; })]);
  const exportVeh = () => downloadCsv(`vehicle-utilisation_${tag}.csv`, [['Vehicle', 'Model', 'Trips', 'Distance km', 'Hours on road', 'Days used', 'Utilisation %', 'Fuel litres', 'Fuel cost', 'km per litre', 'Cost per km'],
    ...r.veh.map(x => [x.v.reg, x.v.model, x.trips, x.km, x.hrs.toFixed(1), x.days, x.util.toFixed(0), x.litres, x.cost, x.kmpl ? x.kmpl.toFixed(2) : '', x.cpk ? x.cpk.toFixed(2) : ''])]);
  const exportDrv = () => downloadCsv(`driver-activity_${tag}.csv`, [['Driver', 'Trips', 'Distance km', 'Hours', 'Stops', 'Fuel cost', 'Last activity'],
    ...r.drv.map(x => [x.x.name, x.trips, x.km, x.hrs.toFixed(1), x.stops, x.fuel, x.last ? fmtDT(x.last) : ''])]);

  return html`<div class="stack-lg report-page">
    <${PageHead} title=${t('reports')} sub=${label} actions=${html`<${Button} variant="secondary" icon="printer" onClick=${() => window.print()}>${t('print')}<//>`} />
    <div class="toolbar no-print">
      <div class="row gap-sm wrap">
        <${Select} value=${preset} onChange=${v => setPreset(v || 'month')} options=${[{ value: 'month', label: 'This month' }, { value: 'lastMonth', label: 'Last month' }, { value: 'last30', label: 'Last 30 days' }, { value: 'year', label: 'This year' }, { value: 'all', label: 'All time' }, { value: 'custom', label: 'Custom range…' }]} />
        ${preset === 'custom' ? html`<input class="input" type="date" value=${from} onInput=${e => setFrom(e.target.value)} /><span class="muted">to</span><input class="input" type="date" value=${to} onInput=${e => setTo(e.target.value)} />` : null}
      </div>
      <div class="row gap-sm wrap"><${CsvBtn} onClick=${exportTrips} /><span class="xsmall muted">trip log</span><${CsvBtn} onClick=${exportFuel} /><span class="xsmall muted">fuel log</span></div>
    </div>
    <div class="stats">
      <${Stat} icon="route" tone="brand" label=${t('trips')} value=${num(r.trips.length)} sub=${num(totKm) + ' km'} />
      <${Stat} icon="fuel" tone="sky" label=${t('fuelCost')} value=${money(totC)} sub=${num(totL, 1) + ' L'} />
      <${Stat} icon="gauge" tone="amber" label="Fuel economy" value=${totL && totKm ? num(totKm / totL, 1) + ' km/L' : '—'} sub=${totKm ? money(totC / totKm) + ' per km' : null} />
      <${Stat} icon="inbox" tone="violet" label=${t('tripRequests')} value=${num(r.reqs.length)} sub=${r.avgDecision != null ? `avg ${num(r.avgDecision, 1)} h to decision` : null} />
    </div>

    <${Card} title=${t('rpt_vehicleUtil')} sub="Utilisation = share of days the vehicle made at least one trip." icon="car" actions=${html`<${CsvBtn} onClick=${exportVeh} />`} pad=${false}>
      <${Table} head=${[t('vehicle'), t('numTrips'), t('distance') + ' (km)', 'Hours', t('utilization'), t('litres'), t('fuelCost'), 'km/L', '₦/km']}
        rows=${r.veh.map(x => [html`<b>${x.v.reg}</b> <span class="muted xsmall">${x.v.model}</span>`, x.trips, num(x.km), num(x.hrs, 1), num(x.util) + '%', num(x.litres, 1), money(x.cost), x.kmpl ? num(x.kmpl, 1) : '—', x.cpk ? money(x.cpk) : '—'])}
        foot=${['Total', r.trips.length, num(totKm), num(r.veh.reduce((s, x) => s + x.hrs, 0), 1), '', num(totL, 1), money(totC), totL ? num(totKm / totL, 1) : '—', totKm ? money(totC / totKm) : '—']} />
    <//>

    <div class="grid-2 gap-lg">
      <${Card} title="Distance by vehicle" icon="chart"><${HBars} data=${r.veh.filter(x => x.km).sort((p, q) => q.km - p.km).map(x => ({ label: x.v.reg, value: x.km }))} format=${v => num(v) + ' km'} empty=${t('empty_trips')} /><//>
      <${Card} title=${t('rpt_fuelCost')} icon="fuel"><${HBars} tone="sky" data=${r.veh.filter(x => x.cost).sort((p, q) => q.cost - p.cost).map(x => ({ label: x.v.reg, value: x.cost }))} format=${money} empty=${t('empty_fuel')} /><//>
    </div>

    <${Card} title=${t('rpt_driverActivity')} icon="users" actions=${html`<${CsvBtn} onClick=${exportDrv} />`} pad=${false}>
      <${Table} head=${[t('driver'), t('numTrips'), t('distance') + ' (km)', 'Hours', t('stops'), t('fuelCost'), t('lastActivity')]}
        rows=${[...r.drv].sort((p, q) => q.km - p.km).map(x => [html`<b>${x.x.name}</b>`, x.trips, num(x.km), num(x.hrs, 1), x.stops, money(x.fuel), x.last ? fmtShort(x.last) : '—'])} />
    <//>

    <${Card} title=${t('tripRequests')} icon="inbox" actions=${html`<${CsvBtn} onClick=${exportReqs} />`}>
      <div class="grid-2 gap-lg">
        <div><h4 class="sec-title">By status</h4><${HBars} tone="violet" data=${Object.keys(r.byStatus).map(k => ({ label: REQ_LABEL[k] || k, value: r.byStatus[k] })).sort((p, q) => q.value - p.value)} empty="No requests in this period." /></div>
        <div><h4 class="sec-title">By unit</h4><${HBars} tone="teal" data=${Object.keys(r.byUnit).map(k => ({ label: k, value: r.byUnit[k] })).sort((p, q) => q.value - p.value)} empty="No requests in this period." /></div>
      </div>
    <//>
  </div>`;
}
