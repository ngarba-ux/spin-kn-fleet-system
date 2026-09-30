// Accounts: office users (admin / SPC) and drivers. Roles live in Auth custom
// claims so security rules can check them without a document read.
import { onCall } from 'firebase-functions/v2/https';
import { actor, auth, dateOnly, db, fail, Input, log, looksLikeEmail, nowIso, tempPassword } from './common';
import { DriverDoc, UserDoc, VehicleDoc } from './models';

async function ensureEmailFree(email: string, exceptUid: string | null) {
  if (!looksLikeEmail(email)) fail('invalid-argument', 'Enter a valid email address.');
  try {
    const u = await auth.getUserByEmail(email);
    if (u.uid !== exceptUid) fail('already-exists', 'Another account already uses this email.');
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
  }
}

async function createAuthUser(email: string, name: string, role: UserDoc['role']): Promise<{ uid: string; password: string }> {
  const password = tempPassword();
  const u = await auth.createUser({ email, password, displayName: name, emailVerified: false });
  await auth.setCustomUserClaims(u.uid, { role, mustChangePassword: true });
  return { uid: u.uid, password };
}

// Forced first sign-in password change. The caller signed in moments ago with
// the temporary password, which is the proof we need.
export const passwordChanged = onCall(async req => {
  const a = req.auth;
  if (!a) fail('unauthenticated', 'Please sign in again.');
  if (Date.now() / 1000 - (a.token.auth_time as number) > 15 * 60) fail('failed-precondition', 'Please sign in again, then set your new password.');
  const pw = new Input(req.data).str('password', 200);
  if (!pw || pw.length < 8) fail('invalid-argument', 'Password must be at least 8 characters.');
  await auth.updateUser(a.uid, { password: pw });
  const claims: Record<string, unknown> = { ...(await auth.getUser(a.uid)).customClaims, mustChangePassword: false };
  await auth.setCustomUserClaims(a.uid, claims);
  const batch = db.batch();
  batch.update(db.doc(`users/${a.uid}`), { mustChangePassword: false });
  log(batch, { uid: a.uid, name: (a.token.name as string) || '' }, 'Password changed', a.token.email as string);
  await batch.commit();
  return { ok: true };
});

export const accountSave = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.str('id');
  const name = p.req('name', 'Name', 120);
  const email = p.req('email', 'Email', 200).toLowerCase();
  const role = p.oneOf('role', 'Role', ['admin', 'spc'] as const);
  await ensureEmailFree(email, id);

  if (!id) {
    const { uid, password } = await createAuthUser(email, name, role);
    const batch = db.batch();
    batch.set(db.doc(`users/${uid}`), { name, email, role, status: 'active', mustChangePassword: true, createdTs: nowIso() } satisfies UserDoc);
    log(batch, me, 'User created', `${name} (${role})`);
    await batch.commit();
    return { tempPassword: password, email };
  }

  const snap = await db.doc(`users/${id}`).get();
  if (!snap.exists) fail('not-found', 'User was not found.');
  const existing = snap.data() as UserDoc;
  if (existing.role === 'driver') fail('invalid-argument', 'Edit drivers from the Drivers page.');
  if (id === me.uid && role !== 'admin') fail('invalid-argument', 'You cannot remove your own admin role.');
  await auth.updateUser(id, { email, displayName: name });
  const claims = (await auth.getUser(id)).customClaims ?? {};
  await auth.setCustomUserClaims(id, { ...claims, role });
  const batch = db.batch();
  batch.update(snap.ref, { name, email, role });
  log(batch, me, 'User updated', name);
  await batch.commit();
  return { ok: true };
});

export const accountToggle = onCall(async req => {
  const me = actor(req, 'admin');
  const id = new Input(req.data).req('id', 'User');
  if (id === me.uid) fail('invalid-argument', 'You cannot deactivate your own account.');
  const ref = db.doc(`users/${id}`);
  const next = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'User was not found.');
    const u = snap.data() as UserDoc;
    if (u.status === 'active' && u.role === 'admin') {
      const admins = await tx.get(db.collection('users').where('role', '==', 'admin').where('status', '==', 'active'));
      if (admins.size <= 1) fail('failed-precondition', 'At least one active administrator is required.');
    }
    if (u.status === 'active' && u.role === 'driver') {
      const moving = await tx.get(db.collection('trips').where('driverId', '==', id).where('status', '==', 'inTransit').limit(1));
      if (!moving.empty) fail('failed-precondition', 'This driver has a trip in progress. End it first.');
    }
    const status = u.status === 'active' ? 'inactive' : 'active';
    tx.update(ref, { status });
    log(tx, me, status === 'active' ? 'User activated' : 'User deactivated', u.name);
    return status;
  });
  await auth.updateUser(id, { disabled: next === 'inactive' });
  if (next === 'inactive') await auth.revokeRefreshTokens(id);
  return { status: next };
});

