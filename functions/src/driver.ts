// Driver actions arrive as driverActions/{clientId} documents. The Firestore SDK
// queues them on the phone while offline and uploads them in order; this
// trigger applies each driver's pending actions strictly by `seq`, one
// transaction per action, so a "stop" can never be applied before its "start".
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { Actor, db, fail, Input, log, nowIso, parseTs } from './common';
import { DriverActionDoc, DriverDoc, TaskDoc, TripDoc, VehicleDoc } from './models';
import { buildFuel, bumpOdo, checkOdo } from './fleet';
import { finishTrip } from './trips';

export const onDriverAction = onDocumentCreated({ document: 'driverActions/{id}', retry: true }, async event => {
  const data = event.data?.data() as DriverActionDoc | undefined;
  if (!data) return;
  // Give up retrying infrastructure failures after a day.
  if (Date.now() - new Date(event.time).getTime() > 86400_000) return;
  await processQueue(data.driverId);
});

async function processQueue(driverId: string) {
  for (let i = 0; i < 100; i++) {
    const next = await db.collection('driverActions')
      .where('driverId', '==', driverId).where('state', '==', 'pending').orderBy('seq').limit(1).get();
    if (next.empty) return;
    const ref = next.docs[0].ref;
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const a = snap.data() as DriverActionDoc | undefined;
        if (!a || a.state !== 'pending') return;
        await apply(tx, ref.id, a);
        tx.update(ref, { state: 'applied', error: null, appliedTs: nowIso() });
      });
    } catch (e) {
      if (!(e instanceof HttpsError)) throw e;   // infrastructure error: let the trigger retry
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (snap.get('state') === 'pending') tx.update(ref, { state: 'rejected', error: e.message, appliedTs: nowIso() });
      });
    }
  }
}

// Offline actions keep the time they happened, within sane bounds.
function clientTs(ts: string): string {
  const d = parseTs(ts);
  const now = Date.now();
  if (!d || d.getTime() > now + 5 * 60_000 || d.getTime() < now - 14 * 86400_000) return nowIso();
  return d.toISOString();
}

// Photos are uploaded straight to Storage by the phone; only accept paths in
// the driver's own folder.
function photoPath(p: Input, k: string, driverId: string): string | null {
  const path = p.str(k, 300);
  return path && path.startsWith(`uploads/drivers/${driverId}/`) && !path.includes('..') ? path : null;
}

async function myActiveTrip(tx: Transaction, driverId: string, tripId: string | null): Promise<{ ref: DocumentReference; t: TripDoc }> {
  if (!tripId) fail('invalid-argument', 'Trip is required.');
  const ref = db.doc(`trips/${tripId}`);
  const t = (await tx.get(ref)).data() as TripDoc | undefined;
  if (!t) fail('not-found', 'Trip was not found.');
  if (t.driverId !== driverId) fail('permission-denied', 'This trip is not yours.');
  if (t.status !== 'inTransit') fail('failed-precondition', 'This trip has already ended.');
  return { ref, t };
}

