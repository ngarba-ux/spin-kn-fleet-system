// Live end-to-end test against spin-kn-fleet with throwaway e2e users. Cleans up after itself.
const path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const { KEY } = require('./env.cjs');
const reqF = createRequire(path.join(ROOT, 'functions/package.json'));
const reqW = createRequire(path.join(ROOT, 'web/package.json'));

const admin = { app: reqF('firebase-admin/app'), fs: reqF('firebase-admin/firestore'), auth: reqF('firebase-admin/auth') };
admin.app.initializeApp({ credential: admin.app.cert(require(KEY)) });
const adb = admin.fs.getFirestore();
const aauth = admin.auth.getAuth();

const { initializeApp } = reqW('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = reqW('firebase/auth');
const { getFunctions, httpsCallable } = reqW('firebase/functions');
const { getFirestore, doc, setDoc, getDoc, getDocs, collection, query, where } = reqW('firebase/firestore');
const cfg = { apiKey: 'AIzaSyDc3YRvJ_P2eq0z34PmD63HSg8kp05dRbA', authDomain: 'spin-kn-fleet.firebaseapp.com', projectId: 'spin-kn-fleet', storageBucket: 'spin-kn-fleet.firebasestorage.app', appId: '1:285522850455:web:f95154ead1e05b7d556fd2' };

const PW = 'E2e-' + Math.random().toString(36).slice(2) + '!x9';
const users = { admin: 'e2e-admin@example.invalid', spc: 'e2e-spc@example.invalid', driver: 'e2e-driver@example.invalid' };
const uids = {};
const created = { staff: 'e2e-staff', vehicle: 'e2e-vehicle', requestId: null, ref: null };
let pass = 0, failN = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  PASS', msg); } else { failN++; console.log('  FAIL', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(name) {
  const app = initializeApp(cfg, name);
  return { auth: getAuth(app), fn: getFunctions(app, 'europe-west1'), db: getFirestore(app) };
}
const call = (c, name, data) => httpsCallable(c.fn, name)(data).then(r => r.data);
async function expectFail(p, code, msg) {
  try { await p; ok(false, msg + ' (was allowed!)'); }
  catch (e) { ok(!code || String(e.code).includes(code), `${msg} -> ${e.code}`); }
}

// Real office accounts would receive the test notifications, so they are
// marked inactive (email only; sign-in is unaffected) and restored in cleanup.
const paused = [];

async function setup() {
  for (const d of (await adb.collection('users').where('status', '==', 'active').get()).docs)
    if (!String(d.get('email')).endsWith('@example.invalid')) { paused.push(d.id); await d.ref.update({ status: 'inactive' }); }
  for (const [role, email] of Object.entries(users)) {
    try { await aauth.deleteUser((await aauth.getUserByEmail(email)).uid); } catch {}
    const u = await aauth.createUser({ email, password: PW, displayName: 'E2E ' + role });
    await aauth.setCustomUserClaims(u.uid, { role, mustChangePassword: false });
    uids[role] = u.uid;
    await adb.doc(`users/${u.uid}`).set({ name: 'E2E ' + role, email, role, status: 'active', mustChangePassword: false, createdTs: new Date().toISOString(), e2e: true });
  }
  await adb.doc(`vehicles/${created.vehicle}`).set({ reg: 'E2E-TEST-1', model: 'Test Hilux', condition: 'ok', initialOdo: 1000, lastServiceOdo: 1000, lastOdo: 1000, driverId: uids.driver, activeTripId: null, e2e: true });
  await adb.doc(`drivers/${uids.driver}`).set({ name: 'E2E driver', email: users.driver, contract: 'active', vehicleId: created.vehicle, phone: '000', e2e: true });
  await adb.doc(`staff/${created.staff}`).set({ staffNo: 'E2E-1', fullName: 'E2E Staff', designation: 'Tester', unit: 'QA', email: null, phone: '', qrStatus: 'active', status: 'active', e2e: true });
  created.token = 'spk_e2e' + Math.random().toString(36).slice(2, 14);
  await adb.doc(`staffSecrets/${created.staff}`).set({ qrToken: created.token });
}

