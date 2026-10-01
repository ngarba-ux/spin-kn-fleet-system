// Browser test of the daily-operations screens (Tasks, Trips, Fuel & service) on the live app.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '../..');
const { KEY } = require('./env.cjs');
const { CHROME } = require('./env.cjs');
const URL = 'https://spin-kn-fleet.web.app';
const SHOTS = path.join(__dirname, 'shots-ops');
fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });

const reqF = createRequire(path.join(ROOT, 'functions/package.json'));
const aApp = reqF('firebase-admin/app'), aFs = reqF('firebase-admin/firestore'), aAuth = reqF('firebase-admin/auth'), aSt = reqF('firebase-admin/storage');
aApp.initializeApp({ credential: aApp.cert(require(KEY)), storageBucket: 'spin-kn-fleet.firebasestorage.app' });
const db = aFs.getFirestore(), auth = aAuth.getAuth();

const PW = 'OpsTest-' + Math.random().toString(36).slice(2, 10) + '!9';
const EM = { admin: 'ops-admin@example.invalid', spc: 'ops-spc@example.invalid', driver: 'ops-driver@example.invalid' };
const REG = 'OPS-TEST-01';
const made = { uids: [], vehicleId: 'ops-test-vehicle' };
let pass = 0, failN = 0, shot = 0;
const errors = [];
const ok = (c, m) => { c ? pass++ : failN++; console.log(c ? '  PASS' : '  FAIL', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function wire(page, who) {
  page.on('pageerror', e => errors.push(`[${who}] page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`[${who}] console: ${m.text().slice(0, 200)}`); });
  page.on('dialog', async d => { await d.accept(d.type() === 'prompt' ? 'Checkpoint' : undefined); });
}
const snap = (page, name) => page.screenshot({ path: path.join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`) });
const waitText = (page, t, timeout = 30000) => page.waitForFunction(x => document.body.innerText.includes(x), { timeout }, t);
const hasText = (page, t) => page.evaluate(x => document.body.innerText.includes(x), t);
async function click(page, text, { prefix = false, tag = 'button', within } = {}) {
  const done = await page.evaluate((text, prefix, tag, within) => {
    const scope = within ? [...document.querySelectorAll('tr, li, section')].filter(e => e.innerText.includes(within)).at(-1) : document;
    const els = [...(scope ?? document).querySelectorAll(tag)].filter(b => { const t = b.innerText.trim(); return (prefix ? t.startsWith(text) : t === text) && b.offsetParent !== null && !b.disabled; });
    const el = els.at(-1); if (el) el.click(); return !!el;
  }, text, prefix, tag, within);
  if (!done) throw new Error(`No clickable ${tag} "${text}"${within ? ' in ' + within : ''}`);
  await sleep(300);
}
async function fill(page, label, value) {
  const done = await page.evaluate((label, value) => {
    const lab = [...document.querySelectorAll('label')].filter(l => l.offsetParent !== null).reverse().find(l => l.querySelector('span')?.innerText.trim() === label);
    const el = lab?.querySelector('input, select, textarea');
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, label, value);
  if (!done) throw new Error(`No field "${label}"`);
}
async function signIn(page, email) {
  await page.goto(URL + '/', { waitUntil: 'networkidle2' });
  await waitText(page, 'Sign in');
  await fill(page, 'Email', email); await fill(page, 'Password', PW);
  await click(page, 'Sign in');
}
async function session(browser, who, mobile) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
  wire(page, who);
  return { ctx, page };
}
async function mkUser(email, role, name) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch {}
  const u = await auth.createUser({ email, password: PW, displayName: name });
  await auth.setCustomUserClaims(u.uid, { role, mustChangePassword: false });
  await db.doc(`users/${u.uid}`).set({ name, email, role, status: 'active', mustChangePassword: false, createdTs: new Date().toISOString() });
  made.uids.push(u.uid);
  return u.uid;
}
const local = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

async function run(browser) {
  await mkUser(EM.admin, 'admin', 'Ops test admin');
  await mkUser(EM.spc, 'spc', 'Ops test SPC');
  const driverUid = await mkUser(EM.driver, 'driver', 'Ops Test Driver');
  await db.doc(`vehicles/${made.vehicleId}`).set({ reg: REG, model: 'Ford Ranger', condition: 'ok', initialOdo: 30000, lastServiceOdo: 30000, lastOdo: 30000, driverId: driverUid, activeTripId: null });
  await db.doc(`drivers/${driverUid}`).set({ name: 'Ops Test Driver', email: EM.driver, contract: 'active', vehicleId: made.vehicleId, phone: '0803 222 3333' });

  console.log('1. Tasks (admin)');
  const A = await session(browser, 'admin');
  await signIn(A.page, EM.admin); await waitText(A.page, 'Needs the office');
  await A.page.goto(URL + '/#/tasks'); await waitText(A.page, 'Assign task');
  await click(A.page, 'Assign task');
  await fill(A.page, 'Driver *', driverUid);
  await sleep(200);
  ok(await A.page.evaluate(() => [...document.querySelectorAll('label')].find(l => l.innerText.startsWith('Vehicle'))?.querySelector('select').value) === made.vehicleId, "choosing the driver fills in their vehicle");
  await fill(A.page, 'Job *', 'Deliver pump parts'); await fill(A.page, 'To *', 'Rano pumping station');
  await fill(A.page, 'When *', local(new Date(Date.now() + 3600e3))); await fill(A.page, 'Priority', 'high');
  await snap(A.page, 'task-form');
  await click(A.page, 'Assign task', { within: 'Notes for the driver' }).catch(() => click(A.page, 'Assign task'));
  await waitText(A.page, 'Deliver pump parts');
  ok(await hasText(A.page, 'Not acknowledged') && await hasText(A.page, 'high'), 'task listed as high priority, not acknowledged');
  await click(A.page, 'Edit', { within: 'Deliver pump parts' });
  await fill(A.page, 'To *', 'Rano pumping station (gate 2)');
  await click(A.page, 'Save');
  await waitText(A.page, 'gate 2');
  ok(true, 'editing the task updates the row');
  await click(A.page, 'Assign task');
  await fill(A.page, 'Driver *', driverUid); await fill(A.page, 'Job *', 'Collect survey team'); await fill(A.page, 'To *', 'Wudil');
  await fill(A.page, 'When *', local(new Date(Date.now() + 2 * 86400e3)));
  await click(A.page, 'Assign task', { within: 'Notes for the driver' }).catch(() => click(A.page, 'Assign task'));
  await waitText(A.page, 'Collect survey team');
  await click(A.page, 'Cancel', { within: 'Collect survey team' });
  await A.page.waitForFunction(() => !document.body.innerText.includes('Collect survey team'), { timeout: 20000 });
  await click(A.page, 'Cancelled (1)');
  ok(await hasText(A.page, 'Collect survey team'), 'cancelled task moves to the Cancelled tab');
  await click(A.page, 'Open', { prefix: true });
  await snap(A.page, 'tasks');

  console.log('2. Driver on the road (phone)');
  const D = await session(browser, 'driver', true);
  await signIn(D.page, EM.driver); await waitText(D.page, 'Deliver pump parts', 40000);
  ok(!(await hasText(D.page, 'Collect survey team')), 'driver does not see the cancelled task');
  await click(D.page, 'Acknowledge');
  await waitText(A.page, 'Acknowledged', 40000);
  ok(true, 'driver acknowledges -> office sees "Acknowledged" live');
  await click(D.page, 'Start trip');
  await fill(D.page, 'Odometer at start (km)', '30010');
  await click(D.page, 'Start');
  await waitText(D.page, `On a trip · ${REG}`);
  await waitText(D.page, 'All saved', 60000);
  await click(D.page, 'Log a stop');
  await waitText(D.page, 'stopped now', 30000);
  await click(D.page, 'Resume');
  await click(D.page, 'Record fuel');
  await fill(D.page, 'Litres', '40'); await fill(D.page, 'Cost (₦)', '46000'); await fill(D.page, 'Odometer (km)', '30020'); await fill(D.page, 'Station', 'NNPC Zaria Road');
  await click(D.page, 'Save');
  await waitText(D.page, 'Fuel recorded', 20000);
  await waitText(D.page, 'All saved', 60000);
  ok(true, 'driver started a trip, logged a stop and recorded fuel');
  await snap(D.page, 'driver-on-trip');

  console.log('3. Trips & fuel (admin)');
  await A.page.goto(URL + '/#/trips'); await waitText(A.page, REG);
  ok(await hasText(A.page, 'On the road (1)'), 'trip shows under "On the road"');
  await click(A.page, REG, { tag: 'td' });
  await waitText(A.page, 'Stops (1)');
  ok(await hasText(A.page, 'Checkpoint') && await hasText(A.page, '30,010 km') && await hasText(A.page, 'Deliver pump parts → Rano'), 'trip detail shows start odometer, task and the stop');
  await snap(A.page, 'trip-detail');
  await click(A.page, 'End trip for the driver');
  await fill(A.page, 'Reason *', 'Driver phone battery died');
  await fill(A.page, 'End odometer (km)', '30090');
  await click(A.page, 'End trip');
  await waitText(A.page, 'Driver phone battery died', 30000);
  ok(await hasText(A.page, '80 km') && await hasText(A.page, 'Ops test admin (office)'), 'office ends the trip: 80 km, ended by the office');
  await A.page.keyboard.press('Escape'); await A.page.goto(URL + '/#/trips'); await waitText(A.page, 'Completed (1)');
  await waitText(D.page, 'Recent trips'); await waitText(D.page, '80 km', 30000);
  ok(await hasText(D.page, 'My tasks'), "driver's phone shows the trip finished (80 km) and is back to tasks");
  const task = (await db.collection('tasks').where('driverId', '==', driverUid).where('purpose', '==', 'Deliver pump parts').get()).docs[0].data();
  const veh = (await db.doc(`vehicles/${made.vehicleId}`).get()).data();
  ok(task.status === 'completed' && veh.lastOdo === 30090 && !veh.activeTripId, 'task completed, vehicle odometer 30,090 and free');

  await A.page.goto(URL + '/#/fuel'); await waitText(A.page, 'NNPC Zaria Road');
  ok(await hasText(A.page, '₦46,000') && await hasText(A.page, '₦1,150') && await hasText(A.page, 'Ops Test Driver'), "driver's fuel listed: ₦46,000, ₦1,150/L, recorded by the driver");
  const png = path.join(__dirname, 'receipt.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await click(A.page, 'Record fuel');
  await fill(A.page, 'Vehicle *', made.vehicleId); await fill(A.page, 'Litres *', '20'); await fill(A.page, 'Cost (₦) *', '23500');
  await fill(A.page, 'Odometer (km)', '30100'); await fill(A.page, 'Station', 'Office receipt test');
  const input = await A.page.$('input[type=file]'); await input.uploadFile(png);
  await click(A.page, 'Save');
  await waitText(A.page, 'Office receipt test', 40000);
  ok(await hasText(A.page, '₦69,500') && await hasText(A.page, 'Litres this month'), 'office fuel entry saved; month total ₦69,500');
  const newTab = new Promise(r => A.ctx.once('targetcreated', t => r(t)));
  await click(A.page, 'View', { within: 'Office receipt test' });
  const target = await Promise.race([newTab, sleep(15000).then(() => null)]);
  let receiptUrl = target ? target.url() : '';
  for (let i = 0; i < 20 && target && !/firebasestorage/.test(receiptUrl); i++) { await sleep(500); receiptUrl = target.url(); }
  ok(/firebasestorage\.googleapis\.com/.test(receiptUrl), 'receipt "View" opens the uploaded file from Storage');
  await snap(A.page, 'fuel');
  await A.page.goto(URL + '/#/fuel'); await waitText(A.page, 'Service log');
  await click(A.page, 'Service log', { prefix: true });
  ok(await hasText(A.page, 'No services recorded'), 'service log tab works');

  console.log('4. SPC read-only');
  const P = await session(browser, 'spc');
  await signIn(P.page, EM.spc); await waitText(P.page, 'Trip requests');
  ok(!(await P.page.evaluate(() => [...document.querySelectorAll('nav a')].some(a => a.innerText === 'Tasks'))), 'SPC menu has no Tasks');
  await P.page.goto(URL + '/#/trips'); await waitText(P.page, REG);
  await click(P.page, REG, { tag: 'td' }); await waitText(P.page, 'Stops (1)');
  ok(!(await hasText(P.page, 'End trip for the driver')), 'SPC can open a trip but not end it');
  await P.page.goto(URL + '/#/fuel'); await waitText(P.page, 'NNPC Zaria Road');
  ok(!(await hasText(P.page, 'Record fuel')), 'SPC sees fuel but cannot add it');
  await P.ctx.close(); await D.ctx.close(); await A.ctx.close();
}

async function cleanup() {
  let n = 0;
  const del = async q => { const s = await q.get(); for (const d of s.docs) { await d.ref.delete(); n++; } };
  const fuel = await db.collection('fuel').where('vehicleId', '==', made.vehicleId).get();
  for (const d of fuel.docs) { const r = d.get('receipt'); if (r) await aSt.getStorage().bucket().file(r).delete().catch(() => {}); }
  await del(db.collection('fuel').where('vehicleId', '==', made.vehicleId));
  await del(db.collection('trips').where('vehicleId', '==', made.vehicleId));
  await del(db.collection('maintenance').where('vehicleId', '==', made.vehicleId));
  for (const uid of made.uids) {
    await del(db.collection('tasks').where('driverId', '==', uid));
    await del(db.collection('driverActions').where('driverId', '==', uid));
    await del(db.collection('logs').where('userId', '==', uid));
    await db.doc(`users/${uid}`).delete(); await db.doc(`drivers/${uid}`).delete();
    try { await auth.deleteUser(uid); } catch {}
  }
  await db.doc(`vehicles/${made.vehicleId}`).delete();
  const left = ['vehicles', 'drivers', 'tasks', 'trips', 'fuel', 'driverActions'];
  const counts = await Promise.all(left.map(c => db.collection(c).get().then(s => s.size)));
  console.log(`Cleanup: removed ${n} docs + ${made.uids.length} accounts; leftover ${left.map((c, i) => `${c}=${counts[i]}`).join(' ')}; staff=${(await db.collection('staff').get()).size}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--disable-extensions'] });
  try { await run(browser); }
  catch (e) { failN++; console.log('  ERROR', e.message.split('\n')[0]); try { for (const p of await browser.pages()) await snap(p, 'error'); for (const c of browser.browserContexts()) for (const p of await c.pages()) await snap(p, 'error'); } catch {} }
  finally { await browser.close().catch(() => {}); await cleanup().catch(e => console.log('cleanup error', e.message)); }
  console.log(errors.length ? `\nBrowser errors (${errors.length}):\n  ` + [...new Set(errors)].slice(0, 15).join('\n  ') : '\nNo browser errors.');
  console.log(`\n${pass} passed, ${failN} failed. Screenshots: ${SHOTS}`);
  process.exit(failN ? 1 : 0);
})();
