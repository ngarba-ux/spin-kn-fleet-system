// Admin (Logistics & Transport) and SPC screens. Data is live: Firestore
// listeners push changes, so there is no polling.
import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { db, call, CallError } from '../firebase';
import { Role, signOutNow, useAuth } from '../auth';
import { useCollection, useOnline, WithId } from '../data';
import { Driver, Task, Trip, TripRequest, Vehicle } from '../types';
import { Alert, Button, Card, cx, Field, fmtDT, inputCls, Logo, Spinner, StatusBadge, useAction } from '../ui';
import { DriversPage, VehiclesPage } from './Fleet';
import { StaffPage } from './People';
import { FuelPage, TasksPage, TripsPage } from './Ops';

const NAV: Record<'admin' | 'spc', { id: string; label: string }[]> = {
  admin: [
    { id: 'dashboard', label: 'Dashboard' }, { id: 'requests', label: 'Trip requests' },
    { id: 'vehicles', label: 'Vehicles' }, { id: 'drivers', label: 'Drivers' }, { id: 'tasks', label: 'Tasks' },
    { id: 'trips', label: 'Trips' }, { id: 'fuel', label: 'Fuel & service' }, { id: 'staff', label: 'Staff & QR' },
    { id: 'users', label: 'User accounts' }, { id: 'reports', label: 'Reports' }, { id: 'activity', label: 'Activity log' },
    { id: 'emails', label: 'Email log' }, { id: 'settings', label: 'Settings' },
  ],
  spc: [
    { id: 'requests', label: 'Trip requests' }, { id: 'dashboard', label: 'Dashboard' }, { id: 'vehicles', label: 'Vehicles' },
    { id: 'drivers', label: 'Drivers' }, { id: 'trips', label: 'Trips' }, { id: 'fuel', label: 'Fuel & service' },
    { id: 'reports', label: 'Reports' }, { id: 'activity', label: 'Activity log' },
  ],
};

