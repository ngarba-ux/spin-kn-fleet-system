// Ending a trip, shared by the driver queue and the office "force end".
import { Transaction } from 'firebase-admin/firestore';
import { db, nowIso } from './common';
import { RequestDoc, TaskDoc, TripDoc, VehicleDoc } from './models';

export interface FinishInput {
  ts: string;
  lat?: number | null;
  lng?: number | null;
  odo?: number | null;
  notes?: string | null;
  photo?: string | null;
  byName: string;
}

// Does all its reads first, then writes, so it can run inside any transaction
// that has not written yet. Returns the vehicle (for log messages).
export async function finishTrip(tx: Transaction, tripId: string, t: TripDoc, f: FinishInput): Promise<VehicleDoc | undefined> {
  const vRef = db.doc(`vehicles/${t.vehicleId}`);
  const taskRef = t.taskId ? db.doc(`tasks/${t.taskId}`) : null;
  const [vSnap, taskSnap] = await Promise.all([tx.get(vRef), taskRef ? tx.get(taskRef) : null]);
  const task = taskSnap?.data() as TaskDoc | undefined;
  const requestId = t.requestId ?? task?.requestId ?? null;
  const rSnap = requestId ? await tx.get(db.doc(`requests/${requestId}`)) : null;
  const v = vSnap.data() as VehicleDoc | undefined;

  const stops = t.stops.map(s => (s.endTs ? s : { ...s, endTs: f.ts }));
  const notes = f.notes ? (t.notes ? `${t.notes}\n${f.notes}` : f.notes) : t.notes ?? null;
  tx.update(db.doc(`trips/${tripId}`), {
    status: 'completed', paused: false, stops, endTs: f.ts,
    endLat: f.lat ?? null, endLng: f.lng ?? null, endOdo: f.odo ?? null, endPhoto: f.photo ?? null, notes,
  });
  if (taskSnap && task?.status === 'inProgress') tx.update(taskSnap.ref, { status: 'completed' });
  if (v) {
    const patch: Partial<VehicleDoc> = {};
    if (v.activeTripId === tripId) patch.activeTripId = null;
    if (typeof f.odo === 'number' && f.odo > (v.lastOdo ?? -1)) patch.lastOdo = f.odo;
    if (Object.keys(patch).length) tx.update(vRef, patch);
  }
  const r = rSnap?.data() as RequestDoc | undefined;
  if (rSnap && r && r.status === 'DRIVER_ASSIGNED') {
    r.history.push({ ts: nowIso(), actor: f.byName, action: 'TRIP_COMPLETED', from: r.status, to: 'TRIP_COMPLETED', comment: '' });
    tx.update(rSnap.ref, { status: 'TRIP_COMPLETED', history: r.history, updatedTs: nowIso() });
  }
  return v;
}
