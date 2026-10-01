// Tests the 'super' role (admin + SPC with a two-person check) against the live app.
const path = require('node:path');
const { createRequire } = require('node:module');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../..');
const { KEY } = require('./env.cjs');
const URL = 'https://spin-kn-fleet.web.app';
const reqF = createRequire(path.join(ROOT, 'functions/package.json'));
const reqW = createRequire(path.join(ROOT, 'web/package.json'));
const aApp = reqF('firebase-admin/app'), aFs = reqF('firebase-admin/firestore'), aAuth = reqF('firebase-admin/auth');
aApp.initializeApp({ credential: aApp.cert(require(KEY)) });
const db = aFs.getFirestore(), auth = aAuth.getAuth();
const { initializeApp } = reqW('firebase/app');
const { getAuth, signInWithEmailAndPassword } = reqW('firebase/auth');
const { getFunctions, httpsCallable } = reqW('firebase/functions');
const { getFirestore, getDoc, doc } = reqW('firebase/firestore');
const cfg = { apiKey: 'AIzaSyDc3YRvJ_P2eq0z34PmD63HSg8kp05dRbA', authDomain: 'spin-kn-fleet.firebaseapp.com', projectId: 'spin-kn-fleet', appId: '1:285522850455:web:f95154ead1e05b7d556fd2' };

