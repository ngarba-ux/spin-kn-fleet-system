// Admin fleet operations: vehicles, tasks, maintenance, fuel, ending trips.
import { onCall } from 'firebase-functions/v2/https';
import { Transaction } from 'firebase-admin/firestore';
import { actor, dateOnly, db, fail, getSettings, Input, log, nowIso, reqTs, saveInline } from './common';
import { DriverDoc, FuelDoc, MaintenanceDoc, TaskDoc, TripDoc, VehicleDoc } from './models';
import { finishTrip } from './trips';

// Highest odometer reading we know for a vehicle.
export function latestOdo(v: VehicleDoc): number | null {
  const xs = [v.lastOdo, v.initialOdo, v.lastServiceOdo].filter((x): x is number => typeof x === 'number');
  return xs.length ? Math.max(...xs) : null;
}

export function checkOdo(v: VehicleDoc, odo: number | null) {
  if (odo === null) return;
  if (odo < 0 || odo > 5_000_000) fail('invalid-argument', 'Enter a realistic odometer reading.');
  const last = latestOdo(v);
  if (last !== null && odo < last) fail('invalid-argument', `Reading is lower than the last recorded odometer (${last.toLocaleString('en-GB')} km).`, { code: 'v_odoLow', last });
}

export function bumpOdo(tx: Transaction, vehicleId: string, v: VehicleDoc, odo: number | null | undefined) {
  if (typeof odo === 'number' && odo > (v.lastOdo ?? -1)) tx.update(db.doc(`vehicles/${vehicleId}`), { lastOdo: odo });
}

export function buildFuel(p: Input, v: VehicleDoc, vehicleId: string, driverId: string | null, enteredBy: string, ts: string, receipt: string | null): FuelDoc {
  const litres = p.num('litres') ?? 0, cost = p.num('cost') ?? 0;
  if (litres <= 0 || litres > 1000) fail('invalid-argument', 'Enter the litres (greater than zero).');
  if (cost < 0) fail('invalid-argument', 'Cost cannot be negative.');
  const odometer = p.num('odometer');
  checkOdo(v, odometer);
  return { driverId, vehicleId, ts, litres, cost, odometer, station: p.str('station', 120), receipt, enteredBy };
}

export const vehicleSave = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.str('id');
  const reg = p.req('reg', 'Registration', 40).toUpperCase();
  const interval = p.num('serviceIntervalKm');
  const fields: Partial<VehicleDoc> = {
    reg, assetId: p.str('assetId', 60), model: p.req('model', 'Model', 80), colour: p.str('colour', 40),
    engineNo: p.str('engineNo', 60), chassisNo: p.str('chassisNo', 60),
    insuranceExpiry: dateOnly(p.str('insuranceExpiry'), 'Insurance expiry'),
    roadworthinessExpiry: dateOnly(p.str('roadworthinessExpiry'), 'Roadworthiness expiry'),
    notes: p.str('notes', 1000), serviceIntervalKm: interval && interval > 0 ? interval : null,
  };
  return db.runTransaction(async tx => {
    const dup = await tx.get(db.collection('vehicles').where('reg', '==', reg).limit(2));
    if (dup.docs.some(d => d.id !== id)) fail('already-exists', 'Another vehicle already has this registration.');
    if (!id) {
      const ref = db.collection('vehicles').doc();
      const initialOdo = p.num('initialOdo');
      tx.set(ref, { ...fields, condition: 'ok', initialOdo, lastServiceOdo: p.num('lastServiceOdo') ?? initialOdo, lastOdo: initialOdo, driverId: null, activeTripId: null } as VehicleDoc);
      log(tx, me, 'Vehicle added', reg);
      return { id: ref.id };
    }
    const ref = db.doc(`vehicles/${id}`);
    if (!(await tx.get(ref)).exists) fail('not-found', 'Vehicle was not found.');
    if (p.has('lastServiceOdo')) fields.lastServiceOdo = p.num('lastServiceOdo');
    tx.update(ref, fields);
    log(tx, me, 'Vehicle updated', reg);
    return { id };
  });
});

export const vehicleCondition = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.req('id', 'Vehicle');
  const condition = p.oneOf('condition', 'Status', ['ok', 'maintenance', 'outOfService'] as const);
  return db.runTransaction(async tx => {
    const ref = db.doc(`vehicles/${id}`);
    const v = (await tx.get(ref)).data() as VehicleDoc | undefined;
    if (!v) fail('not-found', 'Vehicle was not found.');
    if (condition !== 'ok' && v.activeTripId) fail('failed-precondition', 'This vehicle is on a trip. It can be taken off the road when the trip ends.');
    tx.update(ref, { condition });
    log(tx, me, 'Vehicle status changed', `${v.reg} -> ${{ ok: 'In service', maintenance: 'Under maintenance', outOfService: 'Out of service' }[condition]}`);
    return { ok: true };
  });
});

