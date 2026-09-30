// Driver app (phone). Every action is queued with queueDriverAction, which
// works with or without signal; the UI shows queued actions as if applied.
import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { signOutNow, useAuth } from '../auth';
import { DriverAction, getPosition, queueDriverAction, shrinkImage, uploadDriverPhoto, useCollection, useDocument, useOnline, WithId } from '../data';
import { Driver, Task, Trip, Vehicle } from '../types';
import { Alert, Button, Card, Field, fmtDT, inputCls, Logo, Spinner } from '../ui';

// Server data with not-yet-applied actions layered on top.
function withPending(trips: WithId<Trip>[], tasks: WithId<Task>[], pending: WithId<DriverAction>[], me: string, myVehicle: string | null) {
  const tr = trips.map(t => ({ ...t, stops: [...t.stops], pending: false }));
  const tk = tasks.map(t => ({ ...t }));
  for (const a of [...pending].sort((x, y) => x.seq - y.seq)) {
    const p = a.payload as Record<string, string | number | undefined>;
    const trip = p.tripId ? tr.find(t => t.id === p.tripId) : undefined;
    if (a.type === 'trip.start' && !tr.some(t => t.id === 't-' + a.id)) {
      const task = p.taskId ? tk.find(t => t.id === p.taskId) : undefined;
      tr.unshift({ id: 't-' + a.id, driverId: me, vehicleId: String(task?.vehicleId ?? p.vehicleId ?? myVehicle ?? ''), taskId: task?.id ?? null, status: 'inTransit', paused: false, startTs: a.ts, startOdo: p.odo as number, stops: [], pending: true });
      if (task) { task.status = 'inProgress'; task.tripId = 't-' + a.id; }
    } else if (trip && a.type === 'trip.stop') {
      trip.paused = true; trip.pending = true; trip.stops.push({ id: a.id, startTs: a.ts, note: String(p.note ?? '') });
    } else if (trip && a.type === 'trip.resume') {
      trip.paused = false; trip.pending = true; trip.stops = trip.stops.map(s => (s.endTs ? s : { ...s, endTs: a.ts }));
    } else if (trip && a.type === 'trip.end') {
      trip.status = 'completed'; trip.pending = true; trip.endTs = a.ts; trip.endOdo = p.odo as number;
      const task = tk.find(t => t.tripId === trip.id);
      if (task) task.status = 'completed';
    } else if (a.type === 'task.ack') {
      const task = tk.find(t => t.id === p.taskId);
      if (task) task.acknowledged = true;
    }
  }
  return { trips: tr, tasks: tk };
}