async function waitAction(id, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = (await adb.doc(`driverActions/${id}`).get()).data();
    if (s && s.state !== 'pending') return s;
    await sleep(2000);
  }
  return { state: 'timeout' };
}

async function run() {
  const anon = client('anon');
  console.log('1. Staff portal (QR token, no sign-in)');
  const home = await call(anon, 'staffPortal', { type: 'lookup', token: created.token });
  ok(home.staff.fullName === 'E2E Staff', 'lookup returns the staff member');
  await expectFail(call(anon, 'staffPortal', { type: 'lookup', token: 'spk_wrongtoken123' }), 'not-found', 'bad token rejected');
  const dep = new Date(Date.now() + 2 * 86400e3), ret = new Date(Date.now() + 3 * 86400e3);
  const sub = await call(anon, 'staffPortal', { type: 'submit', token: created.token, submissionId: 'e2e' + Date.now(), purpose: 'E2E test trip', destination: 'Test site', component: 'Irrigation & Drainage', departTs: dep.toISOString(), returnTs: ret.toISOString(), passengers: 2 });
  created.ref = sub.ref;
  created.requestId = sub.home.requests.find(r => r.ref === sub.ref).id;
  ok(/^TR-\d{4}-\d{6}$/.test(sub.ref), `request submitted as ${sub.ref}`);

  console.log('2. Security rules');
  await expectFail(getDocs(collection(anon.db, 'requests')), 'permission-denied', 'signed-out user cannot read requests');
  await expectFail(call(anon, 'requestAction', { type: 'ack', id: created.requestId }), 'unauthenticated', 'signed-out user cannot act on requests');

  const A = client('admin'), S = client('spc'), D = client('driver');
  await signInWithEmailAndPassword(A.auth, users.admin, PW);
  await signInWithEmailAndPassword(S.auth, users.spc, PW);
  await signInWithEmailAndPassword(D.auth, users.driver, PW);
  await expectFail(getDocs(collection(D.db, 'requests')), 'permission-denied', 'driver cannot read requests');
  await expectFail(getDoc(doc(S.db, `staffSecrets/${created.staff}`)), 'permission-denied', 'SPC cannot read QR tokens');
  ok((await getDoc(doc(A.db, `staffSecrets/${created.staff}`))).exists(), 'admin can read QR tokens');
  await expectFail(setDoc(doc(A.db, `vehicles/${created.vehicle}`), { reg: 'HACK' }, { merge: true }), 'permission-denied', 'direct vehicle writes blocked (functions only)');

  console.log('3. Office workflow');
  await call(A, 'requestAction', { type: 'ack', id: created.requestId });
  await expectFail(call(S, 'requestAction', { type: 'approve', id: created.requestId }), 'failed-precondition', 'SPC cannot approve before it is forwarded');
  await expectFail(call(S, 'requestAction', { type: 'forward', id: created.requestId }), 'permission-denied', 'SPC cannot forward (admin only)');
  await call(A, 'requestAction', { type: 'forward', id: created.requestId, driverId: uids.driver, remark: 'e2e' });
  let r = (await adb.doc(`requests/${created.requestId}`).get()).data();
  ok(r.status === 'FORWARDED_TO_SPC', 'admin acknowledged and forwarded to SPC');
  await call(S, 'requestAction', { type: 'approve', id: created.requestId });
  r = (await adb.doc(`requests/${created.requestId}`).get()).data();
  ok(r.status === 'DRIVER_ASSIGNED' && r.taskId, 'SPC approved -> proposed driver auto-assigned');
  const mails = await adb.collection('mail').where('requestId', '==', created.requestId).get();
  ok(mails.size >= 2, `${mails.size} notification emails recorded in the same transactions`);

  console.log('4. Driver app (queued actions)');
  const myTasks = await getDocs(query(collection(D.db, 'tasks'), where('driverId', '==', uids.driver)));
  ok(myTasks.docs.some(t => t.id === r.taskId), 'driver sees the assigned task');
  const put = (id, type, payload) => setDoc(doc(D.db, 'driverActions', id), { driverId: uids.driver, type, ts: new Date().toISOString(), seq: Date.now(), payload, state: 'pending', createdAt: new Date().toISOString() });
  await expectFail(setDoc(doc(D.db, 'driverActions', 'e2eforge'), { driverId: uids.admin, type: 'task.ack', ts: 'x', seq: 1, payload: {}, state: 'pending', createdAt: 'x' }), 'permission-denied', 'driver cannot queue actions as someone else');
  const startId = 'e2estart' + Date.now();
  await put(startId, 'trip.start', { taskId: r.taskId, odo: 1500 });
  let a = await waitAction(startId);
  ok(a.state === 'applied', `trip.start ${a.state}${a.error ? ': ' + a.error : ''}`);
  const tripId = 't-' + startId;
  const lowId = 'e2elow' + Date.now();
  await put(lowId, 'trip.end', { tripId, odo: 1400 });
  a = await waitAction(lowId);
  ok(a.state === 'rejected', `end with odometer below start rejected (${a.error})`);
  const endId = 'e2eend' + Date.now();
  await put(endId, 'trip.end', { tripId, odo: 1620 });
  a = await waitAction(endId);
  ok(a.state === 'applied', `trip.end ${a.state}${a.error ? ': ' + a.error : ''}`);
  r = (await adb.doc(`requests/${created.requestId}`).get()).data();
  const v = (await adb.doc(`vehicles/${created.vehicle}`).get()).data();
  ok(r.status === 'TRIP_COMPLETED', 'request moved to TRIP_COMPLETED');
  ok(v.lastOdo === 1620 && !v.activeTripId, 'vehicle odometer updated and freed');

  console.log('5. Close and status page');
  await call(A, 'requestAction', { type: 'close', id: created.requestId });
  const st = await call(anon, 'staffPortal', { type: 'status', statusToken: r.statusToken });
  ok(st.status === 'CLOSED' && st.timeline.length >= 6, `status page shows CLOSED with ${st.timeline.length} steps`);
  for (const c of [A, S, D]) await signOut(c.auth);
}

