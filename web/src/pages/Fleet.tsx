// Vehicles and drivers. Admins edit through Cloud Functions; the SPC sees the
// same pages read-only.
import { FormEvent, useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { db, call } from '../firebase';
import { useCollection, useSettings, WithId } from '../data';
import { Driver, Settings, UserAccount, Vehicle } from '../types';
import {
  Alert, Badge, Button, Card, compactInputCls, cx, ExpiryBadge, expiryState, Field, fmtDate, fmtDT, inputCls, Modal, num, SearchInput, Spinner,
  TempPasswordModal, useAction,
} from '../ui';

type TempInfo = { email: string; tempPassword: string; name?: string };

// ================================================================ vehicles

function vehicleStatus(v: Vehicle): { label: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'slate' } {
  if (v.condition === 'maintenance') return { label: 'Under maintenance', tone: 'amber' };
  if (v.condition === 'outOfService') return { label: 'Out of service', tone: 'red' };
  if (v.activeTripId) return { label: 'On a trip', tone: 'blue' };
  if (v.driverId) return { label: 'Assigned', tone: 'slate' };
  return { label: 'Available', tone: 'green' };
}

function service(v: Vehicle, s: Settings) {
  const interval = v.serviceIntervalKm && v.serviceIntervalKm > 0 ? v.serviceIntervalKm : s.serviceIntervalKm;
  const since = v.lastOdo != null && v.lastServiceOdo != null ? Math.max(0, v.lastOdo - v.lastServiceOdo) : null;
  const state = since == null ? 'ok' : since >= interval ? 'due' : since >= interval * 0.9 ? 'soon' : 'ok';
  return { interval, since, state };
}

export function VehiclesPage({ canEdit }: { canEdit: boolean }) {
  const vehicles = useCollection<Vehicle>(collection(db, 'vehicles'), 'vehicles');
  const drivers = useCollection<Driver>(collection(db, 'drivers'), 'drivers');
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<WithId<Vehicle> | 'new' | null>(null);
  const [servicing, setServicing] = useState<WithId<Vehicle> | null>(null);

  const rows = useMemo(() => vehicles.data
    .filter(v => !q || [v.reg, v.model, v.assetId, v.colour].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.reg.localeCompare(b.reg)), [vehicles.data, q]);
  const driverOf = (id?: string | null) => drivers.data.find(d => d.id === id)?.name;

  if (vehicles.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search registration, model…" />
        {canEdit && <Button onClick={() => setEditing('new')}>Add vehicle</Button>}
      </div>
      {rows.length === 0 ? (
        <Card><p className="text-sm text-slate-500">{vehicles.data.length ? 'No vehicles match.' : 'No vehicles yet. Add the first one.'}</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map(v => {
            const st = vehicleStatus(v), sv = service(v, settings);
            return (
              <Card key={v.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold">{v.reg}</div>
                    <div className="text-sm text-slate-600">{v.model}{v.colour ? ` · ${v.colour}` : ''}{v.assetId ? ` · ${v.assetId}` : ''}</div>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-500">Driver</dt><dd>{driverOf(v.driverId) ?? '—'}</dd>
                  <dt className="text-slate-500">Odometer</dt><dd>{num(v.lastOdo)} km</dd>
                  <dt className="text-slate-500">Since service</dt>
                  <dd className={cx(sv.state === 'due' && 'font-semibold text-red-700', sv.state === 'soon' && 'font-semibold text-amber-700')}>
                    {sv.since == null ? '—' : `${num(sv.since)} / ${num(sv.interval)} km`}{sv.state === 'due' ? ' · service due' : sv.state === 'soon' ? ' · due soon' : ''}
                  </dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <ExpiryBadge label="Insurance" date={v.insuranceExpiry} warnDays={settings.expiryWarnDays} />
                  <ExpiryBadge label="Roadworthiness" date={v.roadworthinessExpiry} warnDays={settings.expiryWarnDays} />
                </div>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <Button variant="secondary" onClick={() => setEditing(v)}>Edit</Button>
                    <Button variant="secondary" onClick={() => setServicing(v)}>Record service</Button>
                    <ConditionSelect v={v} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && <VehicleForm v={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {servicing && <ServiceForm v={servicing} onClose={() => setServicing(null)} />}
    </div>
  );
}

function ConditionSelect({ v }: { v: WithId<Vehicle> }) {
  const { busy, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <select className={cx(compactInputCls, 'py-2')} value={v.condition} disabled={busy}
        onChange={e => { const condition = e.target.value; run(() => call('vehicleCondition', { id: v.id, condition })); }}>
        <option value="ok">In service</option>
        <option value="maintenance">Under maintenance</option>
        <option value="outOfService">Out of service</option>
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

function VehicleForm({ v, onClose }: { v: WithId<Vehicle> | null; onClose: () => void }) {
  const [f, setF] = useState({
    reg: v?.reg ?? '', model: v?.model ?? '', assetId: v?.assetId ?? '', colour: v?.colour ?? '',
    engineNo: v?.engineNo ?? '', chassisNo: v?.chassisNo ?? '',
    insuranceExpiry: v?.insuranceExpiry ?? '', roadworthinessExpiry: v?.roadworthinessExpiry ?? '',
    serviceIntervalKm: v?.serviceIntervalKm ? String(v.serviceIntervalKm) : '', notes: v?.notes ?? '',
    initialOdo: '', lastServiceOdo: v?.lastServiceOdo != null ? String(v.lastServiceOdo) : '',
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await call('vehicleSave', { ...f, id: v?.id, ...(v ? { initialOdo: undefined } : {}), ...(v && !f.lastServiceOdo ? { lastServiceOdo: undefined } : {}) });
      onClose();
    });
  };
  return (
    <Modal wide title={v ? `Edit ${v.reg}` : 'Add vehicle'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} type="submit" form="vehicle-form">Save</Button></>}>
      <form id="vehicle-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Registration *"><input className={inputCls} value={f.reg} onChange={set('reg')} required /></Field>
        <Field label="Make & model *"><input className={inputCls} value={f.model} onChange={set('model')} required placeholder="Toyota Hilux 2.4" /></Field>
        <Field label="Asset ID"><input className={inputCls} value={f.assetId} onChange={set('assetId')} /></Field>
        <Field label="Colour"><input className={inputCls} value={f.colour} onChange={set('colour')} /></Field>
        <Field label="Engine no."><input className={inputCls} value={f.engineNo} onChange={set('engineNo')} /></Field>
        <Field label="Chassis no."><input className={inputCls} value={f.chassisNo} onChange={set('chassisNo')} /></Field>
        <Field label="Insurance expires"><input className={inputCls} type="date" value={f.insuranceExpiry} onChange={set('insuranceExpiry')} /></Field>
        <Field label="Roadworthiness expires"><input className={inputCls} type="date" value={f.roadworthinessExpiry} onChange={set('roadworthinessExpiry')} /></Field>
        {!v && <Field label="Current odometer (km)"><input className={inputCls} inputMode="numeric" value={f.initialOdo} onChange={set('initialOdo')} /></Field>}
        <Field label="Odometer at last service (km)" hint={v ? undefined : 'Leave blank to use the current reading.'}>
          <input className={inputCls} inputMode="numeric" value={f.lastServiceOdo} onChange={set('lastServiceOdo')} />
        </Field>
        <Field label="Service every (km)" hint="Blank = the default from Settings."><input className={inputCls} inputMode="numeric" value={f.serviceIntervalKm} onChange={set('serviceIntervalKm')} /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><textarea className={inputCls} rows={2} value={f.notes} onChange={set('notes')} /></Field></div>
      </form>
      {v && <p className="text-xs text-slate-500">Assign a driver from the Drivers page.</p>}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

function ServiceForm({ v, onClose }: { v: WithId<Vehicle>; onClose: () => void }) {
  const [f, setF] = useState({ odometer: v.lastOdo != null ? String(v.lastOdo) : '', cost: '', notes: '' });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={`Record service · ${v.reg}`} sub={v.lastServiceDate ? `Last service ${fmtDT(v.lastServiceDate)}` : undefined} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => run(async () => { await call('vehicleServiced', { id: v.id, ...f }); onClose(); })}>Save</Button></>}>
      <Field label="Odometer at service (km)"><input className={inputCls} inputMode="numeric" value={f.odometer} onChange={set('odometer')} /></Field>
      <Field label="Cost (₦)"><input className={inputCls} inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>
      <Field label="Work done"><textarea className={inputCls} rows={3} value={f.notes} onChange={set('notes')} /></Field>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

// ================================================================ drivers

export function DriversPage({ canEdit }: { canEdit: boolean }) {
  const drivers = useCollection<Driver>(collection(db, 'drivers'), 'drivers');
  const vehicles = useCollection<Vehicle>(collection(db, 'vehicles'), 'vehicles');
  const users = useCollection<UserAccount>(collection(db, 'users'), 'users');
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<WithId<Driver> | 'new' | null>(null);
  const [temp, setTemp] = useState<TempInfo | null>(null);
  const { busy, error, run } = useAction();

  const rows = drivers.data
    .filter(d => !q || [d.name, d.email, d.driverNo, d.phone].join(' ').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const userOf = (id: string) => users.data.find(u => u.id === id);
  const vehicleOf = (id?: string | null) => vehicles.data.find(v => v.id === id);

  const toggle = (d: WithId<Driver>, active: boolean) => {
    if (!confirm(active ? `Deactivate ${d.name}? They will be signed out and cannot sign in.` : `Reactivate ${d.name}?`)) return;
    run(() => call('accountToggle', { id: d.id }));
  };
  const reset = (d: WithId<Driver>) => {
    if (!confirm(`Reset ${d.name}'s password? They will be signed out and get a new temporary password.`)) return;
    run(async () => setTemp({ ...(await call<TempInfo>('accountResetPassword', { id: d.id })), name: d.name }));
  };

  if (drivers.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, phone…" />
        {canEdit && <Button onClick={() => setEditing('new')}>Add driver</Button>}
      </div>
      {error && <Alert>{error}</Alert>}
      {rows.length === 0 ? (
        <Card><p className="text-sm text-slate-500">{drivers.data.length ? 'No drivers match.' : 'No drivers yet. Add the first one.'}</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map(d => {
            const u = userOf(d.id), v = vehicleOf(d.vehicleId), active = u?.status === 'active';
            return (
              <Card key={d.id} className={active ? '' : 'opacity-70'}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold">{d.name}</div>
                    <div className="text-sm text-slate-600">{d.driverNo ? `${d.driverNo} · ` : ''}{d.phone ?? ''}</div>
                    <div className="text-xs text-slate-500">{d.email}</div>
                  </div>
                  <Badge tone={active ? 'green' : 'slate'}>{active ? (u?.mustChangePassword ? 'Not signed in yet' : 'Active') : 'Inactive'}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-500">Vehicle</dt><dd>{v ? `${v.reg} · ${v.model}` : '—'}</dd>
                  <dt className="text-slate-500">Licence</dt><dd>{d.licenceNo ?? '—'}{d.licenceExpiry ? ` · to ${fmtDate(d.licenceExpiry)}` : ''}</dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <ExpiryBadge label="Licence" date={d.licenceExpiry} warnDays={settings.expiryWarnDays} />
                  {d.contract !== 'active' && <Badge tone="red">Contract {d.contract}</Badge>}
                </div>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <Button variant="secondary" onClick={() => setEditing(d)}>Edit</Button>
                    <Button variant="ghost" busy={busy} onClick={() => reset(d)}>Reset password</Button>
                    <Button variant="ghost" busy={busy} onClick={() => toggle(d, active)}>{active ? 'Deactivate' : 'Reactivate'}</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && (
        <DriverForm d={editing === 'new' ? null : editing} vehicles={vehicles.data} drivers={drivers.data}
          onClose={() => setEditing(null)} onCreated={info => { setEditing(null); setTemp(info); }} />
      )}
      {temp && <TempPasswordModal info={temp} onClose={() => setTemp(null)} />}
    </div>
  );
}

function DriverForm({ d, vehicles, drivers, onClose, onCreated }: {
  d: WithId<Driver> | null; vehicles: WithId<Vehicle>[]; drivers: WithId<Driver>[];
  onClose: () => void; onCreated: (info: TempInfo) => void;
}) {
  const [f, setF] = useState({
    name: d?.name ?? '', email: d?.email ?? '', driverNo: d?.driverNo ?? '', phone: d?.phone ?? '',
    licenceNo: d?.licenceNo ?? '', licenceExpiry: d?.licenceExpiry ?? '', contract: d?.contract ?? 'active', vehicleId: d?.vehicleId ?? '',
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const holder = f.vehicleId ? drivers.find(x => x.vehicleId === f.vehicleId && x.id !== d?.id) : undefined;
  const lic = expiryState(f.licenceExpiry, 30);

  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await call<{ tempPassword?: string; email?: string }>('driverSave', { ...f, id: d?.id, vehicleId: f.vehicleId || null });
      if (res.tempPassword) onCreated({ tempPassword: res.tempPassword, email: res.email ?? f.email, name: f.name });
      else onClose();
    });
  };

  return (
    <Modal wide title={d ? `Edit ${d.name}` : 'Add driver'} sub={d ? undefined : 'Creates their sign-in. You will see a temporary password to give them.'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} type="submit" form="driver-form">{d ? 'Save' : 'Create driver'}</Button></>}>
      <form id="driver-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name *"><input className={inputCls} value={f.name} onChange={set('name')} required /></Field>
        <Field label="Email (sign-in) *"><input className={inputCls} type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Driver no."><input className={inputCls} value={f.driverNo} onChange={set('driverNo')} placeholder="DRV-001" /></Field>
        <Field label="Phone"><input className={inputCls} type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Licence no."><input className={inputCls} value={f.licenceNo} onChange={set('licenceNo')} /></Field>
        <Field label="Licence expires"><input className={inputCls} type="date" value={f.licenceExpiry} onChange={set('licenceExpiry')} /></Field>
        <Field label="Contract">
          <select className={inputCls} value={f.contract} onChange={set('contract')}>
            <option value="active">Active</option><option value="expired">Expired</option><option value="terminated">Terminated</option>
          </select>
        </Field>
        <Field label="Assigned vehicle">
          <select className={inputCls} value={f.vehicleId} onChange={set('vehicleId')}>
            <option value="">No vehicle</option>
            {[...vehicles].sort((a, b) => a.reg.localeCompare(b.reg)).map(v => (
              <option key={v.id} value={v.id}>{v.reg} · {v.model}{v.condition !== 'ok' ? ' (off the road)' : ''}</option>
            ))}
          </select>
        </Field>
      </form>
      {holder && <Alert tone="warn">{holder.name} currently has this vehicle. Saving moves it to {f.name || 'this driver'}.</Alert>}
      {lic === 'expired' && <Alert tone="warn">This licence has expired. The driver can't be assigned trips that end after the expiry date.</Alert>}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