export function DriverApp() {
  const { session } = useAuth();
  const uid = session!.user.uid;
  const online = useOnline();
  const me = useDocument<Driver>(`drivers/${uid}`);
  const vehicles = useCollection<Vehicle>(collection(db, 'vehicles'), 'd-veh');
  const tasks = useCollection<Task>(query(collection(db, 'tasks'), where('driverId', '==', uid), orderBy('scheduledTs', 'desc'), limit(30)), 'd-tasks');
  const trips = useCollection<Trip>(query(collection(db, 'trips'), where('driverId', '==', uid), orderBy('startTs', 'desc'), limit(20)), 'd-trips');
  const pending = useCollection<DriverAction>(query(collection(db, 'driverActions'), where('driverId', '==', uid), where('state', '==', 'pending')), 'd-pending');
  const rejected = useCollection<DriverAction>(query(collection(db, 'driverActions'), where('driverId', '==', uid), where('state', '==', 'rejected')), 'd-rejected');

  const view = useMemo(() => withPending(trips.data, tasks.data, pending.data, uid, me?.vehicleId ?? null),
    [trips.data, tasks.data, pending.data, uid, me?.vehicleId]);
  const active = view.trips.find(t => t.status === 'inTransit');
  const open = view.tasks.filter(t => t.status === 'scheduled').sort((a, b) => a.scheduledTs.localeCompare(b.scheduledTs));
  const recentErrors = rejected.data.filter(a => Date.now() - Date.parse(a.ts) < 2 * 86400_000);
  const reg = (id?: string | null) => vehicles.data.find(v => v.id === id)?.reg ?? '-';

  if (tasks.loading && trips.loading) return <Spinner label="Loading your trips…" />;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <Logo small />
        <Button variant="ghost" onClick={signOutNow}>Sign out</Button>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
        <span>{me?.name ?? session!.user.displayName} · {reg(me?.vehicleId)}</span>
        <span className={online ? 'text-emerald-700' : 'text-amber-700'}>
          {online ? (pending.data.length ? `Uploading ${pending.data.length}…` : 'All saved') : `Offline · ${pending.data.length} waiting`}
        </span>
      </div>
      {recentErrors.map(a => <Alert key={a.id}>Could not record “{a.type}”: {a.error}</Alert>)}

      {active ? <ActiveTrip trip={active} reg={reg(active.vehicleId)} online={online} /> : (
        <>
          <Card title="My tasks">
            {open.length === 0 ? <p className="text-sm text-slate-500">No tasks assigned.</p> : (
              <ul className="divide-y divide-slate-100">
                {open.map(t => <TaskRow key={t.id} t={t} reg={reg(t.vehicleId)} online={online} />)}
              </ul>
            )}
          </Card>
          <StartTrip online={online} label="Start a trip without a task" />
        </>
      )}

      <FuelForm online={online} />

      <Card title="Recent trips">
        <ul className="divide-y divide-slate-100 text-sm">
          {view.trips.filter(t => t.status === 'completed').slice(0, 10).map(t => (
            <li key={t.id} className="py-2">
              <div className="flex justify-between"><span>{reg(t.vehicleId)}</span><span className="text-slate-500">{fmtDT(t.startTs)}</span></div>
              {t.startOdo != null && t.endOdo != null && <div className="text-xs text-slate-500">{(t.endOdo - t.startOdo).toLocaleString()} km</div>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TaskRow({ t, reg, online }: { t: WithId<Task>; reg: string; online: boolean }) {
  return (
    <li className="space-y-2 py-3">
      <div className="font-medium">{t.purpose}</div>
      <div className="text-sm text-slate-600">{t.origin} → {t.destination}</div>
      <div className="text-xs text-slate-500">{fmtDT(t.scheduledTs)} · {reg}{t.priority === 'high' ? ' · HIGH PRIORITY' : ''}</div>
      {t.requester && <div className="text-xs text-slate-600">For {t.requester.name}{t.requester.phone ? ` (${t.requester.phone})` : ''} · {t.requester.passengers} passenger(s) · back {fmtDT(t.requester.returnTs)}</div>}
      <div className="flex gap-2">
        {!t.acknowledged && <Button variant="secondary" onClick={() => queueDriverAction('task.ack', { taskId: t.id })}>Acknowledge</Button>}
        <StartTrip online={online} taskId={t.id} label="Start trip" compact />
      </div>
    </li>
  );
}

// Asks for the odometer reading (and an optional photo), then queues the action.
function useOdoPrompt(online: boolean) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const capture = async (photo: File | null) => {
    if (!photo) return undefined;
    if (!online) { setError('Photo skipped: no connection. The reading was still recorded.'); return undefined; }
    try { return await uploadDriverPhoto(await shrinkImage(photo)); }
    catch { setError('Photo could not be uploaded. The reading was still recorded.'); return undefined; }
  };
  return { error, setError, busy, setBusy, capture };
}

function StartTrip({ online, taskId, label, compact }: { online: boolean; taskId?: string; label: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [odo, setOdo] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const o = useOdoPrompt(online);
  if (!open) return <Button className={compact ? '' : 'w-full'} onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <Card className="w-full">
      <div className="space-y-3">
        <Field label="Odometer at start (km)"><input className={inputCls} inputMode="numeric" value={odo} onChange={e => setOdo(e.target.value)} /></Field>
        <Field label="Odometer photo (optional)"><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} className="text-sm" /></Field>
        {o.error && <Alert tone="warn">{o.error}</Alert>}
        <div className="flex gap-2">
          <Button busy={o.busy} onClick={async () => {
            o.setBusy(true);
            const [pos, path] = await Promise.all([getPosition(), o.capture(photo)]);
            queueDriverAction('trip.start', { taskId, odo: odo ? Number(odo) : undefined, photo: path, ...pos });
            o.setBusy(false); setOpen(false);
          }}>Start</Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>Back</Button>
        </div>
      </div>
    </Card>
  );
}

function ActiveTrip({ trip, reg, online }: { trip: WithId<Trip> & { pending: boolean }; reg: string; online: boolean }) {
  const [ending, setEnding] = useState(false);
  const [odo, setOdo] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const o = useOdoPrompt(online);
  const openStop = trip.stops.find(s => !s.endTs);

  return (
    <Card title={`On a trip · ${reg}`} actions={trip.pending ? <span className="text-xs text-amber-700">Waiting to upload</span> : null}>
      <div className="space-y-1 text-sm">
        <div>Started {fmtDT(trip.startTs)}{trip.startOdo != null ? ` at ${trip.startOdo.toLocaleString()} km` : ''}</div>
        {trip.stops.length > 0 && <div className="text-slate-600">{trip.stops.length} stop(s){openStop ? ' · stopped now' : ''}</div>}
      </div>
      {!ending ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {trip.paused
            ? <Button variant="secondary" onClick={() => queueDriverAction('trip.resume', { tripId: trip.id })}>Resume</Button>
            : <Button variant="secondary" onClick={async () => {
                const note = prompt('Reason for stopping (optional)') ?? undefined;
                queueDriverAction('trip.stop', { tripId: trip.id, note, ...(await getPosition(5000)) });
              }}>Log a stop</Button>}
          <Button onClick={() => setEnding(true)}>End trip</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Field label="Odometer at end (km)"><input className={inputCls} inputMode="numeric" value={odo} onChange={e => setOdo(e.target.value)} /></Field>
          <Field label="Odometer photo (optional)"><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} className="text-sm" /></Field>
          <Field label="Notes (optional)"><textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
          {o.error && <Alert tone="warn">{o.error}</Alert>}
          <div className="flex gap-2">
            <Button busy={o.busy} onClick={async () => {
              o.setBusy(true);
              const [pos, path] = await Promise.all([getPosition(), o.capture(photo)]);
              queueDriverAction('trip.end', { tripId: trip.id, odo: odo ? Number(odo) : undefined, notes, photo: path, ...pos });
              o.setBusy(false); setEnding(false);
            }}>Finish trip</Button>
            <Button variant="secondary" onClick={() => setEnding(false)}>Back</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function FuelForm({ online }: { online: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ litres: '', cost: '', odometer: '', station: '' });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);
  const o = useOdoPrompt(online);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  if (!open) return <Button variant="secondary" className="w-full" onClick={() => { setSaved(false); setOpen(true); }}>{saved ? 'Fuel recorded ✓ · Record more' : 'Record fuel'}</Button>;
  return (
    <Card title="Record fuel">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Litres"><input className={inputCls} inputMode="decimal" value={f.litres} onChange={set('litres')} /></Field>
          <Field label="Cost (₦)"><input className={inputCls} inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>
          <Field label="Odometer (km)"><input className={inputCls} inputMode="numeric" value={f.odometer} onChange={set('odometer')} /></Field>
          <Field label="Station"><input className={inputCls} value={f.station} onChange={set('station')} /></Field>
        </div>
        <Field label="Receipt photo (optional)"><input type="file" accept="image/*" capture="environment" onChange={e => setReceipt(e.target.files?.[0] ?? null)} className="text-sm" /></Field>
        {o.error && <Alert tone="warn">{o.error}</Alert>}
        <div className="flex gap-2">
          <Button busy={o.busy} disabled={!f.litres} onClick={async () => {
            o.setBusy(true);
            const path = await o.capture(receipt);
            queueDriverAction('fuel.add', { litres: Number(f.litres), cost: Number(f.cost || 0), odometer: f.odometer ? Number(f.odometer) : undefined, station: f.station, receipt: path });
            o.setBusy(false); setF({ litres: '', cost: '', odometer: '', station: '' }); setReceipt(null); setSaved(true); setOpen(false);
          }}>Save</Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>Back</Button>
        </div>
      </div>
    </Card>
  );
}
