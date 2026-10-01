// Trip request workflow. Staff act through `staffPortal` using their QR token;
// the office acts through `requestAction`. Every step runs in one transaction,
// so a failed step changes nothing (including queued emails).
import { onCall } from 'firebase-functions/v2/https';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import {
  actor, Actor, db, fail, fmtLocal, getSettings, Input, localYear, log, nowIso, overlaps, parseTs, randomToken, reqTs, saveInline, Settings,
} from './common';
import { notifyOffice, notifyStaff, officeRecipients, Recipient } from './notify';
import { DriverDoc, Passenger, RequestDoc, RequestStatus, StaffDoc, TaskDoc, UserDoc, VehicleDoc } from './models';

const OPEN: RequestStatus[] = ['SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'RETURNED_FOR_CORRECTION', 'FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED'];
const COMMITTED: RequestStatus[] = ['FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED'];

function requireStatus(r: RequestDoc, ...allowed: RequestStatus[]) {
  if (!allowed.includes(r.status))
    fail('failed-precondition', `This request is now '${r.status.replace(/_/g, ' ').toLowerCase()}', so that step is no longer available. The list has been refreshed.`);
}

function transition(r: RequestDoc, who: string, action: string, to: RequestStatus | null, comment?: string | null) {
  r.history.push({ ts: nowIso(), actor: who, action, from: r.status, to: to ?? r.status, comment: comment ?? '' });
  if (to) r.status = to;
  r.updatedTs = nowIso();
}

// ================================================================== conflicts

// Human-readable reasons why this driver / vehicle is not free in [from, to].
async function conflicts(tx: Transaction, driverId: string | null, vehicleId: string | null, from: Date, to: Date, excludeId: string | null): Promise<string[]> {
  const list: string[] = [];
  if (!driverId && !vehicleId) return list;

  const reqs = await tx.get(db.collection('requests').where('status', 'in', COMMITTED));
  for (const doc of reqs.docs) {
    if (doc.id === excludeId) continue;
    const r = doc.data() as RequestDoc;
    const a = parseTs(r.departTs), b = parseTs(r.returnTs);
    if (!a || !b || !overlaps(from, to, a, b)) continue;
    const rd = r.dispatchDriverId ?? r.proposedDriverId, rv = r.dispatchVehicleId ?? r.proposedVehicleId;
    const when = `${fmtLocal(r.departTs)} - ${fmtLocal(r.returnTs)}`;
    if (driverId && rd === driverId) list.push(`Driver is committed to ${r.ref} (${r.destination}, ${when}).`);
    else if (vehicleId && rv === vehicleId) list.push(`Vehicle is committed to ${r.ref} (${r.destination}, ${when}).`);
  }

  // Manual tasks have no end time: treat them as busy from 2 h before the trip window.
  const tasks = await tx.get(db.collection('tasks').where('status', 'in', ['scheduled', 'inProgress']));
  for (const doc of tasks.docs) {
    const t = doc.data() as TaskDoc;
    if (t.requestId) continue;
    const at = parseTs(t.scheduledTs);
    if (!at) continue;
    const inWindow = at.getTime() >= from.getTime() - 2 * 3600_000 && at <= to;
    if (!inWindow && t.status !== 'inProgress') continue;
    if (driverId && t.driverId === driverId) list.push(`Driver has task '${t.purpose}' at ${fmtLocal(t.scheduledTs)}${t.status === 'inProgress' ? ' (in progress)' : ''}.`);
    else if (vehicleId && t.vehicleId === vehicleId) list.push(`Vehicle has task '${t.purpose}' at ${fmtLocal(t.scheduledTs)}.`);
  }

  if (driverId) {
    const d = (await tx.get(db.doc(`drivers/${driverId}`))).data() as DriverDoc | undefined;
    if (d) {
      const lic = parseTs(d.licenceExpiry);
      if (lic && lic < to) list.push(`Driver's licence expires ${d.licenceExpiry}, before the trip ends.`);
      if (d.contract !== 'active') list.push(`Driver's contract is ${d.contract}.`);
    }
  }
  if (vehicleId) {
    const v = (await tx.get(db.doc(`vehicles/${vehicleId}`))).data() as VehicleDoc | undefined;
    if (v && v.condition !== 'ok') list.push(`Vehicle ${v.reg} is ${v.condition === 'maintenance' ? 'under maintenance' : 'out of service'}.`);
  }
  return list;
}

async function throwIfConflicts(tx: Transaction, driverId: string | null, vehicleId: string | null, r: RequestDoc, id: string) {
  const list = await conflicts(tx, driverId, vehicleId, reqTs(r.departTs, 'Departure'), reqTs(r.returnTs, 'Return'), id);
  if (list.length) fail('aborted', 'Scheduling conflict', { code: 'conflict', conflicts: list });
}

// ================================================================== dispatch

interface Plan {
  error?: string;
  driverId: string;
  driver?: DriverDoc;
  vehicleId?: string;
  vehicle?: VehicleDoc;
  oldTask?: { ref: DocumentReference; data: TaskDoc } | null;
}

// Reads and validates everything a dispatch needs. Returns an error instead of
// throwing, so an automatic dispatch after approval can fall back gracefully.
async function planDispatch(tx: Transaction, r: RequestDoc, driverId: string, vehicleId: string | null): Promise<Plan> {
  const dSnap = await tx.get(db.doc(`drivers/${driverId}`));
  if (!dSnap.exists) return { driverId, error: 'Driver was not found.' };
  const driver = dSnap.data() as DriverDoc;
  const user = (await tx.get(db.doc(`users/${driverId}`))).data() as UserDoc | undefined;
  if (!user || user.status !== 'active') return { driverId, error: `${driver.name}'s account is inactive.` };
  const vid = vehicleId ?? driver.vehicleId ?? null;
  if (!vid) return { driverId, error: `${driver.name} has no assigned vehicle. Choose a vehicle.` };
  const vSnap = await tx.get(db.doc(`vehicles/${vid}`));
  if (!vSnap.exists) return { driverId, error: 'Vehicle was not found.' };
  const vehicle = vSnap.data() as VehicleDoc;
  if (vehicle.condition !== 'ok') return { driverId, error: `${vehicle.reg} is not in service (maintenance / out of service).` };
  let oldTask: Plan['oldTask'] = null;
  if (r.taskId) {
    const tSnap = await tx.get(db.doc(`tasks/${r.taskId}`));
    if (tSnap.exists) {
      oldTask = { ref: tSnap.ref, data: tSnap.data() as TaskDoc };
      if (oldTask.data.status === 'inProgress') return { driverId, error: 'The trip has already started; the assignment cannot be changed.' };
    }
  }
  return { driverId, driver, vehicleId: vid, vehicle, oldTask };
}

function applyDispatch(tx: Transaction, s: Settings, id: string, r: RequestDoc, plan: Plan, who: string, comment: string | null) {
  const { driver, vehicle, vehicleId, driverId, oldTask } = plan;
  if (!driver || !vehicle || !vehicleId) fail('failed-precondition', plan.error ?? 'Cannot assign this driver.');
  if (oldTask && oldTask.data.status === 'scheduled') tx.update(oldTask.ref, { status: 'cancelled' });
  const taskRef = db.collection('tasks').doc();
  tx.set(taskRef, {
    driverId, vehicleId, purpose: r.purpose, origin: s.defaultOrigin, destination: r.destination, scheduledTs: r.departTs,
    priority: r.priority === 'urgent' ? 'high' : 'medium', status: 'scheduled', acknowledged: false, requestId: id,
    requester: { name: r.staff.fullName, phone: r.staff.phone, passengers: r.passengers, returnTs: r.returnTs, ref: r.ref },
    notes: `Trip request ${r.ref} for ${r.staff.fullName}${r.staff.phone ? ` (${r.staff.phone})` : ''}. Passengers: ${r.passengers}. Expected return: ${fmtLocal(r.returnTs)}.`,
    createdTs: nowIso(), createdBy: who,
  } satisfies TaskDoc);
  r.taskId = taskRef.id;
  r.dispatchDriverId = driverId;
  r.dispatchVehicleId = vehicleId;
  r.dispatchedByName = who;
  transition(r, who, 'DRIVER_ASSIGNED', 'DRIVER_ASSIGNED', `${driver.name} · ${vehicle.reg}${comment ? ' · ' + comment : ''}`);
  notifyStaff(tx, s, id, r, 'dispatch', null, {
    driver: driver.name + (driver.phone ? ` (${driver.phone})` : ''),
    vehicle: `${vehicle.reg} - ${vehicle.model}${vehicle.colour ? ', ' + vehicle.colour : ''}`,
  });
}

// SPC approval (or SPC reschedule, which also approves). Auto-assigns the
// proposed driver when that is still possible.
function applyApproval(tx: Transaction, s: Settings, admins: Recipient[], id: string, r: RequestDoc, who: string, action: string, comment: string | null, plan: Plan | null) {
  transition(r, who, action, 'APPROVED', comment);
  r.spcDecision = action === 'TRIP_RESCHEDULED' ? 'RESCHEDULED' : 'APPROVED';
  if (action !== 'TRIP_RESCHEDULED') notifyStaff(tx, s, id, r, 'approved', comment);
  if (plan && !plan.error) {
    applyDispatch(tx, s, id, r, plan, who, 'Auto-assigned from the approved proposal');
  } else if (plan) {
    transition(r, 'System', 'AUTO_DISPATCH_SKIPPED', null, plan.error);
    notifyOffice(tx, s, admins, id, r, `Trip request ${r.ref} approved - assign a vehicle`,
      `The SPC approved this request but the proposed driver could not be assigned automatically (${plan.error}). Please assign a vehicle and driver.`);
  } else {
    notifyOffice(tx, s, admins, id, r, `Trip request ${r.ref} approved - assign a vehicle`, 'The SPC has approved this trip request. Please assign a vehicle and driver.');
  }
}

async function cancelTaskFor(tx: Transaction, r: RequestDoc): Promise<DocumentReference | null> {
  if (!r.taskId) return null;
  const snap = await tx.get(db.doc(`tasks/${r.taskId}`));
  if (!snap.exists) return null;
  const t = snap.data() as TaskDoc;
  if (t.status === 'inProgress') fail('failed-precondition', 'The trip is already under way and cannot be cancelled.');
  return t.status === 'scheduled' ? snap.ref : null;
}

// ================================================================== office actions

export const requestAction = onCall(async req => {
  const me = actor(req, 'admin', 'spc');
  const p = new Input(req.data);
  const type = p.req('type', 'Action');
  const id = p.req('id', 'Request');
  const isSpc = me.role === 'spc';
  const isSuper = me.role === 'super';

  const adminOnly = ['ack', 'review', 'forward', 'dispatch', 'cancel', 'close'];
  const spcOnly = ['approve', 'reject'];
  if (adminOnly.includes(type) && isSpc) fail('permission-denied', 'Your account is not allowed to do that.');
  if (spcOnly.includes(type) && me.role === 'admin') fail('permission-denied', 'Your account is not allowed to do that.');

  // Two-person check: whoever forwarded a request cannot also decide it.
  const independent = (r: RequestDoc) => {
    if (r.forwardedByUid && r.forwardedByUid === me.uid)
      fail('failed-precondition', 'You forwarded this request, so someone else must approve or decline it.', { code: 'sameApprover' });
  };

  const [s, admins, spcs] = await Promise.all([getSettings(), officeRecipients('admin'), officeRecipients('spc')]);
  const ref = db.doc(`requests/${id}`);

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'Trip request was not found. It may have been removed; refresh and try again.');
    const r = snap.data() as RequestDoc;
    const comment = p.str('comment', 1000);

    switch (type) {
      case 'ack':
        requireStatus(r, 'SUBMITTED');
        transition(r, me.name, 'ADMIN_ACKNOWLEDGED', 'ACKNOWLEDGED', comment);
        notifyStaff(tx, s, id, r, 'acknowledged');
        log(tx, me, 'Trip request acknowledged', r.ref);
        break;

      case 'review':
        requireStatus(r, 'SUBMITTED', 'ACKNOWLEDGED');
        transition(r, me.name, 'ADMIN_REVIEWED', 'UNDER_ADMIN_REVIEW', comment);
        log(tx, me, 'Trip request under review', r.ref);
        break;

      case 'return': {
        if (isSpc) requireStatus(r, 'FORWARDED_TO_SPC');
        else requireStatus(r, 'SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'FORWARDED_TO_SPC', 'APPROVED');
        const reason = p.req('comment', 'Reason', 1000);
        transition(r, me.name, 'RETURNED_FOR_CORRECTION', 'RETURNED_FOR_CORRECTION', reason);
        r.proposedDriverId = null; r.proposedVehicleId = null; r.spcDecision = null;
        notifyStaff(tx, s, id, r, 'returned', reason);
        log(tx, me, 'Trip request returned', `${r.ref} · ${reason}`);
        break;
      }

      case 'forward': {
        requireStatus(r, 'SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW');
        const driverId = p.str('driverId');
        let vehicleId = p.str('vehicleId');
        let driver: DriverDoc | null = null;
        if (driverId) {
          const d = await tx.get(db.doc(`drivers/${driverId}`));
          if (!d.exists) fail('not-found', 'Driver was not found.');
          driver = d.data() as DriverDoc;
          vehicleId = vehicleId ?? driver.vehicleId ?? null;
        }
        if (vehicleId && !(await tx.get(db.doc(`vehicles/${vehicleId}`))).exists) fail('not-found', 'Vehicle was not found.');
        if (!p.bool('force')) await throwIfConflicts(tx, driverId, vehicleId, r, id);
        const remark = p.str('remark', 1000);
        r.adminRemark = remark ?? '';
        r.proposedDriverId = driverId;
        r.proposedVehicleId = vehicleId;
        r.forwardedByName = me.name;
        r.forwardedByUid = me.uid;
        transition(r, me.name, 'FORWARDED_TO_SPC', 'FORWARDED_TO_SPC', [remark, driver ? `Proposed driver: ${driver.name}` : null].filter(Boolean).join(' '));
        notifyStaff(tx, s, id, r, 'review');
        notifyOffice(tx, s, spcs, id, r, `Trip request ${r.ref} awaiting your decision`,
          `A trip request has been forwarded by ${me.name} for your decision.${remark ? '\nRemark: ' + remark : ''}`);
        log(tx, me, 'Trip request forwarded to SPC', r.ref);
        break;
      }

      case 'approve': {
        requireStatus(r, 'FORWARDED_TO_SPC');
        independent(r);
        const plan = r.proposedDriverId ? await planDispatch(tx, r, r.proposedDriverId, r.proposedVehicleId ?? null) : null;
        applyApproval(tx, s, admins, id, r, me.name, 'SPC_APPROVED', comment, plan);
        log(tx, me, 'Trip request approved', r.ref);
        break;
      }

      case 'reject': {
        requireStatus(r, 'FORWARDED_TO_SPC');
        independent(r);
        const reason = p.req('comment', 'Reason', 1000);
        transition(r, me.name, 'SPC_REJECTED', 'REJECTED', reason);
        r.spcDecision = 'REJECTED';
        notifyStaff(tx, s, id, r, 'rejected', reason);
        log(tx, me, 'Trip request rejected', `${r.ref} · ${reason}`);
        break;
      }

      case 'reschedule': {
        // A super user rescheduling a request that awaits the SPC decides it as
        // the SPC, unless they forwarded it themselves.
        const asSpc = isSpc || (isSuper && r.status === 'FORWARDED_TO_SPC' && r.forwardedByUid !== me.uid);
        if (isSpc) { requireStatus(r, 'FORWARDED_TO_SPC'); independent(r); }
        else requireStatus(r, 'SUBMITTED', 'ACKNOWLEDGED', 'UNDER_ADMIN_REVIEW', 'FORWARDED_TO_SPC', 'APPROVED', 'DRIVER_ASSIGNED');
        const dep = reqTs(p.req('departTs', 'New departure'), 'New departure');
        const ret = reqTs(p.req('returnTs', 'New return'), 'New return');
        if (ret < dep) fail('invalid-argument', 'Return must be on or after departure.');
        const reason = p.req('comment', 'Reason', 1000);
        const taskSnap = r.taskId ? await tx.get(db.doc(`tasks/${r.taskId}`)) : null;
        const task = taskSnap?.exists ? (taskSnap.data() as TaskDoc) : null;
        if (task?.status === 'inProgress') fail('failed-precondition', 'The trip has already started and cannot be rescheduled.');
        const drvId = r.dispatchDriverId ?? r.proposedDriverId ?? null, vehId = r.dispatchVehicleId ?? r.proposedVehicleId ?? null;
        if (!p.bool('force') && (drvId || vehId)) {
          const list = await conflicts(tx, drvId, vehId, dep, ret, id);
          if (list.length) fail('aborted', 'Scheduling conflict', { code: 'conflict', conflicts: list });
        }
        const oldDep = r.departTs, oldRet = r.returnTs;
        r.departTs = dep.toISOString(); r.returnTs = ret.toISOString();
        const plan = asSpc && r.proposedDriverId ? await planDispatch(tx, r, r.proposedDriverId, r.proposedVehicleId ?? null) : null;
        r.rescheduledFromDepart = oldDep; r.rescheduledFromReturn = oldRet;
        if (taskSnap && task?.status === 'scheduled') tx.update(taskSnap.ref, { scheduledTs: r.departTs, acknowledged: false });
        const note = `${reason} (was ${fmtLocal(oldDep)} - ${fmtLocal(oldRet)})`;
        if (asSpc) applyApproval(tx, s, admins, id, r, me.name, 'TRIP_RESCHEDULED', note, plan);
        else transition(r, me.name, 'TRIP_RESCHEDULED', null, note);
        notifyStaff(tx, s, id, r, 'rescheduled', reason);
        log(tx, me, 'Trip request rescheduled', r.ref);
        break;
      }

      case 'dispatch': {
        requireStatus(r, 'APPROVED', 'DRIVER_ASSIGNED');
        const driverId = p.req('driverId', 'Driver');
        const plan = await planDispatch(tx, r, driverId, p.str('vehicleId'));
        if (plan.error) fail('failed-precondition', plan.error);
        if (!p.bool('force')) await throwIfConflicts(tx, driverId, plan.vehicleId ?? null, r, id);
        applyDispatch(tx, s, id, r, plan, me.name, comment);
        log(tx, me, 'Vehicle & driver assigned', `${r.ref} -> ${plan.driver!.name}`);
        break;
      }

      case 'cancel': {
        requireStatus(r, ...OPEN);
        const reason = p.req('comment', 'Reason', 1000);
        const taskRef = await cancelTaskFor(tx, r);
        if (taskRef) tx.update(taskRef, { status: 'cancelled' });
        transition(r, me.name, 'REQUEST_CANCELLED', 'CANCELLED', reason);
        notifyStaff(tx, s, id, r, 'cancelled', reason);
        log(tx, me, 'Trip request cancelled', r.ref);
        break;
      }

      case 'close':
        requireStatus(r, 'TRIP_COMPLETED');
        transition(r, me.name, 'REQUEST_CLOSED', 'CLOSED', comment);
        log(tx, me, 'Trip request closed', r.ref);
        break;

      default:
        fail('invalid-argument', 'Unknown action.');
    }
    tx.set(ref, r);
  });
  return { ok: true };
});

