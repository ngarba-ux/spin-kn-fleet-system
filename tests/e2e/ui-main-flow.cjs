// Browser test of the live SPIN-KN Fleet app (https://spin-kn-fleet.web.app) using Chrome.
// Uses throwaway accounts and cleans up everything it creates.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '../..');
const { KEY } = require('./env.cjs');
const { CHROME } = require('./env.cjs');
const URL = 'https://spin-kn-fleet.web.app';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const reqF = createRequire(path.join(ROOT, 'functions/package.json'));
const aApp = reqF('firebase-admin/app'), aFs = reqF('firebase-admin/firestore'), aAuth = reqF('firebase-admin/auth');
aApp.initializeApp({ credential: aApp.cert(require(KEY)) });
const db = aFs.getFirestore(), auth = aAuth.getAuth();

const PW = 'UiTest-' + Math.random().toString(36).slice(2, 10) + '!9';
const NEWPW = 'UiTest-new-' + Math.random().toString(36).slice(2, 8);
const EM = { admin: 'ui-admin@example.invalid', spc: 'ui-spc@example.invalid', fresh: 'ui-fresh@example.invalid', driver: 'ui-driver@example.invalid' };
const REG = 'UI-TEST-01';
const made = { uids: [], staffId: 'ui-test-staff', token: 'spk_uitest' + Math.random().toString(36).slice(2, 12), startTs: new Date().toISOString(), paused: [] };
let pass = 0, failN = 0, shot = 0;
const errors = [];
const ok = (c, m) => { c ? pass++ : failN++; console.log(c ? '  PASS' : '  FAIL', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- page helpers

function wire(page, who) {
  page.on('pageerror', e => errors.push(`[${who}] page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_BLOCKED_BY_CLIENT/.test(m.text())) errors.push(`[${who}] console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', async d => { await d.accept(d.type() === 'prompt' ? 'UI test reason' : undefined); });
}

async function snap(page, name) { await page.screenshot({ path: path.join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`) }); }

const waitText = (page, t, timeout = 30000) => page.waitForFunction(x => document.body.innerText.includes(x), { timeout }, t);
const hasText = (page, t) => page.evaluate(x => document.body.innerText.includes(x), t);

// Click the last visible button/link whose text matches exactly (or starts with, if prefix=true).
async function click(page, text, { prefix = false, tag = 'button' } = {}) {
  const done = await page.evaluate((text, prefix, tag) => {
    const els = [...document.querySelectorAll(tag)].filter(b => {
      const t = b.innerText.trim();
      return (prefix ? t.startsWith(text) : t === text) && b.offsetParent !== null && !b.disabled;
    });
    const el = els.at(-1);
    if (el) el.click();
    return !!el;
  }, text, prefix, tag);
  if (!done) throw new Error(`No clickable ${tag} "${text}"`);
  await sleep(300);
}

// Set a field by its label text, the way React expects (native setter + events).
async function fill(page, label, value) {
  const done = await page.evaluate((label, value) => {
    const lab = [...document.querySelectorAll('label')].filter(l => l.offsetParent !== null).reverse()
      .find(l => l.querySelector('span')?.innerText.trim() === label);
    const el = lab?.querySelector('input, select, textarea');
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, label, value);
  if (!done) throw new Error(`No field "${label}"`);
}

async function signIn(page, email, pw) {
  await page.goto(URL + '/', { waitUntil: 'networkidle2' });
  await waitText(page, 'Sign in');
  await fill(page, 'Email', email);
  await fill(page, 'Password', pw);
  await click(page, 'Sign in');
}

async function newSession(browser, who, mobile) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
  wire(page, who);
  return { ctx, page };
}

async function mkUser(email, role, mustChange) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch {}
  const u = await auth.createUser({ email, password: PW, displayName: 'UI test ' + role });
  await auth.setCustomUserClaims(u.uid, { role, mustChangePassword: mustChange });
  await db.doc(`users/${u.uid}`).set({ name: 'UI test ' + role, email, role, status: 'active', mustChangePassword: mustChange, createdTs: new Date().toISOString() });
  made.uids.push(u.uid);
  return u.uid;
}

const tomorrow = () => { const d = new Date(Date.now() + 86400e3); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- the test

async function run(browser) {
  // Pause email to the real office accounts while the test runs.
  for (const s of (await db.collection('users').where('status', '==', 'active').get()).docs) {
    if (!s.get('email').endsWith('@example.invalid')) { made.paused.push(s.id); await s.ref.update({ status: 'inactive' }); }
  }
  console.log(`(emails to ${made.paused.length} real office accounts paused for the test)`);
  made.counter = (await db.doc('counters/requests').get()).get('seq') ?? 0;

  await mkUser(EM.admin, 'admin', false);
  await mkUser(EM.spc, 'spc', false);
  await mkUser(EM.fresh, 'admin', true);
  await db.doc(`staff/${made.staffId}`).set({ staffNo: 'UI-1', fullName: 'UI Test Staff', designation: 'Tester', unitCode: 'QA', unit: 'Quality', email: null, phone: '0800 000 0000', qrStatus: 'active', status: 'active' });
  await db.doc(`staffSecrets/${made.staffId}`).set({ qrToken: made.token });

  console.log('1. Sign-in screens');
  const A = await newSession(browser, 'admin');
  await A.page.goto(URL + '/', { waitUntil: 'networkidle2' });
  ok(await hasText(A.page, 'Sign in') && await hasText(A.page, 'scan the QR code'), 'sign-in page renders');
  await fill(A.page, 'Email', EM.admin); await fill(A.page, 'Password', 'wrong-password');
  await click(A.page, 'Sign in');
  await waitText(A.page, "don't match");
  ok(true, 'wrong password shows a friendly error');
  await snap(A.page, 'login-error');

  const F = await newSession(browser, 'fresh');
  await signIn(F.page, EM.fresh, PW);
  await waitText(F.page, 'Choose your password');
  ok(true, 'first sign-in forces a password change');
  await fill(F.page, 'New password', 'short'); await fill(F.page, 'Repeat new password', 'short');
  await click(F.page, 'Save password');
  ok(await hasText(F.page, 'at least 8 characters'), 'short password rejected in the form');
  await fill(F.page, 'New password', NEWPW); await fill(F.page, 'Repeat new password', NEWPW);
  await click(F.page, 'Save password');
  await waitText(F.page, 'Needs the office', 40000);
  ok(true, 'after choosing a password, the office dashboard opens');
  await F.ctx.close();
  const F2 = await newSession(browser, 'fresh2');
  await signIn(F2.page, EM.fresh, NEWPW);
  await waitText(F2.page, 'Needs the office', 30000);
  ok(true, 'the new password works on a fresh sign-in');
  await F2.ctx.close();

  console.log('2. Admin: vehicles');
  await signIn(A.page, EM.admin, PW);
  await waitText(A.page, 'Needs the office');
  await snap(A.page, 'dashboard');
  await A.page.goto(URL + '/#/vehicles'); await waitText(A.page, 'Add vehicle');
  await click(A.page, 'Add vehicle');
  await fill(A.page, 'Registration *', 'ui-test-01'); await fill(A.page, 'Make & model *', 'Toyota Hilux 2.4');
  await fill(A.page, 'Colour', 'White'); await fill(A.page, 'Current odometer (km)', '20000');
  const soon = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
  await fill(A.page, 'Insurance expires', soon);
  await snap(A.page, 'vehicle-form');
  await click(A.page, 'Save');
  await waitText(A.page, REG);
  ok(await hasText(A.page, 'Available') && await hasText(A.page, '20,000 km'), 'new vehicle card shows Available, 20,000 km');
  ok(await hasText(A.page, 'Insurance due'), 'insurance expiring in 10 days shows a warning');
  await click(A.page, 'Record service');
  await fill(A.page, 'Odometer at service (km)', '20100'); await fill(A.page, 'Cost (₦)', '35000');
  await click(A.page, 'Save');
  await waitText(A.page, '20,100 km');
  ok(true, 'record service updates the odometer to 20,100 km');
  const setCondition = async value => {
    await A.page.waitForFunction(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'maintenance')); return s && !s.disabled; });
    await A.page.evaluate(v => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'maintenance')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); }, value);
    for (let i = 0; i < 20; i++) { const q = await db.collection('vehicles').where('reg', '==', REG).get(); if (q.docs[0]?.get('condition') === value) return true; await sleep(1000); }
    return false;
  };
  ok(await setCondition('maintenance') && await hasText(A.page, 'Under maintenance'), 'condition select -> Under maintenance');
  ok(await setCondition('ok'), 'condition select -> back in service');
  await waitText(A.page, 'Available');
  await snap(A.page, 'vehicles');
  const vehicleId = (await db.collection('vehicles').where('reg', '==', REG).get()).docs[0]?.id;
  made.vehicleId = vehicleId;

  console.log('3. Admin: drivers');
  await A.page.goto(URL + '/#/drivers'); await waitText(A.page, 'Add driver');
  await click(A.page, 'Add driver');
  await fill(A.page, 'Full name *', 'UI Test Driver'); await fill(A.page, 'Email (sign-in) *', EM.driver);
  await fill(A.page, 'Phone', '0803 000 1111'); await fill(A.page, 'Licence expires', '2028-12-31');
  await fill(A.page, 'Assigned vehicle', vehicleId);
  await click(A.page, 'Create driver');
  await waitText(A.page, 'Account ready', 40000);
  const driverPw = await A.page.evaluate(() => document.querySelector('dd.font-mono')?.innerText.trim());
  ok(driverPw && driverPw.length >= 10, 'temporary password dialog shown after creating a driver');
  await snap(A.page, 'driver-temp-password');
  await click(A.page, 'Done');
  await waitText(A.page, 'UI Test Driver');
  ok(await hasText(A.page, `${REG} · Toyota Hilux 2.4`) && await hasText(A.page, 'Not signed in yet'), 'driver card shows the vehicle and "Not signed in yet"');
  const driverUid = (await auth.getUserByEmail(EM.driver)).uid; made.uids.push(driverUid);

  console.log('4. Admin: staff & QR');
  await A.page.goto(URL + '/#/staff'); await waitText(A.page, 'Print all cards');
  const rows = await A.page.evaluate(() => document.querySelectorAll('tbody tr').length);
  ok(rows >= 20, `staff table lists ${rows} people (19 real + test)`);
  await A.page.evaluate(() => { window.__printed = -1; window.print = () => { window.__printed = document.querySelectorAll('#print-root .qr-card').length; window.__svg = document.querySelectorAll('#print-root .qr-card svg').length; }; });
  await click(A.page, 'Print all cards', { prefix: true });
  await sleep(400);
  const printed = await A.page.evaluate(() => [window.__printed, window.__svg]);
  ok(printed[0] >= 20 && printed[1] === printed[0], `print all builds ${printed[0]} cards, each with a QR code`);
  await A.page.evaluate(() => document.body.classList.remove('print-mode'));
  await A.page.evaluate(id => { const row = [...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes('UI Test Staff')); [...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'QR').click(); }, made.staffId);
  await waitText(A.page, 'Copy link');
  const link = await A.page.evaluate(() => document.querySelector('.qr-preview svg') ? document.querySelector('.font-mono.text-xs')?.innerText : null);
  ok(link === `${URL}/#s=${made.token}`, 'QR dialog shows the code and the right card link');
  await snap(A.page, 'staff-qr');
  await click(A.page, '×');

  console.log('5. Staff portal (phone)');
  const S = await newSession(browser, 'staff', true);
  await S.page.goto(`${URL}/#s=${made.token}`, { waitUntil: 'networkidle2' });
  await waitText(S.page, 'UI Test Staff');
  ok(await hasText(S.page, 'No requests yet'), 'card opens the staff portal');
  await click(S.page, 'Request a vehicle');
  await fill(S.page, 'Purpose of trip', 'UI test site visit'); await fill(S.page, 'Destination', 'Bichi irrigation scheme');
  await fill(S.page, 'Departure date', tomorrow()); await fill(S.page, 'Return date', tomorrow());
  await fill(S.page, 'Passengers', '2');
  await snap(S.page, 'staff-form');
  await click(S.page, 'Send request');
  await waitText(S.page, 'sent. You will get an email', 40000);
  const ref = await S.page.evaluate(() => (document.body.innerText.match(/TR-\d{4}-\d{6}/) || [])[0]);
  ok(!!ref, `request submitted from the phone as ${ref}`);
  await snap(S.page, 'staff-submitted');
  const reqDoc = (await db.collection('requests').where('ref', '==', ref).get()).docs[0];
  made.requestId = reqDoc.id;

  console.log('6. Admin: request workflow');
  await A.page.goto(URL + '/#/requests'); await waitText(A.page, ref);
  await click(A.page, ref, { tag: 'a', prefix: true });
  await waitText(A.page, 'Acknowledge');
  await click(A.page, 'Acknowledge');
  await waitText(A.page, 'Acknowledged');
  await fill(A.page, 'Propose a driver (optional)', driverUid);
  await click(A.page, 'Forward to SPC');
  await waitText(A.page, 'Awaiting SPC');
  ok(true, 'admin acknowledged and forwarded with a proposed driver');
  await snap(A.page, 'request-forwarded');

  console.log('7. SPC approves');
  const P = await newSession(browser, 'spc');
  await signIn(P.page, EM.spc, PW);
  await waitText(P.page, ref, 30000);
  ok(!(await hasText(P.page, 'Staff & QR')), 'SPC menu has no Staff & QR');
  await click(P.page, ref, { tag: 'a', prefix: true });
  await waitText(P.page, 'Approve');
  ok(!(await hasText(P.page, 'Forward to SPC')), 'SPC does not see admin-only actions');
  await click(P.page, 'Approve');
  await waitText(P.page, 'Driver assigned', 30000);
  ok(await hasText(P.page, `UI Test Driver · ${REG}`), 'approval auto-assigns the proposed driver and vehicle');
  await snap(P.page, 'spc-approved');
  await P.page.goto(URL + '/#/vehicles'); await waitText(P.page, REG);
  ok(!(await hasText(P.page, 'Add vehicle')) && !(await hasText(P.page, 'Record service')), 'SPC sees vehicles read-only');
  await P.ctx.close();

  console.log('8. Driver (phone)');
  const D = await newSession(browser, 'driver', true);
  await signIn(D.page, EM.driver, driverPw);
  await waitText(D.page, 'Choose your password', 30000);
  await fill(D.page, 'New password', NEWPW); await fill(D.page, 'Repeat new password', NEWPW);
  await click(D.page, 'Save password');
  await waitText(D.page, 'My tasks', 40000);
  await waitText(D.page, 'UI test site visit', 30000);
  ok(await hasText(D.page, 'For UI Test Staff'), 'driver sees the task with the requester');
  await snap(D.page, 'driver-tasks');
  await click(D.page, 'Start trip');
  await fill(D.page, 'Odometer at start (km)', '20150');
  await click(D.page, 'Start');
  await waitText(D.page, `On a trip · ${REG}`, 20000);
  ok(true, 'starting the trip shows "On a trip" immediately');
  await waitText(D.page, 'All saved', 60000);
  ok(true, 'the start was uploaded and applied ("All saved")');
  await click(D.page, 'Log a stop');
  await waitText(D.page, 'stopped now', 20000);
  await click(D.page, 'Resume');
  await sleep(500);
  await click(D.page, 'End trip');
  await fill(D.page, 'Odometer at end (km)', '20230');
  await click(D.page, 'Finish trip');
  await waitText(D.page, 'Recent trips');
  await waitText(D.page, '80 km', 60000);
  ok(true, 'ending the trip shows it in Recent trips with 80 km');
  await waitText(D.page, 'All saved', 60000);
  await snap(D.page, 'driver-done');

  let status;
  for (let i = 0; i < 20; i++) { status = (await db.doc(`requests/${made.requestId}`).get()).get('status'); if (status === 'TRIP_COMPLETED') break; await sleep(2000); }
  ok(status === 'TRIP_COMPLETED', `request is now ${status}`);
  const v = (await db.doc(`vehicles/${vehicleId}`).get()).data();
  ok(v.lastOdo === 20230 && !v.activeTripId, 'vehicle odometer 20,230 and free again');

  console.log('9. Status page + close');
  await S.page.goto(`${URL}/#r=${reqDoc.get('statusToken')}`, { waitUntil: 'networkidle2' });
  await waitText(S.page, 'Trip completed', 30000);
  ok(await hasText(S.page, 'UI Test Driver') && await hasText(S.page, REG), 'status page shows driver, vehicle and the completed trip');
  await snap(S.page, 'status-page');
  await A.page.goto(URL + '/#/requests/' + made.requestId); await waitText(A.page, 'Close request');
  await click(A.page, 'Close request');
  await waitText(A.page, 'Closed');
  ok(true, 'admin closes the completed request');
  await D.ctx.close(); await S.ctx.close(); await A.ctx.close();
}

// ---------------------------------------------------------------- cleanup

async function cleanup() {
  let n = 0;
  const del = async q => { const s = await q.get(); for (const d of s.docs) { await d.ref.delete(); n++; } };
  for (const id of made.paused) await db.doc(`users/${id}`).update({ status: 'active' });
  if (made.requestId) {
    await del(db.collection('mail').where('requestId', '==', made.requestId));
    await del(db.collection('tasks').where('requestId', '==', made.requestId));
    await del(db.collection('trips').where('requestId', '==', made.requestId));
    await db.doc(`requests/${made.requestId}`).delete(); n++;
  }
  if (made.vehicleId) { await del(db.collection('maintenance').where('vehicleId', '==', made.vehicleId)); await db.doc(`vehicles/${made.vehicleId}`).delete(); n++; }
  for (const uid of made.uids) {
    await del(db.collection('driverActions').where('driverId', '==', uid));
    await del(db.collection('logs').where('userId', '==', uid));
    await db.doc(`users/${uid}`).delete(); await db.doc(`drivers/${uid}`).delete();
    try { await auth.deleteUser(uid); } catch {}
  }
  await del(db.collection('logs').where('userId', '==', `staff:${made.staffId}`));
  const subs = await db.collection('processed').get();
  for (const d of subs.docs) if (d.get('ts') >= made.startTs) { await d.ref.delete(); n++; }
  await db.doc(`staff/${made.staffId}`).delete(); await db.doc(`staffSecrets/${made.staffId}`).delete();
  if (made.counter !== undefined) await db.doc('counters/requests').set({ seq: made.counter });
  const active = (await db.collection('users').where('status', '==', 'active').get()).docs.map(d => d.get('email'));
  const left = ['vehicles', 'drivers', 'requests', 'tasks', 'trips', 'maintenance'];
  const counts = await Promise.all(left.map(c => db.collection(c).get().then(s => s.size)));
  console.log(`Cleanup: removed ${n} docs + ${made.uids.length} accounts; real accounts active again: ${active.join(', ')}`);
  console.log(`  leftover ${left.map((c, i) => `${c}=${counts[i]}`).join(' ')}; staff=${(await db.collection('staff').get()).size}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--disable-extensions'] });
  try { await run(browser); }
  catch (e) { failN++; console.log('  ERROR', e.message.split('\n')[0]); try { const pages = await browser.pages(); for (const p of pages) await snap(p, 'error'); } catch {} }
  finally {
    await browser.close().catch(() => {});
    await cleanup().catch(e => console.log('cleanup error', e.message));
  }
  console.log(errors.length ? `\nBrowser errors (${errors.length}):\n  ` + [...new Set(errors)].slice(0, 15).join('\n  ') : '\nNo browser errors.');
  console.log(`\n${pass} passed, ${failN} failed. Screenshots: ${SHOTS}`);
  process.exit(failN ? 1 : 0);
})();
