// Daily operations: trips, tasks, fuel & service. Lists show the most recent
// records (older ones belong in Reports); changes go through Cloud Functions.
import { FormEvent, useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { db, call } from '../firebase';
import { openUpload, useCollection, useSettings, WithId } from '../data';
import { Driver, Fuel, Maintenance, Task, Trip, TripRequest, UserAccount, Vehicle } from '../types';
import {
  Alert, Badge, Button, Card, compactInputCls, cx, duration, Field, fmtDate, fmtDT, fromLocalInput, inputCls, MapLink, Modal, money, num, Spinner,
  Stat, Tabs, toLocalInput, useAction,
} from '../ui';

const RECENT = 300;
const dist = (t: Trip) => (t.endOdo != null && t.startOdo != null ? t.endOdo - t.startOdo : null);

function useFleet() {
  const vehicles = useCollection<Vehicle>(collection(db, 'vehicles'), 'vehicles');
  const drivers = useCollection<Driver>(collection(db, 'drivers'), 'drivers');
  const reg = (id?: string | null) => vehicles.data.find(v => v.id === id)?.reg ?? '—';
  const driverName = (id?: string | null) => drivers.data.find(d => d.id === id)?.name ?? '—';
  return { vehicles, drivers, reg, driverName };
}

function Filter({ value, onChange, all, options }: { value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[] }) {
  return (
    <select className={compactInputCls} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{all}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function FileLink({ path, label }: { path?: string | null; label: string }) {
  if (!path) return <span className="text-slate-400">—</span>;
  return <button className="text-emerald-800 underline" onClick={() => openUpload(path)}>{label}</button>;
}

// ================================================================ trips

export function TripsPage({ isAdmin, selectedId }: { isAdmin: boolean; selectedId: string | null }) {
  const trips = useCollection<Trip>(query(collection(db, 'trips'), orderBy('startTs', 'desc'), limit(RECENT)), 'trips');
  const tasks = useCollection<Task>(query(collection(db, 'tasks'), orderBy('scheduledTs', 'desc'), limit(RECENT)), 'tasks');
  const { vehicles, drivers, reg, driverName } = useFleet();
  const [tab, setTab] = useState<'all' | 'active' | 'completed'>('all');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');

  const groups = { all: () => true, active: (t: Trip) => t.status === 'inTransit', completed: (t: Trip) => t.status === 'completed' };
  const rows = trips.data.filter(groups[tab]).filter(t => (!vehicle || t.vehicleId === vehicle) && (!driver || t.driverId === driver));
  const km = rows.reduce((s, t) => s + (dist(t) ?? 0), 0);
  const open = trips.data.find(t => t.id === selectedId);
  const taskOf = (id?: string | null) => tasks.data.find(t => t.id === id);

  if (trips.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'all', label: 'All', count: trips.data.length },
          { value: 'active', label: 'On the road', count: trips.data.filter(groups.active).length },
          { value: 'completed', label: 'Completed', count: trips.data.filter(groups.completed).length },
        ]} />
        <div className="flex flex-wrap gap-2">
          <Filter value={vehicle} onChange={setVehicle} all="All vehicles" options={vehicles.data.map(v => ({ value: v.id, label: v.reg }))} />
          <Filter value={driver} onChange={setDriver} all="All drivers" options={drivers.data.map(d => ({ value: d.id, label: d.name }))} />
        </div>
      </div>
      <p className="text-sm text-slate-600">{rows.length} trip(s) · {num(km)} km recorded</p>
      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-2">Vehicle</th><th className="px-4 py-2">Driver</th><th className="px-4 py-2">Job</th><th className="px-4 py-2">Started</th><th className="px-4 py-2">Duration</th><th className="px-4 py-2 text-right">Distance</th><th className="px-4 py-2">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(t => {
              const task = taskOf(t.taskId);
              return (
                <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => (location.hash = '#/trips/' + t.id)}>
                  <td className="px-4 py-2.5 font-semibold">{reg(t.vehicleId)}</td>
                  <td className="px-4 py-2.5">{driverName(t.driverId)}</td>
                  <td className="px-4 py-2.5">{task ? <>{task.purpose}<div className="text-xs text-slate-500">→ {task.destination}</div></> : <span className="text-slate-400">No task</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{fmtDT(t.startTs)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{duration(t.startTs, t.endTs)}</td>
                  <td className="px-4 py-2.5 text-right">{dist(t) != null ? `${num(dist(t))} km` : '—'}</td>
                  <td className="px-4 py-2.5"><TripBadge t={t} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No trips recorded yet.</p>}
      </Card>
      {open && <TripDetail t={open} task={taskOf(open.taskId)} reg={reg(open.vehicleId)} driver={driverName(open.driverId)} isAdmin={isAdmin} onClose={() => (location.hash = '#/trips')} />}
    </div>
  );
}

function TripBadge({ t }: { t: Trip }) {
  if (t.status === 'completed') return <Badge>Completed</Badge>;
  return t.paused ? <Badge tone="amber">Stopped</Badge> : <Badge tone="blue">On the road</Badge>;
}

function TripDetail({ t, task, reg, driver, isAdmin, onClose }: { t: WithId<Trip>; task?: WithId<Task>; reg: string; driver: string; isAdmin: boolean; onClose: () => void }) {
  const [ending, setEnding] = useState(false);
  return (
    <Modal wide title={<>{reg} · {driver} <TripBadge t={t} /></>} sub={fmtDT(t.startTs)} onClose={onClose}
      footer={isAdmin && t.status === 'inTransit' ? <Button variant="danger" onClick={() => setEnding(true)}>End trip for the driver</Button> : undefined}>
      <div className="grid gap-6 sm:grid-cols-2">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-slate-500">Started</dt><dd>{fmtDT(t.startTs)}</dd>
          <dt className="text-slate-500">Start location</dt><dd><MapLink lat={t.startLat} lng={t.startLng} /></dd>
          <dt className="text-slate-500">Start odometer</dt><dd>{t.startOdo != null ? `${num(t.startOdo)} km` : '—'}</dd>
          <dt className="text-slate-500">Ended</dt><dd>{t.endTs ? fmtDT(t.endTs) : '—'}</dd>
          <dt className="text-slate-500">End location</dt><dd><MapLink lat={t.endLat} lng={t.endLng} /></dd>
          <dt className="text-slate-500">End odometer</dt><dd>{t.endOdo != null ? `${num(t.endOdo)} km` : '—'}</dd>
          <dt className="text-slate-500">Duration</dt><dd>{duration(t.startTs, t.endTs)}</dd>
          <dt className="text-slate-500">Distance</dt><dd>{dist(t) != null ? `${num(dist(t))} km` : '—'}</dd>
          {task && <><dt className="text-slate-500">Task</dt><dd>{task.purpose} → {task.destination}</dd></>}
          {t.requestId && <><dt className="text-slate-500">Trip request</dt><dd><a className="text-emerald-800 underline" href={`#/requests/${t.requestId}`}>{task?.requester?.ref ?? 'Open request'}</a></dd></>}
          <dt className="text-slate-500">Photos</dt><dd className="space-x-3"><FileLink path={t.startPhoto} label="Start" /><FileLink path={t.endPhoto} label="End" /></dd>
          {t.notes && <><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-line">{t.notes}</dd></>}
          {t.endedBy && <><dt className="text-slate-500">Ended by</dt><dd>{t.endedBy} (office)</dd></>}
        </dl>
        <div>
          <div className="mb-2 text-sm font-semibold">Stops ({t.stops.length})</div>
          {t.stops.length === 0 ? <p className="text-sm text-slate-500">No stops logged.</p> : (
            <ol className="space-y-2 border-l-2 border-slate-200 pl-3 text-sm">
              {t.stops.map(s => (
                <li key={s.id}>
                  <div className="font-medium">{s.note || 'Stop'} <span className="text-xs font-normal text-slate-500">· {duration(s.startTs, s.endTs)}{s.endTs ? '' : ' (ongoing)'}</span></div>
                  <div className="text-xs text-slate-500">{fmtDT(s.startTs)} · <MapLink lat={s.lat} lng={s.lng} /></div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {ending && <ForceEnd t={t} onClose={() => setEnding(false)} />}
    </Modal>
  );
}

function ForceEnd({ t, onClose }: { t: WithId<Trip>; onClose: () => void }) {
  const [f, setF] = useState({ reason: '', odometer: '' });
  const { busy, error, run } = useAction();
  return (
    <Modal title="End trip for the driver" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant="danger" busy={busy} disabled={!f.reason.trim()} onClick={() => run(async () => { await call('tripForceEnd', { id: t.id, ...f }); onClose(); })}>End trip</Button></>}>
      <p className="text-sm text-slate-600">Use this when the driver can't end the trip themselves, for example a lost phone or no network for days.</p>
      <Field label="Reason *"><input className={inputCls} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      <Field label="End odometer (km)" hint={t.startOdo != null ? `Start: ${num(t.startOdo)} km` : undefined}>
        <input className={inputCls} inputMode="numeric" value={f.odometer} onChange={e => setF({ ...f, odometer: e.target.value })} />
      </Field>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

// ================================================================ tasks

const PRIORITY_TONE = { high: 'red', medium: 'amber', low: 'slate' } as const;
const TASK_LABEL = { scheduled: 'Scheduled', inProgress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' } as const;

export function TasksPage() {
  const tasks = useCollection<Task>(query(collection(db, 'tasks'), orderBy('scheduledTs', 'desc'), limit(RECENT)), 'tasks');
  const requests = useCollection<TripRequest>(query(collection(db, 'requests'), orderBy('createdTs', 'desc'), limit(RECENT)), 'requests');
  const users = useCollection<UserAccount>(collection(db, 'users'), 'users');
  const { vehicles, drivers, reg, driverName } = useFleet();
  const [tab, setTab] = useState<'open' | 'completed' | 'cancelled' | 'all'>('open');
  const [driver, setDriver] = useState('');
  const [editing, setEditing] = useState<WithId<Task> | 'new' | null>(null);
  const { busy, error, run } = useAction();

  const groups = {
    open: (t: Task) => t.status === 'scheduled' || t.status === 'inProgress',
    completed: (t: Task) => t.status === 'completed', cancelled: (t: Task) => t.status === 'cancelled', all: () => true,
  };
  const rows = tasks.data.filter(groups[tab]).filter(t => !driver || t.driverId === driver)
    .sort((a, b) => (tab === 'open' ? a.scheduledTs.localeCompare(b.scheduledTs) : b.scheduledTs.localeCompare(a.scheduledTs)));
  const refOf = (id?: string | null) => requests.data.find(r => r.id === id)?.ref;
  const activeDrivers = drivers.data.filter(d => users.data.find(u => u.id === d.id)?.status === 'active');

  const cancel = (t: WithId<Task>) => {
    if (confirm(`Cancel "${t.purpose}"? The driver will see it as cancelled.`)) run(() => call('taskCancel', { id: t.id }));
  };

  if (tasks.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Jobs given to drivers. Trip requests appear here automatically once a driver is assigned.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} items={(['open', 'completed', 'cancelled', 'all'] as const).map(k => ({ value: k, label: { open: 'Open', completed: 'Completed', cancelled: 'Cancelled', all: 'All' }[k], count: tasks.data.filter(groups[k]).length }))} />
        <div className="flex flex-wrap gap-2">
          <Filter value={driver} onChange={setDriver} all="All drivers" options={drivers.data.map(d => ({ value: d.id, label: d.name }))} />
          <Button onClick={() => setEditing('new')}>Assign task</Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Driver</th><th className="px-4 py-2">Job</th><th className="px-4 py-2">Route</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2">Status</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(t => {
              const overdue = t.status === 'scheduled' && Date.parse(t.scheduledTs) < Date.now();
              const ref = refOf(t.requestId) ?? t.requester?.ref;
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">{fmtDT(t.scheduledTs)}{overdue && <div><Badge tone="red">Overdue</Badge></div>}</td>
                  <td className="px-4 py-2.5">{driverName(t.driverId)}<div className="text-xs text-slate-500">{t.vehicleId ? reg(t.vehicleId) : ''}</div></td>
                  <td className="px-4 py-2.5">{t.purpose}{t.requestId && <div className="text-xs"><a className="text-emerald-800 underline" href={`#/requests/${t.requestId}`}>{ref ?? 'Trip request'}</a></div>}</td>
                  <td className="px-4 py-2.5 text-slate-600">{t.origin} → {t.destination}</td>
                  <td className="px-4 py-2.5"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                  <td className="px-4 py-2.5">
                    {TASK_LABEL[t.status]}
                    {t.status === 'scheduled' && <div className={cx('text-xs', t.acknowledged ? 'text-emerald-700' : 'text-slate-500')}>{t.acknowledged ? 'Acknowledged' : 'Not acknowledged'}</div>}
                    {t.tripId && <div className="text-xs"><a className="text-emerald-800 underline" href={`#/trips/${t.tripId}`}>View trip</a></div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {t.status === 'scheduled' && !t.requestId && <>
                      <Button variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                      <Button variant="ghost" busy={busy} onClick={() => cancel(t)}>Cancel</Button>
                    </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No tasks here.</p>}
      </Card>
      {editing && <TaskForm task={editing === 'new' ? null : editing} drivers={activeDrivers} vehicles={vehicles.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaskForm({ task, drivers, vehicles, onClose }: { task: WithId<Task> | null; drivers: WithId<Driver>[]; vehicles: WithId<Vehicle>[]; onClose: () => void }) {
  const settings = useSettings();
  const [f, setF] = useState({
    driverId: task?.driverId ?? '', vehicleId: task?.vehicleId ?? '', purpose: task?.purpose ?? '',
    origin: task?.origin ?? '', destination: task?.destination ?? '', when: toLocalInput(task?.scheduledTs),
    priority: task?.priority ?? 'medium', notes: task?.notes ?? '',
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pickDriver = (id: string) => setF(x => ({ ...x, driverId: id, vehicleId: drivers.find(d => d.id === id)?.vehicleId ?? x.vehicleId }));

  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await call('taskSave', {
        id: task?.id, driverId: f.driverId, vehicleId: f.vehicleId || null, purpose: f.purpose,
        origin: f.origin || settings.defaultOrigin, destination: f.destination,
        scheduledTs: fromLocalInput(f.when), priority: f.priority, notes: f.notes,
      });
      onClose();
    });
  };

  return (
    <Modal wide title={task ? 'Edit task' : 'Assign task'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} type="submit" form="task-form">{task ? 'Save' : 'Assign task'}</Button></>}>
      <form id="task-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Driver *">
          <select className={inputCls} value={f.driverId} onChange={e => pickDriver(e.target.value)} required>
            <option value="">Choose a driver…</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Vehicle" hint="Defaults to the driver's vehicle.">
          <select className={inputCls} value={f.vehicleId} onChange={set('vehicleId')}>
            <option value="">None</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.reg} · {v.model}{v.condition !== 'ok' ? ' (off the road)' : ''}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label="Job *"><input className={inputCls} value={f.purpose} onChange={set('purpose')} required placeholder="Deliver pump parts" /></Field></div>
        <Field label="From"><input className={inputCls} value={f.origin} onChange={set('origin')} placeholder={settings.defaultOrigin} /></Field>
        <Field label="To *"><input className={inputCls} value={f.destination} onChange={set('destination')} required /></Field>
        <Field label="When *"><input className={inputCls} type="datetime-local" value={f.when} onChange={set('when')} required /></Field>
        <Field label="Priority">
          <select className={inputCls} value={f.priority} onChange={set('priority')}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        </Field>
        <div className="sm:col-span-2"><Field label="Notes for the driver"><textarea className={inputCls} rows={2} value={f.notes} onChange={set('notes')} /></Field></div>
      </form>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

// ================================================================ fuel & service

export function FuelPage({ isAdmin }: { isAdmin: boolean }) {
  const fuel = useCollection<Fuel>(query(collection(db, 'fuel'), orderBy('ts', 'desc'), limit(RECENT)), 'fuel');
  const maint = useCollection<Maintenance>(query(collection(db, 'maintenance'), orderBy('ts', 'desc'), limit(RECENT)), 'maintenance');
  const { vehicles, drivers, reg, driverName } = useFleet();
  const [tab, setTab] = useState<'fuel' | 'service'>('fuel');
  const [vehicle, setVehicle] = useState('');
  const [adding, setAdding] = useState(false);

  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);
  const fuelRows = fuel.data.filter(x => !vehicle || x.vehicleId === vehicle);
  const svcRows = maint.data.filter(x => !vehicle || x.vehicleId === vehicle);
  const month = fuelRows.filter(x => x.ts >= monthStart);
  const litres = month.reduce((s, x) => s + x.litres, 0), cost = month.reduce((s, x) => s + x.cost, 0);
  const who = (x: Fuel) => (x.enteredBy === 'driver' ? driverName(x.driverId) : x.enteredBy);

  if (fuel.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Litres this month" value={num(litres, 1)} />
        <Stat label="Fuel cost this month" value={money(cost)} />
        <Stat label="Average price" value={litres ? money(cost / litres) : '—'} sub="per litre" />
        <Stat label="Services this month" value={svcRows.filter(x => x.ts >= monthStart).length} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'fuel', label: 'Fuel', count: fuelRows.length }, { value: 'service', label: 'Service log', count: svcRows.length }]} />
        <div className="flex flex-wrap gap-2">
          <Filter value={vehicle} onChange={setVehicle} all="All vehicles" options={vehicles.data.map(v => ({ value: v.id, label: v.reg }))} />
          {isAdmin && tab === 'fuel' && <Button onClick={() => setAdding(true)}>Record fuel</Button>}
        </div>
      </div>
      <Card className="overflow-x-auto p-0 sm:p-0">
        {tab === 'fuel' ? (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Vehicle</th><th className="px-4 py-2">Recorded by</th><th className="px-4 py-2 text-right">Litres</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">₦/L</th><th className="px-4 py-2 text-right">Odometer</th><th className="px-4 py-2">Station</th><th className="px-4 py-2">Receipt</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fuelRows.map(x => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">{fmtDT(x.ts)}</td>
                  <td className="px-4 py-2.5 font-semibold">{reg(x.vehicleId)}</td>
                  <td className="px-4 py-2.5">{who(x)}</td>
                  <td className="px-4 py-2.5 text-right">{num(x.litres, 1)}</td>
                  <td className="px-4 py-2.5 text-right">{money(x.cost)}</td>
                  <td className="px-4 py-2.5 text-right">{x.litres ? num(x.cost / x.litres) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">{x.odometer != null ? num(x.odometer) : '—'}</td>
                  <td className="px-4 py-2.5">{x.station || '—'}</td>
                  <td className="px-4 py-2.5"><FileLink path={x.receipt} label="View" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Vehicle</th><th className="px-4 py-2 text-right">Odometer</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2">Work done</th><th className="px-4 py-2">Recorded by</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {svcRows.map(x => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(x.ts)}</td>
                  <td className="px-4 py-2.5 font-semibold">{reg(x.vehicleId)}</td>
                  <td className="px-4 py-2.5 text-right">{x.odometer != null ? num(x.odometer) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">{x.cost ? money(x.cost) : '—'}</td>
                  <td className="px-4 py-2.5">{x.notes || '—'}</td>
                  <td className="px-4 py-2.5">{x.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(tab === 'fuel' ? fuelRows : svcRows).length === 0 && (
          <p className="p-4 text-sm text-slate-500">{tab === 'fuel' ? 'No fuel recorded yet.' : 'No services recorded. Use “Record service” on the Vehicles page.'}</p>
        )}
      </Card>
      {adding && <AdminFuel vehicles={vehicles.data} drivers={drivers.data} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AdminFuel({ vehicles, drivers, onClose }: { vehicles: WithId<Vehicle>[]; drivers: WithId<Driver>[]; onClose: () => void }) {
  const [f, setF] = useState({ vehicleId: '', driverId: '', litres: '', cost: '', odometer: '', station: '', when: toLocalInput(new Date().toISOString()) });
  const [receipt, setReceipt] = useState<File | null>(null);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const data = receipt ? await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(receipt); }) : null;
      await call('fuelAdminAdd', { ...f, driverId: f.driverId || null, ts: fromLocalInput(f.when), receipt: data ? { name: receipt!.name, data } : undefined });
      onClose();
    });
  };
  return (
    <Modal title="Record fuel" sub="For a paper receipt or a fill-up the driver did not record." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} type="submit" form="fuel-form">Save</Button></>}>
      <form id="fuel-form" onSubmit={save} className="grid grid-cols-2 gap-3">
        <Field label="Vehicle *">
          <select className={inputCls} value={f.vehicleId} onChange={set('vehicleId')} required>
            <option value="">Choose…</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.reg}</option>)}
          </select>
        </Field>
        <Field label="Driver">
          <select className={inputCls} value={f.driverId} onChange={set('driverId')}>
            <option value="">None</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Litres *"><input className={inputCls} inputMode="decimal" value={f.litres} onChange={set('litres')} required /></Field>
        <Field label="Cost (₦) *"><input className={inputCls} inputMode="decimal" value={f.cost} onChange={set('cost')} required /></Field>
        <Field label="Odometer (km)"><input className={inputCls} inputMode="numeric" value={f.odometer} onChange={set('odometer')} /></Field>
        <Field label="Date"><input className={inputCls} type="datetime-local" value={f.when} onChange={set('when')} /></Field>
        <div className="col-span-2"><Field label="Station"><input className={inputCls} value={f.station} onChange={set('station')} /></Field></div>
        <div className="col-span-2"><Field label="Receipt (optional)" hint="JPG, PNG, WEBP or PDF, up to 5 MB">
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setReceipt(e.target.files?.[0] ?? null)} className="text-sm" />
        </Field></div>
      </form>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