async function apply(tx: Transaction, actionId: string, a: DriverActionDoc) {
  const uid = a.driverId;
  const p = new Input(a.payload);
  const ts = clientTs(a.ts);
  const driver = (await tx.get(db.doc(`drivers/${uid}`))).data() as DriverDoc | undefined;
  if (!driver) fail('failed-precondition', 'Your account is not linked to a driver record.');
  const me: Actor = { uid, role: 'driver', name: driver.name };

  switch (a.type) {
    case 'trip.start': {
      const busy = await tx.get(db.collection('trips').where('driverId', '==', uid).where('status', '==', 'inTransit').limit(1));
      if (!busy.empty) fail('failed-precondition', 'You already have a trip in progress.');
      const taskId = p.str('taskId');
      let task: TaskDoc | null = null;
      if (taskId) {
        task = (await tx.get(db.doc(`tasks/${taskId}`))).data() as TaskDoc | undefined ?? null;
        if (!task) fail('not-found', 'Task was not found.');
        if (task.driverId !== uid) fail('permission-denied', 'This task is not assigned to you.');
        if (task.status !== 'scheduled') fail('failed-precondition', 'This task is no longer open (it may have been cancelled).');
      }
      const vehicleId = task?.vehicleId ?? p.str('vehicleId') ?? driver.vehicleId;
      if (!vehicleId) fail('failed-precondition', 'You need an assigned vehicle to start a trip.');
      if (vehicleId !== driver.vehicleId && task?.vehicleId !== vehicleId) fail('permission-denied', 'You can only drive a vehicle you are assigned to.');
      const vRef = db.doc(`vehicles/${vehicleId}`);
      const v = (await tx.get(vRef)).data() as VehicleDoc | undefined;
      if (!v) fail('not-found', 'Vehicle was not found.');
      if (v.condition !== 'ok') fail('failed-precondition', `${v.reg} is marked as not in service. Contact the fleet office.`);
      if (v.activeTripId) fail('failed-precondition', `${v.reg} is already on another trip.`);
      const odo = p.num('odo');
      checkOdo(v, odo);

      const tripId = 't-' + actionId;
      tx.set(db.doc(`trips/${tripId}`), {
        driverId: uid, vehicleId, taskId: taskId ?? null, requestId: task?.requestId ?? null,
        status: 'inTransit', paused: false, startTs: ts, startLat: p.num('lat'), startLng: p.num('lng'), startOdo: odo,
        startPhoto: photoPath(p, 'photo', uid), notes: p.str('notes', 1000), stops: [],
      } satisfies TripDoc);
      tx.update(vRef, { activeTripId: tripId, ...(odo !== null && odo > (v.lastOdo ?? -1) ? { lastOdo: odo } : {}) });
      if (taskId && task) {
        tx.update(db.doc(`tasks/${taskId}`), { status: 'inProgress', tripId, acknowledged: true, acknowledgedTs: task.acknowledgedTs ?? ts });
        if (task.requestId) tx.set(db.doc(`requests/${task.requestId}`), { tripStarted: true }, { merge: true });
      }
      log(tx, me, task ? 'Trip initiated from task' : 'Trip started', v.reg + (task ? ` · ${task.purpose}` : ''));
      return;
    }

    case 'trip.stop': {
      const { ref, t } = await myActiveTrip(tx, uid, p.str('tripId'));
      if (t.paused) fail('failed-precondition', 'This trip is already stopped.');
      const note = p.str('note', 300);
      tx.update(ref, { paused: true, stops: [...t.stops, { id: 's-' + actionId, startTs: ts, endTs: null, lat: p.num('lat'), lng: p.num('lng'), note }] });
      log(tx, me, 'Stop logged', note ?? '');
      return;
    }

    case 'trip.resume': {
      const { ref, t } = await myActiveTrip(tx, uid, p.str('tripId'));
      tx.update(ref, { paused: false, stops: t.stops.map(s => (s.endTs ? s : { ...s, endTs: ts })) });
      log(tx, me, 'Trip resumed', '');
      return;
    }

    case 'trip.end': {
      const { ref, t } = await myActiveTrip(tx, uid, p.str('tripId'));
      const odo = p.num('odo');
      if (odo !== null && t.startOdo != null && odo < t.startOdo)
        fail('invalid-argument', `End reading is lower than the start reading (${t.startOdo.toLocaleString('en-GB')} km).`);
      if (odo !== null && odo - (t.startOdo ?? odo) > 3000) fail('invalid-argument', 'That distance looks too long for one trip. Check the odometer reading.');
      const v = await finishTrip(tx, ref.id, t, {
        ts, lat: p.num('lat'), lng: p.num('lng'), odo, notes: p.str('notes', 1000), photo: photoPath(p, 'photo', uid), byName: driver.name,
      });
      log(tx, me, 'Trip completed', v?.reg ?? '');
      return;
    }

    case 'fuel.add': {
      const vehicleId = p.str('vehicleId') ?? driver.vehicleId;
      if (!vehicleId) fail('failed-precondition', 'You need an assigned vehicle to record fuel.');
      const v = (await tx.get(db.doc(`vehicles/${vehicleId}`))).data() as VehicleDoc | undefined;
      if (!v) fail('not-found', 'Vehicle was not found.');
      if (vehicleId !== driver.vehicleId) {
        const viaTask = await tx.get(db.collection('tasks').where('driverId', '==', uid).where('vehicleId', '==', vehicleId).limit(1));
        if (viaTask.empty) fail('permission-denied', 'You can only record fuel for a vehicle you are assigned to.');
      }
      const rec = buildFuel(p, v, vehicleId, uid, 'driver', ts, photoPath(p, 'receipt', uid));
      tx.set(db.doc(`fuel/f-${actionId}`), rec);
      bumpOdo(tx, vehicleId, v, rec.odometer);
      log(tx, me, 'Fuel recorded', `${v.reg} · ${rec.litres} L`);
      return;
    }

    case 'task.ack': {
      const taskId = p.str('taskId');
      const ref = db.doc(`tasks/${taskId ?? '-'}`);
      const t = (await tx.get(ref)).data() as TaskDoc | undefined;
      if (!t) fail('not-found', 'Task was not found.');
      if (t.driverId !== uid) fail('permission-denied', 'This task is not assigned to you.');
      if (t.status === 'cancelled') fail('failed-precondition', 'This task was cancelled by the office.');
      tx.update(ref, { acknowledged: true, acknowledgedTs: ts });
      log(tx, me, 'Task acknowledged', t.purpose);
      return;
    }

    default:
      fail('invalid-argument', 'Unknown driver action.');
  }
}