export const vehicleServiced = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.req('id', 'Vehicle');
  return db.runTransaction(async tx => {
    const ref = db.doc(`vehicles/${id}`);
    const v = (await tx.get(ref)).data() as VehicleDoc | undefined;
    if (!v) fail('not-found', 'Vehicle was not found.');
    const last = latestOdo(v);
    const odo = p.num('odometer') ?? last;
    if (odo !== null && last !== null && odo < last) fail('invalid-argument', `Odometer is lower than the last recorded reading (${last.toLocaleString('en-GB')} km).`);
    tx.update(ref, { lastServiceOdo: odo, lastServiceDate: nowIso(), ...(odo !== null && odo > (v.lastOdo ?? -1) ? { lastOdo: odo } : {}) });
    tx.set(db.collection('maintenance').doc(), { vehicleId: id, ts: nowIso(), odometer: odo, cost: p.num('cost'), notes: p.str('notes', 1000), by: me.name } satisfies MaintenanceDoc);
    log(tx, me, 'Maintenance recorded', v.reg + (odo !== null ? ` @ ${odo.toLocaleString('en-GB')} km` : ''));
    return { ok: true };
  });
});

export const taskSave = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.str('id');
  const driverId = p.req('driverId', 'Driver');
  const s = await getSettings();
  return db.runTransaction(async tx => {
    const d = (await tx.get(db.doc(`drivers/${driverId}`))).data() as DriverDoc | undefined;
    if (!d) fail('not-found', 'Driver was not found.');
    const vehicleId = p.str('vehicleId') ?? d.vehicleId ?? null;
    if (vehicleId && !(await tx.get(db.doc(`vehicles/${vehicleId}`))).exists) fail('not-found', 'Vehicle was not found.');
    const fields = {
      driverId, vehicleId,
      purpose: p.req('purpose', 'Purpose', 300), origin: p.str('origin', 200) ?? s.defaultOrigin,
      destination: p.req('destination', 'Destination', 200),
      scheduledTs: reqTs(p.req('scheduledTs', 'Scheduled time'), 'Scheduled time').toISOString(),
      priority: p.oneOf('priority', 'Priority', ['high', 'medium', 'low'] as const, 'medium'),
      notes: p.str('notes', 1000),
    };
    if (!id) {
      const ref = db.collection('tasks').doc();
      tx.set(ref, { ...fields, status: 'scheduled', acknowledged: false, createdTs: nowIso(), createdBy: me.name } satisfies TaskDoc);
      log(tx, me, 'Task assigned', `${d.name} · ${fields.purpose}`);
      return { id: ref.id };
    }
    const ref = db.doc(`tasks/${id}`);
    const t = (await tx.get(ref)).data() as TaskDoc | undefined;
    if (!t) fail('not-found', 'Task was not found.');
    if (t.status !== 'scheduled') fail('failed-precondition', 'Only scheduled tasks can be edited.');
    tx.update(ref, { ...fields, ...(t.driverId !== driverId ? { acknowledged: false } : {}) });
    log(tx, me, 'Task updated', `${d.name} · ${fields.purpose}`);
    return { id };
  });
});

export const taskCancel = onCall(async req => {
  const me = actor(req, 'admin');
  const id = new Input(req.data).req('id', 'Task');
  return db.runTransaction(async tx => {
    const ref = db.doc(`tasks/${id}`);
    const t = (await tx.get(ref)).data() as TaskDoc | undefined;
    if (!t) fail('not-found', 'Task was not found.');
    if (t.status !== 'scheduled') fail('failed-precondition', 'Only tasks that have not started can be cancelled.');
    if (t.requestId) fail('failed-precondition', 'This task belongs to a trip request. Reassign or cancel it from the request.');
    tx.update(ref, { status: 'cancelled' });
    log(tx, me, 'Task cancelled', t.purpose);
    return { ok: true };
  });
});

export const tripForceEnd = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.req('id', 'Trip');
  const reason = p.req('reason', 'Reason', 500);
  const odo = p.num('odometer');
  return db.runTransaction(async tx => {
    const ref = db.doc(`trips/${id}`);
    const t = (await tx.get(ref)).data() as TripDoc | undefined;
    if (!t) fail('not-found', 'Trip was not found.');
    if (t.status !== 'inTransit') fail('failed-precondition', 'This trip has already ended.');
    if (odo !== null && t.startOdo != null && odo < t.startOdo) fail('invalid-argument', 'End odometer cannot be lower than the start reading.');
    const v = await finishTrip(tx, id, t, { ts: nowIso(), odo, notes: `Ended by office: ${reason}`, byName: me.name });
    tx.update(ref, { endedBy: me.name });
    log(tx, me, 'Trip ended by office', `${v?.reg ?? ''} · ${reason}`);
    return { ok: true };
  });
});

export const fuelAdminAdd = onCall({ memory: '512MiB' }, async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const vehicleId = p.req('vehicleId', 'Vehicle');
  const driverId = p.str('driverId');
  const ts = p.str('ts') ? reqTs(p.str('ts'), 'Date').toISOString() : nowIso();
  const receipt = await saveInline(p.obj('receipt'), 'uploads/office');
  return db.runTransaction(async tx => {
    const v = (await tx.get(db.doc(`vehicles/${vehicleId}`))).data() as VehicleDoc | undefined;
    if (!v) fail('not-found', 'Vehicle was not found.');
    if (driverId && !(await tx.get(db.doc(`drivers/${driverId}`))).exists) fail('not-found', 'Driver was not found.');
    const rec = buildFuel(p, v, vehicleId, driverId, me.name, ts, receipt);
    tx.set(db.collection('fuel').doc(), rec);
    bumpOdo(tx, vehicleId, v, rec.odometer);
    log(tx, me, 'Fuel recorded', `${v.reg} · ${rec.litres} L`);
    return { ok: true };
  });
});