const PW = 'Super-' + Math.random().toString(36).slice(2, 10) + '!9';
const EM = { sup: 'su-super@example.invalid', admin: 'su-admin@example.invalid', spc: 'su-spc@example.invalid', extra: 'su-extra@example.invalid' };
const made = { uids: [], staffId: 'su-test-staff', token: 'spk_sutest' + Math.random().toString(36).slice(2, 12), requests: [], paused: [], startTs: new Date().toISOString() };
let pass = 0, failN = 0;
const ok = (c, m) => { c ? pass++ : failN++; console.log(c ? '  PASS' : '  FAIL', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function expectFail(p, code, m) { try { await p; ok(false, m + ' (was allowed!)'); } catch (e) { const s = String(e.code) + ' ' + JSON.stringify(e.details || ''); ok(s.includes(code), `${m} -> ${e.code}`); } }

async function mkUser(email, role) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch {}
  const u = await auth.createUser({ email, password: PW, displayName: 'SU test ' + role });
  await auth.setCustomUserClaims(u.uid, { role, mustChangePassword: false });
  await db.doc(`users/${u.uid}`).set({ name: 'SU test ' + role, email, role, status: 'active', mustChangePassword: false, createdTs: new Date().toISOString() });
  made.uids.push(u.uid); return u.uid;
}
async function client(name, email) { const app = initializeApp(cfg, name); if (email) await signInWithEmailAndPassword(getAuth(app), email, PW); return app; }
const fn = (app, n, d) => httpsCallable(getFunctions(app, 'europe-west1'), n)(d).then(r => r.data);
const status = async id => (await db.doc(`requests/${id}`).get()).get('status');

async function submit(anon, purpose) {
  const day = new Date(Date.now() + 3 * 86400e3);
  const r = await fn(anon, 'staffPortal', { type: 'submit', token: made.token, submissionId: 'su' + Date.now() + Math.random().toString(36).slice(2, 6), purpose, destination: 'Test', component: 'Irrigation & Drainage', departTs: day.toISOString(), returnTs: new Date(day.getTime() + 3600e3).toISOString(), passengers: 1 });
  const id = (await db.collection('requests').where('ref', '==', r.ref).get()).docs[0].id;
  made.requests.push(id); return id;
}

async function run() {
  for (const s of (await db.collection('users').where('status', '==', 'active').get()).docs)
    if (!s.get('email').endsWith('@example.invalid')) { made.paused.push(s.id); await s.ref.update({ status: 'inactive' }); }
  made.counter = (await db.doc('counters/requests').get()).get('seq') ?? 0;
  const supUid = await mkUser(EM.sup, 'super'); const adminUid = await mkUser(EM.admin, 'admin'); await mkUser(EM.spc, 'spc');
  await db.doc(`staff/${made.staffId}`).set({ staffNo: 'SU-1', fullName: 'SU Test Staff', designation: 'Tester', unit: 'QA', email: null, phone: '', qrStatus: 'active', status: 'active' });
  await db.doc(`staffSecrets/${made.staffId}`).set({ qrToken: made.token });
  const anon = await client('anon'), S = await client('sup', EM.sup), A = await client('adm', EM.admin), P = await client('spc', EM.spc);

  console.log('1. Super user does admin work');
  ok((await getDoc(doc(getFirestore(S), `staffSecrets/${made.staffId}`))).exists(), 'can read staff QR tokens (admin-only data)');
  const v = await fn(S, 'vehicleSave', { reg: 'SU-TEST-01', model: 'Test' }); made.vehicleId = v.id;
  ok(!!v.id, 'can add a vehicle');
  await fn(S, 'staffToken', { id: made.staffId, action: 'regenerate' });
  made.token = (await db.doc(`staffSecrets/${made.staffId}`).get()).get('qrToken');
  ok(true, 'can regenerate a QR card');

  console.log('2. Two-person check');
  const r1 = await submit(anon, 'SU own forward');
  await fn(S, 'requestAction', { type: 'ack', id: r1 });
  await fn(S, 'requestAction', { type: 'forward', id: r1 });
  ok(await status(r1) === 'FORWARDED_TO_SPC', 'super user acknowledges and forwards');
  const mails = await db.collection('mail').where('requestId', '==', r1).get();
  ok(mails.docs.some(m => m.get('to') === EM.sup && /awaiting your decision/.test(m.get('message.subject'))), 'super user also gets the SPC "awaiting your decision" email');
  await expectFail(fn(S, 'requestAction', { type: 'approve', id: r1 }), 'sameApprover', 'cannot approve a request they forwarded');
  await expectFail(fn(S, 'requestAction', { type: 'reject', id: r1, comment: 'x' }), 'sameApprover', 'cannot decline a request they forwarded');
  const day = new Date(Date.now() + 5 * 86400e3);
  await fn(S, 'requestAction', { type: 'reschedule', id: r1, departTs: day.toISOString(), returnTs: new Date(day.getTime() + 3600e3).toISOString(), comment: 'move' });
  ok(await status(r1) === 'FORWARDED_TO_SPC', 'rescheduling their own forward does not approve it');
  await fn(P, 'requestAction', { type: 'approve', id: r1 });
  ok(await status(r1) === 'APPROVED', 'the real SPC can still approve it');

  const r2 = await submit(anon, 'SU approves admin forward');
  await fn(A, 'requestAction', { type: 'forward', id: r2 });
  await fn(S, 'requestAction', { type: 'approve', id: r2 });
  ok(await status(r2) === 'APPROVED', 'super user approves a request someone else forwarded');
  const r3 = await submit(anon, 'SU declines admin forward');
  await fn(A, 'requestAction', { type: 'forward', id: r3 });
  await fn(S, 'requestAction', { type: 'reject', id: r3, comment: 'Not needed' });
  ok(await status(r3) === 'REJECTED', 'super user declines a request someone else forwarded');
  await expectFail(fn(A, 'requestAction', { type: 'approve', id: r3 }), 'permission-denied', 'ordinary admin still cannot approve');

  console.log('3. Protecting the super account');
  await expectFail(fn(A, 'accountSave', { name: 'X', email: EM.extra, role: 'super' }), 'permission-denied', 'an admin cannot create a super user');
  await expectFail(fn(A, 'accountResetPassword', { id: supUid }), 'permission-denied', "an admin cannot reset a super user's password");
  await expectFail(fn(A, 'accountToggle', { id: supUid }), 'permission-denied', 'an admin cannot deactivate a super user');
  await expectFail(fn(A, 'accountSave', { id: supUid, name: 'X', email: EM.sup, role: 'admin' }), 'permission-denied', 'an admin cannot downgrade a super user');
  await expectFail(fn(S, 'accountSave', { id: supUid, name: 'X', email: EM.sup, role: 'admin' }), 'invalid-argument', 'a super user cannot change their own role');
  const ex = await fn(S, 'accountSave', { name: 'SU extra', email: EM.extra, role: 'spc' });
  made.uids.push((await auth.getUserByEmail(EM.extra)).uid);
  ok(!!ex.tempPassword, 'a super user can create office accounts');
  await fn(S, 'accountToggle', { id: adminUid }); await fn(S, 'accountToggle', { id: adminUid });
  ok(true, 'a super user can deactivate/reactivate an admin');

  console.log('4. Screens');
  const browser = await puppeteer.launch({ executablePath: require('./env.cjs').CHROME, headless: true });
  try {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(URL + '/', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Sign in'));
    await page.evaluate((e, p) => { const set = (lab, v) => { const el = [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.innerText === lab).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('Email', e); set('Password', p); [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Sign in').click(); }, EM.sup, PW);
    await page.waitForFunction(() => document.body.innerText.includes('Super user · Admin + SPC'), { timeout: 30000 });
    const nav = await page.evaluate(() => [...document.querySelectorAll('nav a')].map(a => a.innerText));
    ok(nav.includes('Staff & QR') && nav.includes('Tasks') && nav.includes('Settings'), 'menu shows the full admin menu, labelled "Super user · Admin + SPC"');
    const r4 = await submit(anon, 'SU screen own'); await fn(S, 'requestAction', { type: 'forward', id: r4 });
    await page.goto(`${URL}/#/requests/${r4}`); await page.waitForFunction(() => document.body.innerText.includes('History'), { timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('someone else must approve'), { timeout: 30000 }).catch(() => {});
    const own = await page.evaluate(() => ({ note: document.body.innerText.includes('someone else must approve'), approve: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Approve') }));
    ok(own.note && !own.approve, 'own forward: shows the two-person note, no Approve button');
    const r5 = await submit(anon, 'SU screen other'); await fn(A, 'requestAction', { type: 'forward', id: r5 });
    await page.goto(`${URL}/#/requests/${r5}`);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Approve'), { timeout: 30000 });
    const other = await page.evaluate(() => ({ decline: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Decline'), ret: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Return for correction') }));
    ok(other.decline && other.ret, "someone else's forward: Approve, Decline and Return are offered");
    await page.goto(`${URL}/#/staff`); await page.waitForFunction(() => document.body.innerText.includes('Print all cards'), { timeout: 30000 });
    ok(true, 'Staff & QR page opens with QR tokens');
  } finally { await browser.close(); }
}

async function cleanup() {
  let n = 0;
  const del = async q => { const s = await q.get(); for (const d of s.docs) { await d.ref.delete(); n++; } };
  for (const id of made.paused) await db.doc(`users/${id}`).update({ status: 'active' });
  for (const id of made.requests) { await del(db.collection('mail').where('requestId', '==', id)); await del(db.collection('tasks').where('requestId', '==', id)); await db.doc(`requests/${id}`).delete(); n++; }
  if (made.vehicleId) { await db.doc(`vehicles/${made.vehicleId}`).delete(); n++; }
  for (const uid of made.uids) { await del(db.collection('logs').where('userId', '==', uid)); await db.doc(`users/${uid}`).delete(); try { await auth.deleteUser(uid); } catch {} }
  await del(db.collection('logs').where('userId', '==', `staff:${made.staffId}`));
  for (const d of (await db.collection('processed').get()).docs) if (d.get('ts') >= made.startTs) { await d.ref.delete(); n++; }
  await db.doc(`staff/${made.staffId}`).delete(); await db.doc(`staffSecrets/${made.staffId}`).delete();
  if (made.counter !== undefined) await db.doc('counters/requests').set({ seq: made.counter });
  const active = (await db.collection('users').where('status', '==', 'active').get()).docs.map(d => d.get('email'));
  const counts = await Promise.all(['vehicles', 'requests', 'tasks', 'mail'].map(c => db.collection(c).get().then(s => `${c}=${s.size}`)));
  console.log(`Cleanup: removed ${n} docs + ${made.uids.length} accounts; active real accounts: ${active.join(', ')}; ${counts.join(' ')}; staff=${(await db.collection('staff').get()).size}`);
}

(async () => {
  try { await run(); } catch (e) { failN++; console.log('  ERROR', e.code || '', e.message.split('\n')[0]); }
  finally { await cleanup().catch(e => console.log('cleanup error', e.message)); }
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