async function cleanup() {
  for (const id of paused) await adb.doc(`users/${id}`).update({ status: 'active' });
  console.log('Cleanup');
  const del = async q => { const s = await q.get(); for (const d of s.docs) await d.ref.delete(); return s.size; };
  let n = 0;
  if (created.requestId) {
    n += await del(adb.collection('mail').where('requestId', '==', created.requestId));
    n += await del(adb.collection('tasks').where('requestId', '==', created.requestId));
    n += await del(adb.collection('trips').where('requestId', '==', created.requestId));
    await adb.doc(`requests/${created.requestId}`).delete(); n++;
  }
  if (uids.driver) n += await del(adb.collection('driverActions').where('driverId', '==', uids.driver));
  for (const uid of Object.values(uids)) n += await del(adb.collection('logs').where('userId', '==', uid));
  n += await del(adb.collection('logs').where('userId', '==', `staff:${created.staff}`));
  n += await del(adb.collection('processed'));
  for (const p of [`vehicles/${created.vehicle}`, `staff/${created.staff}`, `staffSecrets/${created.staff}`]) { await adb.doc(p).delete(); n++; }
  for (const uid of Object.values(uids)) { await adb.doc(`users/${uid}`).delete(); await adb.doc(`drivers/${uid}`).delete(); await aauth.deleteUser(uid); }
  await adb.doc('counters/requests').set({ seq: 0 });
  const leftovers = (await adb.collection('mail').get()).size + (await adb.collection('requests').get()).size + (await adb.collection('trips').get()).size;
  console.log(`  removed ${n} documents + 3 test accounts; counter reset; leftover test data: ${leftovers}`);
}

(async () => {
  try { await setup(); await run(); }
  catch (e) { failN++; console.log('  ERROR', e.code || '', e.message); }
  finally { await cleanup().catch(e => console.log('  cleanup error', e.message)); }
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