export const accountResetPassword = onCall(async req => {
  const me = actor(req, 'admin');
  const id = new Input(req.data).req('id', 'User');
  const snap = await db.doc(`users/${id}`).get();
  if (!snap.exists) fail('not-found', 'User was not found.');
  const u = snap.data() as UserDoc;
  const password = tempPassword();
  await auth.updateUser(id, { password });
  await auth.setCustomUserClaims(id, { ...(await auth.getUser(id)).customClaims, mustChangePassword: true });
  await auth.revokeRefreshTokens(id);
  const batch = db.batch();
  batch.update(snap.ref, { mustChangePassword: true });
  log(batch, me, 'Password reset', u.name);
  await batch.commit();
  return { tempPassword: password, email: u.email };
});

// Creates or updates a driver (Auth account + users/{uid} + drivers/{uid}) and
// keeps "one driver per vehicle" consistent on both sides.
export const driverSave = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  let id = p.str('id');
  const name = p.req('name', 'Full name', 120);
  const email = p.req('email', 'Email / username', 200).toLowerCase();
  const vehicleId = p.str('vehicleId');
  const fields = {
    name, email,
    driverNo: p.str('driverNo', 40), phone: p.str('phone', 40), licenceNo: p.str('licenceNo', 60),
    licenceExpiry: dateOnly(p.str('licenceExpiry'), 'Licence expiry'),
    contract: p.oneOf('contract', 'Contract', ['active', 'expired', 'terminated'] as const, 'active'),
  };
  await ensureEmailFree(email, id);

  let result: Record<string, unknown> = { ok: true };
  if (!id) {
    const { uid, password } = await createAuthUser(email, name, 'driver');
    id = uid;
    result = { tempPassword: password, email, id };
  } else {
    await auth.updateUser(id, { email, displayName: name });
  }
  const uid = id;

  await db.runTransaction(async tx => {
    const dRef = db.doc(`drivers/${uid}`);
    const dSnap = await tx.get(dRef);
    const current = dSnap.exists ? (dSnap.data() as DriverDoc) : null;
    const prevVehicle = current?.vehicleId ?? null;
    const changing = prevVehicle !== vehicleId;
    let newVehicle: VehicleDoc | null = null;
    if (changing) {
      const moving = await tx.get(db.collection('trips').where('driverId', '==', uid).where('status', '==', 'inTransit').limit(1));
      if (!moving.empty) fail('failed-precondition', 'This driver has a trip in progress. End it before changing their vehicle.');
      if (vehicleId) {
        const vSnap = await tx.get(db.doc(`vehicles/${vehicleId}`));
        if (!vSnap.exists) fail('not-found', 'Vehicle was not found.');
        newVehicle = vSnap.data() as VehicleDoc;
      }
    }

    if (!current) {
      tx.set(db.doc(`users/${uid}`), { name, email, role: 'driver', status: 'active', mustChangePassword: true, createdTs: nowIso() } satisfies UserDoc);
      tx.set(dRef, { ...fields, vehicleId: null } satisfies DriverDoc);
      log(tx, me, 'Driver created', name);
    } else {
      tx.update(db.doc(`users/${uid}`), { name, email });
      tx.update(dRef, fields);
      log(tx, me, 'Driver updated', name);
    }

    if (changing) {
      if (prevVehicle) tx.set(db.doc(`vehicles/${prevVehicle}`), { driverId: null }, { merge: true });
      if (vehicleId && newVehicle) {
        // Take the vehicle from whoever had it.
        if (newVehicle.driverId && newVehicle.driverId !== uid) tx.set(db.doc(`drivers/${newVehicle.driverId}`), { vehicleId: null }, { merge: true });
        tx.update(db.doc(`vehicles/${vehicleId}`), { driverId: uid });
      }
      tx.set(dRef, { vehicleId }, { merge: true });
      log(tx, me, 'Vehicle assigned', `${newVehicle ? newVehicle.reg : 'None'} -> ${name}`);
    }
  });
  return result;
});
