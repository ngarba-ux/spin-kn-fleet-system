// Staff directory and QR cards. The QR token is a credential, so it lives in
// staffSecrets/{staffId}, readable only by the admin.
import { onCall } from 'firebase-functions/v2/https';
import { actor, db, fail, Input, log, looksLikeEmail, newStaffToken } from './common';
import { StaffDoc } from './models';

export const staffSave = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.str('id');
  const email = p.str('email', 200)?.toLowerCase() ?? null;
  if (email && !looksLikeEmail(email)) fail('invalid-argument', 'Enter a valid email address.');
  const fields = {
    fullName: p.req('fullName', 'Full name', 120),
    employeeNo: p.str('employeeNo', 60), unitCode: p.str('unitCode', 20), unit: p.str('unit', 120),
    designation: p.str('designation', 120), email, phone: p.str('phone', 40),
  };

  return db.runTransaction(async tx => {
    if (id) {
      const ref = db.doc(`staff/${id}`);
      if (!(await tx.get(ref)).exists) fail('not-found', 'Staff member was not found.');
      tx.update(ref, fields);
      log(tx, me, 'Staff updated', fields.fullName);
      return { id };
    }
    const all = await tx.get(db.collection('staff').select('staffNo'));
    const taken = new Set(all.docs.map(d => d.get('staffNo')));
    let n = all.size + 1;
    while (taken.has('STF-' + String(n).padStart(4, '0'))) n++;
    const ref = db.collection('staff').doc();
    tx.set(ref, { ...fields, staffNo: 'STF-' + String(n).padStart(4, '0'), qrStatus: 'active', status: 'active' } satisfies StaffDoc);
    tx.set(db.doc(`staffSecrets/${ref.id}`), { qrToken: newStaffToken() });
    log(tx, me, 'Staff added', fields.fullName);
    return { id: ref.id };
  });
});

export const staffToggle = onCall(async req => {
  const me = actor(req, 'admin');
  const id = new Input(req.data).req('id', 'Staff member');
  return db.runTransaction(async tx => {
    const ref = db.doc(`staff/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'Staff member was not found.');
    const s = snap.data() as StaffDoc;
    const status = s.status === 'active' ? 'inactive' : 'active';
    tx.update(ref, { status });
    log(tx, me, status === 'active' ? 'Staff activated' : 'Staff deactivated', s.fullName);
    return { status };
  });
});

// action: 'revoke' | 'regenerate'
export const staffToken = onCall(async req => {
  const me = actor(req, 'admin');
  const p = new Input(req.data);
  const id = p.req('id', 'Staff member');
  const action = p.oneOf('action', 'Action', ['revoke', 'regenerate'] as const);
  return db.runTransaction(async tx => {
    const ref = db.doc(`staff/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'Staff member was not found.');
    const s = snap.data() as StaffDoc;
    if (action === 'revoke') {
      tx.update(ref, { qrStatus: 'revoked' });
      log(tx, me, 'QR token revoked', s.fullName);
    } else {
      tx.set(db.doc(`staffSecrets/${id}`), { qrToken: newStaffToken() });
      tx.update(ref, { qrStatus: 'active' });
      log(tx, me, 'QR token regenerated', s.fullName);
    }
    return { ok: true };
  });
});