// Read-only availability check used by the forward / dispatch / reschedule forms.
export const checkConflicts = onCall(async req => {
  actor(req, 'admin', 'spc');
  const p = new Input(req.data);
  const id = p.str('id');
  return db.runTransaction(async tx => {
    let dep: Date, ret: Date;
    if (p.str('departTs')) {
      dep = reqTs(p.str('departTs'), 'Departure');
      ret = reqTs(p.req('returnTs', 'Return'), 'Return');
    } else {
      const snap = id ? await tx.get(db.doc(`requests/${id}`)) : null;
      if (!snap?.exists) fail('not-found', 'Trip request was not found.');
      const r = snap.data() as RequestDoc;
      dep = reqTs(r.departTs, 'Departure'); ret = reqTs(r.returnTs, 'Return');
    }
    return { conflicts: await conflicts(tx, p.str('driverId'), p.str('vehicleId'), dep, ret, id) };
  }, { readOnly: true });
});

// ================================================================== staff portal (QR token, no sign-in)

async function staffByToken(p: Input): Promise<{ id: string; staff: StaffDoc }> {
  const raw = p.str('token', 400);
  if (!raw) fail('not-found', 'This QR / token was not recognised.', { code: 'invalidToken' });
  // Accept a pasted link as well as the bare token.
  const m = /(?:[?#&]s=|token[=:])\s*([\w-]+)/i.exec(raw);
  const token = m ? m[1] : raw;
  if (!/^[\w-]{10,80}$/.test(token)) fail('not-found', 'This QR / token was not recognised.', { code: 'invalidToken' });
  const found = await db.collection('staffSecrets').where('qrToken', '==', token).limit(1).get();
  if (found.empty) fail('not-found', 'This QR / token was not recognised.', { code: 'invalidToken' });
  const id = found.docs[0].id;
  const snap = await db.doc(`staff/${id}`).get();
  const staff = snap.data() as StaffDoc | undefined;
  if (!staff) fail('not-found', 'This QR / token was not recognised.', { code: 'invalidToken' });
  if (staff.qrStatus !== 'active') fail('permission-denied', 'This QR code has been revoked. Contact the fleet office.', { code: 'revokedToken' });
  if (staff.status !== 'active') fail('permission-denied', 'This staff account is not active.', { code: 'inactiveStaff' });
  return { id, staff };
}

function lastComment(r: RequestDoc, action: string): string | null {
  const h = [...r.history].reverse().find(x => x.action === action);
  return h ? h.comment : null;
}

async function staffHome(id: string, staff: StaffDoc) {
  const [s, snap] = await Promise.all([
    getSettings(),
    db.collection('requests').where('staffId', '==', id).orderBy('createdTs', 'desc').limit(25).get(),
  ]);
  return {
    staff: {
      fullName: staff.fullName, designation: staff.designation, unit: staff.unit, unitCode: staff.unitCode,
      email: staff.email, employeeNo: staff.employeeNo, staffNo: staff.staffNo,
    },
    requests: snap.docs.map(d => {
      const r = d.data() as RequestDoc & { tripStarted?: boolean };
      const returned = r.status === 'RETURNED_FOR_CORRECTION';
      return {
        id: d.id, ref: r.ref, status: r.status, purpose: r.purpose, destination: r.destination,
        departTs: r.departTs, returnTs: r.returnTs, createdTs: r.createdTs, statusToken: r.statusToken,
        canCancel: OPEN.includes(r.status) && !r.tripStarted,
        canEdit: returned,
        returnReason: returned ? lastComment(r, 'RETURNED_FOR_CORRECTION') : null,
        form: returned ? {
          purpose: r.purpose, component: r.component, destination: r.destination, departTs: r.departTs, returnTs: r.returnTs,
          passengers: r.passengers, passengerList: r.passengerList, vehicle: r.vehicle, priority: r.priority,
          urgentReason: r.urgentReason, assignment: r.assignment, remarks: r.remarks,
        } : null,
      };
    }),
    options: { components: s.components, vehicleTypes: s.vehicleTypes },
    orgName: s.orgName,
  };
}

function readForm(p: Input) {
  const purpose = p.req('purpose', 'Trip purpose', 500);
  const destination = p.req('destination', 'Destination', 300);
  const component = p.req('component', 'Project component', 150);
  const dep = reqTs(p.req('departTs', 'Departure'), 'Departure');
  const ret = reqTs(p.req('returnTs', 'Expected return'), 'Expected return');
  if (ret < dep) fail('invalid-argument', 'Return must be on or after departure.');
  if (dep.getTime() < Date.now() - 2 * 3600_000) fail('invalid-argument', 'Departure cannot be in the past.');
  if (dep.getTime() > Date.now() + 366 * 86400_000) fail('invalid-argument', 'Departure is too far in the future.');
  const pax = p.num('passengers');
  if (pax === null || pax < 1 || pax > 60 || !Number.isInteger(pax)) fail('invalid-argument', 'Enter a valid number of passengers.');
  const priority = p.oneOf('priority', 'Priority', ['normal', 'urgent'] as const, 'normal');
  const urgentReason = p.str('urgentReason', 500);
  if (priority === 'urgent' && !urgentReason) fail('invalid-argument', 'A justification is required for urgent requests.');
  const passengerList: Passenger[] = p.list('passengerList').slice(0, 60)
    .map(x => ({ name: x.str('name', 120) ?? '', org: x.str('org', 120) ?? '' })).filter(x => x.name);
  return {
    purpose, destination, component, departTs: dep.toISOString(), returnTs: ret.toISOString(), passengers: pax, passengerList,
    vehicle: p.str('vehicle', 120) ?? 'Any available vehicle', priority, urgentReason: priority === 'urgent' ? urgentReason! : '',
    assignment: p.str('assignment', 500) ?? '', remarks: p.str('remarks', 1000) ?? '',
  };
}

export const staffPortal = onCall({ memory: '512MiB' }, async req => {
  const p = new Input(req.data);
  const type = p.req('type', 'Action');

  if (type === 'status') return statusView(p);

  const { id: staffId, staff } = await staffByToken(p);
  if (type === 'lookup') return staffHome(staffId, staff);

  const s = await getSettings();
  const who: Actor = { uid: `staff:${staffId}`, role: 'driver', name: staff.fullName };

  if (type === 'submit' || type === 'resubmit') {
    const form = readForm(p);
    const docPath = await saveInline(p.obj('doc'), `uploads/staff/${staffId}`);
    const admins = await officeRecipients('admin');
    const result = await db.runTransaction(async tx => {
      if (type === 'submit') {
        // The key is recorded only once validation passes, so fixing a rejected
        // form and sending it again is not mistaken for a double submit.
        const sub = p.str('submissionId', 80);
        const subRef = sub && /^[\w-]{6,80}$/.test(sub) ? db.doc(`processed/sub_${sub}`) : null;
        if (subRef && (await tx.get(subRef)).exists) fail('already-exists', 'This request was already submitted.', { code: 'dupGuard' });
        const counterRef = db.doc('counters/requests');
        const seq = ((await tx.get(counterRef)).get('seq') as number | undefined ?? 0) + 1;
        const ref = db.collection('requests').doc();
        const r: RequestDoc = {
          ...form, doc: docPath, ref: `TR-${localYear()}-${String(seq).padStart(6, '0')}`,
          statusToken: 'st_' + randomToken(18).replace(/[-_]/g, 'x'), staffId,
          staff: { fullName: staff.fullName, designation: staff.designation ?? '', unit: staff.unit ?? '', email: staff.email ?? '', phone: staff.phone ?? '' },
          status: 'SUBMITTED', createdTs: nowIso(), updatedTs: nowIso(),
          history: [{ ts: nowIso(), actor: staff.fullName, action: 'TRIP_REQUEST_SUBMITTED', from: 'DRAFT', to: 'SUBMITTED', comment: '' }],
        };
        tx.set(counterRef, { seq }, { merge: true });
        if (subRef) tx.set(subRef, { ts: nowIso() });
        tx.set(ref, r);
        notifyStaff(tx, s, ref.id, r, 'submitted');
        notifyOffice(tx, s, admins, ref.id, r, `New trip request ${r.ref}${r.priority === 'urgent' ? ' (URGENT)' : ''}`, 'A new trip request has been submitted.');
        log(tx, who, 'Trip request submitted', `${r.ref} · ${staff.fullName}`);
        return { ref: r.ref, statusToken: r.statusToken };
      }
      const ref = db.doc(`requests/${p.req('id', 'Request')}`);
      const snap = await tx.get(ref);
      const r = snap.data() as RequestDoc | undefined;
      if (!r || r.staffId !== staffId) fail('not-found', 'Trip request was not found.');
      requireStatus(r, 'RETURNED_FOR_CORRECTION');
      Object.assign(r, form);
      if (docPath) r.doc = docPath;
      transition(r, staff.fullName, 'TRIP_REQUEST_RESUBMITTED', 'SUBMITTED', 'Corrected and resubmitted');
      tx.set(ref, r);
      notifyStaff(tx, s, ref.id, r, 'submitted');
      notifyOffice(tx, s, admins, ref.id, r, `Trip request ${r.ref} resubmitted`, 'A returned trip request has been corrected and resubmitted.');
      log(tx, who, 'Trip request resubmitted', `${r.ref} · ${staff.fullName}`);
      return { ref: r.ref, statusToken: r.statusToken };
    });
    return { ...result, home: await staffHome(staffId, staff) };
  }

  if (type === 'cancel') {
    await db.runTransaction(async tx => {
      const ref = db.doc(`requests/${p.req('id', 'Request')}`);
      const snap = await tx.get(ref);
      const r = snap.data() as RequestDoc | undefined;
      if (!r || r.staffId !== staffId) fail('not-found', 'Trip request was not found.');
      requireStatus(r, ...OPEN);
      const reason = p.str('reason', 500) ?? 'Cancelled by requester';
      const taskRef = await cancelTaskFor(tx, r);
      if (taskRef) tx.update(taskRef, { status: 'cancelled' });
      transition(r, staff.fullName, 'REQUEST_CANCELLED', 'CANCELLED', reason);
      tx.set(ref, r);
      notifyStaff(tx, s, ref.id, r, 'cancelled', reason);
      log(tx, who, 'Trip request cancelled by staff', `${r.ref} · ${staff.fullName}`);
    });
    return staffHome(staffId, staff);
  }

  fail('invalid-argument', 'Unknown request.');
});

// Public status page for a request (link in every staff email). Admin remarks
// and internal steps stay internal.
async function statusView(p: Input) {
  const tok = p.str('statusToken', 100);
  const found = tok && /^st_[\w-]+$/.test(tok) ? await db.collection('requests').where('statusToken', '==', tok).limit(1).get() : null;
  if (!found || found.empty) fail('not-found', 'We could not find that request. Check the link and try again.');
  const r = found.docs[0].data() as RequestDoc;
  const visible = new Set(['TRIP_REQUEST_SUBMITTED', 'TRIP_REQUEST_RESUBMITTED', 'ADMIN_ACKNOWLEDGED', 'ADMIN_REVIEWED', 'FORWARDED_TO_SPC', 'RETURNED_FOR_CORRECTION',
    'SPC_APPROVED', 'SPC_REJECTED', 'TRIP_RESCHEDULED', 'DRIVER_ASSIGNED', 'REQUEST_CANCELLED', 'TRIP_COMPLETED', 'REQUEST_CLOSED']);
  const withNote = new Set(['RETURNED_FOR_CORRECTION', 'SPC_REJECTED', 'TRIP_RESCHEDULED', 'REQUEST_CANCELLED']);
  const assigned = r.status === 'DRIVER_ASSIGNED' || r.status === 'TRIP_COMPLETED';
  const [d, v, t, s] = await Promise.all([
    assigned && r.dispatchDriverId ? db.doc(`drivers/${r.dispatchDriverId}`).get() : null,
    assigned && r.dispatchVehicleId ? db.doc(`vehicles/${r.dispatchVehicleId}`).get() : null,
    r.taskId ? db.doc(`tasks/${r.taskId}`).get() : null,
    getSettings(),
  ]);
  const driver = d?.data() as DriverDoc | undefined, vehicle = v?.data() as VehicleDoc | undefined, task = t?.data() as TaskDoc | undefined;
  const trip = task?.tripId ? (await db.doc(`trips/${task.tripId}`).get()).data() : undefined;
  return {
    ref: r.ref, status: r.status, purpose: r.purpose, destination: r.destination, component: r.component,
    departTs: r.departTs, returnTs: r.returnTs, passengers: r.passengers, priority: r.priority, createdTs: r.createdTs,
    staffName: r.staff.fullName,
    timeline: r.history.filter(h => visible.has(h.action)).map(h => ({ action: h.action, ts: h.ts, note: withNote.has(h.action) ? h.comment : '' })),
    driver: driver ? { name: driver.name, phone: driver.phone } : null,
    vehicle: vehicle ? { reg: vehicle.reg, model: vehicle.model, colour: vehicle.colour } : null,
    tripStatus: trip ? trip.status : null,
    orgName: s.orgName,
  };
}
