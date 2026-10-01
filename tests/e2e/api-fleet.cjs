// Live test of the fleet/people functions used by the new Vehicles, Drivers and Staff pages.
const path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const { KEY } = require('./env.cjs');
const reqF = createRequire(path.join(ROOT, 'functions/package.json'));
const reqW = createRequire(path.join(ROOT, 'web/package.json'));
const aApp = reqF('firebase-admin/app'), aFs = reqF('firebase-admin/firestore'), aAuth = reqF('firebase-admin/auth');
aApp.initializeApp({ credential: aApp.cert(require(KEY)) });
const adb = aFs.getFirestore(), aauth = aAuth.getAuth();
const { initializeApp } = reqW('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = reqW('firebase/auth');
const { getFunctions, httpsCallable } = reqW('firebase/functions');
const cfg = { apiKey: 'AIzaSyDc3YRvJ_P2eq0z34PmD63HSg8kp05dRbA', authDomain: 'spin-kn-fleet.firebaseapp.com', projectId: 'spin-kn-fleet', appId: '1:285522850455:web:f95154ead1e05b7d556fd2' };

const PW = 'E2e-' + Math.random().toString(36).slice(2) + '!x9';
const ADMIN = 'e2e-admin@example.invalid', SPC = 'e2e-spc@example.invalid';
const D1 = 'e2e-driver1@example.invalid', D2 = 'e2e-driver2@example.invalid';
const made = { uids: [], vehicles: [], staff: [] };
let pass = 0, failN = 0;
const ok = (c, m) => { c ? pass++ : failN++; console.log(c ? '  PASS' : '  FAIL', m); };
async function expectFail(p, code, m) { try { await p; ok(false, m + ' (was allowed!)'); } catch (e) { ok(String(e.code).includes(code), `${m} -> ${e.code}${e.code.includes(code) ? '' : ': ' + e.message}`); } }

async function mkUser(email, role) {
  try { await aauth.deleteUser((await aauth.getUserByEmail(email)).uid); } catch {}
  const u = await aauth.createUser({ email, password: PW, displayName: 'E2E ' + role });
  await aauth.setCustomUserClaims(u.uid, { role, mustChangePassword: false });
  await adb.doc(`users/${u.uid}`).set({ name: 'E2E ' + role, email, role, status: 'active', mustChangePassword: false, createdTs: new Date().toISOString() });
  made.uids.push(u.uid);
  return u.uid;
}

async function run() {
  await mkUser(ADMIN, 'admin'); await mkUser(SPC, 'spc');
  const A = initializeApp(cfg, 'a'), S = initializeApp(cfg, 's');
  await signInWithEmailAndPassword(getAuth(A), ADMIN, PW);
  await signInWithEmailAndPassword(getAuth(S), SPC, PW);
  const call = (app, n, d) => httpsCallable(getFunctions(app, 'europe-west1'), n)(d).then(r => r.data);

  console.log('Vehicles');
  const v1 = (await call(A, 'vehicleSave', { reg: 'e2e-test-01', model: 'Test Hilux', initialOdo: '12000', insuranceExpiry: '2027-01-31' })).id; made.vehicles.push(v1);
  let v = (await adb.doc(`vehicles/${v1}`).get()).data();
  ok(v.reg === 'E2E-TEST-01' && v.lastOdo === 12000 && v.lastServiceOdo === 12000 && v.condition === 'ok', 'create: reg upper-cased, odometer + service baseline set');
  await expectFail(call(A, 'vehicleSave', { reg: 'E2E-TEST-01', model: 'Dup' }), 'already-exists', 'duplicate registration rejected');
  await expectFail(call(S, 'vehicleSave', { reg: 'E2E-TEST-99', model: 'x' }), 'permission-denied', 'SPC cannot add vehicles');
  await expectFail(call(A, 'vehicleSave', { reg: 'E2E-TEST-98', model: 'x', insuranceExpiry: '31/01/2027' }), 'invalid-argument', 'bad date rejected');
  const v2 = (await call(A, 'vehicleSave', { reg: 'E2E-TEST-02', model: 'Test Bus' })).id; made.vehicles.push(v2);
  await call(A, 'vehicleSave', { id: v1, reg: 'E2E-TEST-01', model: 'Test Hilux 2.4', colour: 'White' });
  v = (await adb.doc(`vehicles/${v1}`).get()).data();
  ok(v.model === 'Test Hilux 2.4' && v.lastServiceOdo === 12000, 'edit keeps the service baseline');
  await call(A, 'vehicleCondition', { id: v1, condition: 'maintenance' });
  ok((await adb.doc(`vehicles/${v1}`).get()).get('condition') === 'maintenance', 'condition -> under maintenance');
  await call(A, 'vehicleCondition', { id: v1, condition: 'ok' });
  await expectFail(call(A, 'vehicleServiced', { id: v1, odometer: '11000' }), 'invalid-argument', 'service odometer below last reading rejected');
  await call(A, 'vehicleServiced', { id: v1, odometer: '12500', cost: '45000', notes: 'Oil change' });
  v = (await adb.doc(`vehicles/${v1}`).get()).data();
  ok(v.lastServiceOdo === 12500 && v.lastOdo === 12500 && v.lastServiceDate, 'service recorded, odometer advanced');
  const m = await adb.collection('maintenance').where('vehicleId', '==', v1).get();
  ok(m.size === 1 && m.docs[0].get('cost') === 45000, 'maintenance record written');

  console.log('Drivers');
  const r1 = await call(A, 'driverSave', { name: 'E2E Driver One', email: D1, phone: '0800', licenceExpiry: '2027-06-30', vehicleId: v1 });
  made.uids.push(r1.id);
  ok(r1.tempPassword && r1.tempPassword.length >= 10, 'create returns a one-time temporary password');
  const claims = (await aauth.getUser(r1.id)).customClaims;
  ok(claims.role === 'driver' && claims.mustChangePassword === true, 'driver role claim set, must change password');
  ok((await adb.doc(`vehicles/${v1}`).get()).get('driverId') === r1.id, 'vehicle linked to driver');
  await expectFail(call(A, 'driverSave', { name: 'Dup', email: D1 }), 'already-exists', 'duplicate email rejected');
  const r2 = await call(A, 'driverSave', { name: 'E2E Driver Two', email: D2, vehicleId: v1 });
  made.uids.push(r2.id);
  const d1 = (await adb.doc(`drivers/${r1.id}`).get()).data();
  ok(d1.vehicleId === null && (await adb.doc(`vehicles/${v1}`).get()).get('driverId') === r2.id, 'assigning the vehicle to driver 2 takes it from driver 1');
  await call(A, 'driverSave', { id: r1.id, name: 'E2E Driver One', email: D1, contract: 'expired', vehicleId: v2 });
  ok((await adb.doc(`drivers/${r1.id}`).get()).get('contract') === 'expired' && (await adb.doc(`vehicles/${v2}`).get()).get('driverId') === r1.id, 'edit: contract + new vehicle saved');
  await call(A, 'accountToggle', { id: r1.id });
  ok((await aauth.getUser(r1.id)).disabled === true && (await adb.doc(`users/${r1.id}`).get()).get('status') === 'inactive', 'deactivate disables sign-in');
  await call(A, 'accountToggle', { id: r1.id });
  ok((await aauth.getUser(r1.id)).disabled === false, 'reactivate re-enables sign-in');
  const reset = await call(A, 'accountResetPassword', { id: r1.id });
  ok(reset.tempPassword && reset.tempPassword !== r1.tempPassword, 'password reset returns a new temporary password');
  const D = initializeApp(cfg, 'd');
  await signInWithEmailAndPassword(getAuth(D), D1, reset.tempPassword);
  ok(!!getAuth(D).currentUser, 'driver can sign in with the reset password');
  await signOut(getAuth(D));

  console.log('Staff & QR');
  const s1 = (await call(A, 'staffSave', { fullName: 'E2E Staff Person', unitCode: 'QA', unit: 'Testing', email: 'not-an-email' }).catch(e => e));
  ok(String(s1.code).includes('invalid-argument'), 'invalid staff email rejected');
  const sid = (await call(A, 'staffSave', { fullName: 'E2E Staff Person', unitCode: 'QA', unit: 'Testing' })).id; made.staff.push(sid);
  const st = (await adb.doc(`staff/${sid}`).get()).data(), tok1 = (await adb.doc(`staffSecrets/${sid}`).get()).get('qrToken');
  ok(/^STF-\d{4}$/.test(st.staffNo) && /^spk_/.test(tok1), `staff created as ${st.staffNo} with a QR token`);
  const anon = initializeApp(cfg, 'anon');
  const portal = d => httpsCallable(getFunctions(anon, 'europe-west1'), 'staffPortal')(d).then(r => r.data);
  ok((await portal({ type: 'lookup', token: tok1 })).staff.fullName === 'E2E Staff Person', 'new card works in the staff portal');
  await call(A, 'staffToken', { id: sid, action: 'revoke' });
  await expectFail(portal({ type: 'lookup', token: tok1 }), 'permission-denied', 'revoked card is refused');
  await call(A, 'staffToken', { id: sid, action: 'regenerate' });
  const tok2 = (await adb.doc(`staffSecrets/${sid}`).get()).get('qrToken');
  ok(tok2 !== tok1 && (await portal({ type: 'lookup', token: tok2 })).staff, 'regenerated card works');
  await expectFail(portal({ type: 'lookup', token: tok1 }), 'not-found', 'old card stays dead after regenerating');
  await call(A, 'staffToggle', { id: sid });
  await expectFail(portal({ type: 'lookup', token: tok2 }), 'permission-denied', 'inactive staff card refused');
  await expectFail(call(S, 'staffToken', { id: sid, action: 'regenerate' }), 'permission-denied', 'SPC cannot manage QR cards');
  for (const a of [A, S]) await signOut(getAuth(a));
}

async function cleanup() {
  let n = 0;
  const del = async q => { const s = await q.get(); for (const d of s.docs) { await d.ref.delete(); n++; } };
  for (const id of made.vehicles) { await del(adb.collection('maintenance').where('vehicleId', '==', id)); await adb.doc(`vehicles/${id}`).delete(); n++; }
  for (const id of made.staff) { await adb.doc(`staff/${id}`).delete(); await adb.doc(`staffSecrets/${id}`).delete(); n += 2; }
  for (const uid of made.uids) {
    await del(adb.collection('logs').where('userId', '==', uid));
    await adb.doc(`users/${uid}`).delete(); await adb.doc(`drivers/${uid}`).delete();
    try { await aauth.deleteUser(uid); } catch {}
  }
  const left = (await adb.collection('vehicles').get()).size + (await adb.collection('drivers').get()).size + (await adb.collection('maintenance').get()).size;
  const staff = (await adb.collection('staff').get()).size;
  console.log(`Cleanup: removed ${n} docs + ${made.uids.length} accounts; vehicles/drivers/maintenance left: ${left}; staff: ${staff} (expect 19)`);
}

(async () => {
  try { await run(); } catch (e) { failN++; console.log('  ERROR', e.code || '', e.message); }
  finally { await cleanup().catch(e => console.log('cleanup error', e.message)); }
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