export function OfficeApp({ page, id }: { page: string; id: string | null }) {
  const { session } = useAuth();
  const role = session!.role as 'admin' | 'spc';
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const nav = NAV[role];
  const current = nav.find(n => n.id === page) ?? nav[0];

  return (
    <div className="min-h-dvh lg:flex">
      <aside className={cx('fixed inset-y-0 left-0 z-20 w-64 transform bg-white p-4 shadow-lg ring-1 ring-slate-200 transition lg:static lg:translate-x-0 lg:shadow-none', open ? 'translate-x-0' : '-translate-x-full')}>
        <Logo small />
        <div className="mt-1 text-xs text-slate-500">{role === 'admin' ? 'Logistics & Transport' : 'State Project Coordinator'}</div>
        <nav className="mt-6 space-y-0.5">
          {nav.map(n => (
            <a key={n.id} href={`#/${n.id}`} onClick={() => setOpen(false)}
              className={cx('block rounded-lg px-3 py-2 text-sm', n.id === current.id ? 'bg-emerald-50 font-semibold text-emerald-900' : 'text-slate-700 hover:bg-slate-50')}>{n.label}</a>
          ))}
        </nav>
        <div className="mt-6 border-t border-slate-100 pt-4 text-sm">
          <div className="font-medium">{session!.user.displayName}</div>
          <div className="truncate text-xs text-slate-500">{session!.user.email}</div>
          <Button variant="ghost" className="mt-2 px-0" onClick={signOutNow}>Sign out</Button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-10 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <main className="min-w-0 flex-1 px-4 py-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="secondary" className="lg:hidden" onClick={() => setOpen(true)}>Menu</Button>
          <h1 className="text-xl font-bold">{current.label}</h1>
        </div>
        {!online && <div className="mb-4"><Alert tone="warn">You are offline. Showing saved data; changes need a connection.</Alert></div>}
        {current.id === 'dashboard' && <Dashboard />}
        {current.id === 'requests' && <Requests role={role} selectedId={id} />}
        {current.id === 'vehicles' && <VehiclesPage canEdit={role === 'admin'} />}
        {current.id === 'drivers' && <DriversPage canEdit={role === 'admin'} />}
        {current.id === 'staff' && role === 'admin' && <StaffPage />}
        {current.id === 'trips' && <TripsPage isAdmin={role === 'admin'} selectedId={id} />}
        {current.id === 'tasks' && role === 'admin' && <TasksPage />}
        {current.id === 'fuel' && <FuelPage isAdmin={role === 'admin'} />}
        {!['dashboard', 'requests', 'vehicles', 'drivers', 'staff', 'trips', 'tasks', 'fuel'].includes(current.id) && (
          <Card><p className="text-sm text-slate-600">This page is being moved to the new system. Its server functions are ready; the screen comes in the next phase.</p></Card>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard

function Dashboard() {
  const requests = useCollection<TripRequest>(query(collection(db, 'requests'), where('status', 'in', ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED'])), 'dash-req');
  const vehicles = useCollection<Vehicle>(collection(db, 'vehicles'), 'dash-veh');
  const trips = useCollection<Trip>(query(collection(db, 'trips'), where('status', '==', 'inTransit')), 'dash-trips');
  if (requests.loading || vehicles.loading) return <Spinner />;
  const count = (s: string[]) => requests.data.filter(r => s.includes(r.status)).length;
  const stats = [
    { label: 'Needs the office', value: count(['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'APPROVED']) },
    { label: 'Awaiting SPC', value: count(['FORWARDED_TO_SPC']) },
    { label: 'Vehicles on the road', value: trips.data.length },
    { label: 'Vehicles available', value: vehicles.data.filter(v => v.condition === 'ok' && !v.activeTripId).length },
    { label: 'Off the road', value: vehicles.data.filter(v => v.condition !== 'ok').length },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {stats.map(s => (
        <Card key={s.label}><div className="text-3xl font-bold text-emerald-900">{s.value}</div><div className="text-sm text-slate-600">{s.label}</div></Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- requests

const FILTERS: Record<string, { label: string; statuses: string[] | null }> = {
  action: { label: 'Needs action', statuses: null },
  open: { label: 'All open', statuses: ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'RETURNED_FOR_CORRECTION', 'FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED'] },
  done: { label: 'Finished', statuses: ['TRIP_COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED'] },
};

function needsAction(role: Role, r: TripRequest) {
  return role === 'spc' ? r.status === 'FORWARDED_TO_SPC' : ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'APPROVED', 'TRIP_COMPLETED'].includes(r.status);
}

function Requests({ role, selectedId }: { role: 'admin' | 'spc'; selectedId: string | null }) {
  const [filter, setFilter] = useState('action');
  // The 300 most recent requests; older ones come with the reports page.
  const all = useCollection<TripRequest>(query(collection(db, 'requests'), orderBy('createdTs', 'desc'), limit(300)), 'requests');
  const list = useMemo(() => {
    const f = FILTERS[filter];
    return all.data.filter(r => (f.statuses ? f.statuses.includes(r.status) : needsAction(role, r)));
  }, [all.data, filter, role]);
  const selected = all.data.find(r => r.id === selectedId) ?? null;

  if (all.loading) return <Spinner />;
  if (all.error) return <Alert>{all.error}</Alert>;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(FILTERS).map(([k, f]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('rounded-full px-3 py-1 text-sm', filter === k ? 'bg-emerald-800 text-white' : 'bg-white ring-1 ring-slate-300')}>{f.label}</button>
          ))}
        </div>
        {list.length === 0 ? <Card><p className="text-sm text-slate-500">Nothing here.</p></Card> : (
          <ul className="space-y-2">
            {list.map(r => (
              <li key={r.id}>
                <a href={`#/requests/${r.id}`} className={cx('block rounded-xl bg-white p-3 ring-1 hover:ring-emerald-700', r.id === selectedId ? 'ring-2 ring-emerald-700' : 'ring-slate-200')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.ref}{r.priority === 'urgent' && <span className="ml-2 text-xs font-bold text-red-700">URGENT</span>}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-sm">{r.staff.fullName} · {r.destination}</div>
                  <div className="text-xs text-slate-500">{fmtDT(r.departTs)}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected ? <RequestDetail role={role} r={selected} /> : <Card><p className="text-sm text-slate-500">Select a request to see its details.</p></Card>}
    </div>
  );
}

function RequestDetail({ role, r }: { role: 'admin' | 'spc'; r: WithId<TripRequest> }) {
  const drivers = useCollection<Driver>(collection(db, 'drivers'), 'drivers');
  const vehicles = useCollection<Vehicle>(collection(db, 'vehicles'), 'vehicles');
  const task = useCollection<Task>(query(collection(db, 'tasks'), where('requestId', '==', r.id)), 'task-' + r.id);
  const { busy, error, setError, run } = useAction();
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [driverId, setDriverId] = useState('');
  const [remark, setRemark] = useState('');

  const act = (type: string, extra: Record<string, unknown> = {}, ask?: string) => {
    let comment: string | null = null;
    if (ask) { comment = prompt(ask); if (!comment) return; }
    setConflicts(null);
    run(async () => {
      try { await call('requestAction', { type, id: r.id, comment, ...extra }); setDriverId(''); setRemark(''); }
      catch (e) {
        const d = (e as CallError).details as { code?: string; conflicts?: string[] } | undefined;
        if (d?.code === 'conflict') { setConflicts(d.conflicts ?? []); return; }
        throw e;
      }
    });
  };

  const is = (...s: string[]) => s.includes(r.status);
  const nameOf = (id?: string | null) => drivers.data.find(d => d.id === id)?.name ?? '-';
  const regOf = (id?: string | null) => vehicles.data.find(v => v.id === id)?.reg ?? '-';

  return (
    <Card title={r.ref} actions={<StatusBadge status={r.status} />}>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-slate-500">Requested by</dt><dd>{r.staff.fullName} · {r.staff.designation}{r.staff.phone ? ` · ${r.staff.phone}` : ''}</dd>
        <dt className="text-slate-500">Purpose</dt><dd>{r.purpose}</dd>
        <dt className="text-slate-500">Destination</dt><dd>{r.destination}</dd>
        <dt className="text-slate-500">Component</dt><dd>{r.component}</dd>
        <dt className="text-slate-500">Departure</dt><dd>{fmtDT(r.departTs)}</dd>
        <dt className="text-slate-500">Return</dt><dd>{fmtDT(r.returnTs)}</dd>
        <dt className="text-slate-500">Passengers</dt><dd>{r.passengers}{r.passengerList.length ? `: ${r.passengerList.map(p => p.name).join(', ')}` : ''}</dd>
        <dt className="text-slate-500">Vehicle wanted</dt><dd>{r.vehicle}</dd>
        {r.priority === 'urgent' && <><dt className="font-semibold text-red-700">Urgent</dt><dd>{r.urgentReason}</dd></>}
        {r.remarks && <><dt className="text-slate-500">Remarks</dt><dd>{r.remarks}</dd></>}
        {r.proposedDriverId && <><dt className="text-slate-500">Proposed driver</dt><dd>{nameOf(r.proposedDriverId)}</dd></>}
        {r.dispatchDriverId && <><dt className="text-slate-500">Assigned</dt><dd>{nameOf(r.dispatchDriverId)} · {regOf(r.dispatchVehicleId)}{task.data[0] ? ` · task ${task.data[0].status}` : ''}</dd></>}
      </dl>

      <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
        {role === 'admin' && is('SUBMITTED') && <Button variant="secondary" busy={busy} onClick={() => act('ack')}>Acknowledge</Button>}
        {role === 'admin' && is('SUBMITTED', 'ACKNOWLEDGED') && <Button variant="secondary" busy={busy} className="ml-2" onClick={() => act('review')}>Mark under review</Button>}

        {role === 'admin' && is('SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW') && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-semibold">Forward to SPC</div>
            <Field label="Propose a driver (optional)"><DriverSelect drivers={drivers.data} vehicles={vehicles.data} value={driverId} onChange={setDriverId} /></Field>
            <Field label="Remark (optional)"><input className={inputCls} value={remark} onChange={e => setRemark(e.target.value)} /></Field>
            <Button busy={busy} onClick={() => act('forward', { driverId: driverId || null, remark })}>Forward to SPC</Button>
          </div>
        )}

        {role === 'spc' && is('FORWARDED_TO_SPC') && (
          <div className="flex flex-wrap gap-2">
            <Button busy={busy} onClick={() => act('approve')}>Approve</Button>
            <Button variant="danger" busy={busy} onClick={() => act('reject', {}, 'Reason for declining:')}>Decline</Button>
          </div>
        )}

        {role === 'admin' && is('APPROVED', 'DRIVER_ASSIGNED') && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-semibold">{is('APPROVED') ? 'Assign vehicle & driver' : 'Change assignment'}</div>
            <DriverSelect drivers={drivers.data} vehicles={vehicles.data} value={driverId} onChange={setDriverId} />
            <Button busy={busy} disabled={!driverId} onClick={() => act('dispatch', { driverId })}>Assign</Button>
          </div>
        )}

        {conflicts && (
          <Alert tone="warn">
            <div className="font-semibold">Scheduling conflict</div>
            <ul className="ml-4 list-disc">{conflicts.map(c => <li key={c}>{c}</li>)}</ul>
            <Button variant="secondary" className="mt-2" busy={busy} onClick={() => {
              const type = is('APPROVED', 'DRIVER_ASSIGNED') ? 'dispatch' : 'forward';
              act(type, { driverId: driverId || null, remark, force: true });
            }}>Continue anyway</Button>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          {(role === 'admin' ? is('SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'FORWARDED_TO_SPC', 'APPROVED') : is('FORWARDED_TO_SPC')) &&
            <Button variant="secondary" busy={busy} onClick={() => act('return', {}, 'What should the requester correct?')}>Return for correction</Button>}
          {role === 'admin' && is('TRIP_COMPLETED') && <Button busy={busy} onClick={() => act('close')}>Close request</Button>}
          {role === 'admin' && is('SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'RETURNED_FOR_CORRECTION', 'FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED') &&
            <Button variant="ghost" busy={busy} onClick={() => act('cancel', {}, 'Reason for cancelling:')}>Cancel request</Button>}
        </div>
        {error && <Alert>{error}</Alert>}
        {error && <Button variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="mb-2 text-sm font-semibold">History</div>
        <ol className="space-y-2 text-sm">
          {[...r.history].reverse().map((h, i) => (
            <li key={i}><span className="font-medium">{h.action.replace(/_/g, ' ').toLowerCase()}</span> · {h.actor} · <span className="text-slate-500">{fmtDT(h.ts)}</span>{h.comment && <div className="text-slate-600">{h.comment}</div>}</li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function DriverSelect({ drivers, vehicles, value, onChange }: { drivers: WithId<Driver>[]; vehicles: WithId<Vehicle>[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Choose a driver…</option>
      {drivers.filter(d => d.contract === 'active').map(d => {
        const v = vehicles.find(x => x.id === d.vehicleId);
        return <option key={d.id} value={d.id}>{d.name}{v ? ` · ${v.reg}${v.condition !== 'ok' ? ' (off the road)' : ''}` : ' · no vehicle'}</option>;
      })}
    </select>
  );
}
