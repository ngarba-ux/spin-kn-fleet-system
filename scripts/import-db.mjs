// One-off import of the original SPIN-KN Fleet data into Firebase.
//
//   node scripts/import-db.mjs --key path/to/service-account.json [--db data/db.json] [--dry-run]
//
// With --db, everything in db.json is copied (staff QR tokens are kept, so
// printed cards keep working; uploaded files are copied to Storage). Without
// it, only the staff directory and the admin / SPC accounts are created.
//
// Every account gets a new temporary password (Firebase cannot use the old
// hashes). They are written to data/firebase-temp-passwords.csv - hand them
// out, then delete that file. Each person must choose a new password at
// first sign-in.
import { createRequire } from 'node:module';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'functions', 'package.json'));
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dryRun = args.includes('--dry-run');
const keyPath = arg('--key') ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
const dbPath = arg('--db');
if (!keyPath) {
  console.error('Missing --key <service-account.json>. Download one from Firebase console > Project settings > Service accounts.');
  process.exit(1);
}

const PROJECT = 'spin-kn-fleet';
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth();
const bucket = getStorage().bucket();

const now = () => new Date().toISOString();
const clean = o => JSON.parse(JSON.stringify(o));   // drop undefined
const tempPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(12), b => chars[b % chars.length]).join('');
};
const newStaffToken = () => 'spk_' + randomBytes(15).toString('base64url').replace(/[-_]/g, 'x');

const writes = [];   // [path, data]
const put = (path, data) => writes.push([path, clean(data)]);
const passwords = [['name', 'email', 'role', 'temporary password']];

// ------------------------------------------------------------------ accounts

async function ensureUser(u) {
  const email = u.email.toLowerCase();
  const password = tempPassword();
  let uid;
  if (dryRun) uid = 'dry-' + u.id;
  else {
    try {
      uid = (await auth.getUserByEmail(email)).uid;
      await auth.updateUser(uid, { password, displayName: u.name, disabled: u.status !== 'active' });
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      uid = (await auth.createUser({ email, password, displayName: u.name, disabled: u.status !== 'active' })).uid;
    }
    await auth.setCustomUserClaims(uid, { role: u.role, mustChangePassword: true });
  }
  put(`users/${uid}`, { name: u.name, email, role: u.role, status: u.status ?? 'active', mustChangePassword: true, createdTs: u.createdTs ?? now(), lastLoginTs: u.lastLoginTs ?? null, demo: !!u.demo });
  passwords.push([u.name, email, u.role, password]);
  return uid;
}

// ------------------------------------------------------------------ files

const uploadDir = dbPath ? join(dirname(resolve(dbPath)), 'uploads') : null;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
let uploads = new Map();

async function copyUpload(id, folder) {
  if (!id) return null;
  const up = uploads.get(id);
  if (!up) return null;
  const local = join(uploadDir, id + EXT[up.mime]);
  if (!existsSync(local)) { console.warn(`  missing file ${local}`); return null; }
  const path = `${folder}/${id}${EXT[up.mime]}`;
  if (!dryRun) await bucket.file(path).save(readFileSync(local), { contentType: up.mime, resumable: false, metadata: { metadata: { originalName: up.name } } });
  return path;
}

// ------------------------------------------------------------------ import

async function importDb(src) {
  const d = JSON.parse(readFileSync(src, 'utf8').replace(/^﻿/, ''));
  uploads = new Map((d.uploads ?? []).map(u => [u.id, u]));
  const max = (...xs) => { const v = xs.filter(x => typeof x === 'number'); return v.length ? Math.max(...v) : null; };

  console.log(`Users (${d.users.length})`);
  const uidOf = new Map();
  for (const u of d.users) uidOf.set(u.id, await ensureUser(u));

  // drivers/{uid}: driver ids become the driver's Auth uid.
  const driverUid = new Map();
  for (const dr of d.drivers ?? []) {
    const uid = uidOf.get(dr.userId);
    if (!uid) { console.warn(`  driver ${dr.name} has no account - skipped`); continue; }
    driverUid.set(dr.id, uid);
    put(`drivers/${uid}`, { name: dr.name, email: d.users.find(u => u.id === dr.userId)?.email ?? '', driverNo: dr.driverNo, phone: dr.phone, licenceNo: dr.licenceNo, licenceExpiry: dr.licenceExpiry, contract: dr.contract ?? 'active', vehicleId: dr.vehicleId ?? null, demo: !!dr.demo });
  }
  const du = id => (id ? driverUid.get(id) ?? null : null);

  console.log(`Staff (${d.staff.length})`);
  for (const s of d.staff) {
    put(`staff/${s.id}`, { staffNo: s.staffNo, employeeNo: s.employeeNo, fullName: s.fullName, unitCode: s.unitCode, unit: s.unit, designation: s.designation, email: s.email, phone: s.phone, qrStatus: s.qrStatus ?? 'active', status: s.status ?? 'active', demo: !!s.demo });
    put(`staffSecrets/${s.id}`, { qrToken: s.qrToken || newStaffToken() });
  }

  console.log(`Vehicles (${d.vehicles.length})`);
  for (const v of d.vehicles) {
    const lastOdo = max(v.initialOdo, v.lastServiceOdo,
      ...d.fuel.filter(f => f.vehicleId === v.id).map(f => f.odometer),
      ...d.trips.filter(t => t.vehicleId === v.id).flatMap(t => [t.startOdo, t.endOdo]),
      ...(d.maintenance ?? []).filter(m => m.vehicleId === v.id).map(m => m.odometer));
    const holder = (d.drivers ?? []).find(x => x.vehicleId === v.id);
    const active = d.trips.find(t => t.vehicleId === v.id && t.status === 'inTransit');
    put(`vehicles/${v.id}`, { assetId: v.assetId, reg: v.reg, model: v.model, colour: v.colour, engineNo: v.engineNo, chassisNo: v.chassisNo, condition: v.condition ?? 'ok', initialOdo: v.initialOdo, lastServiceOdo: v.lastServiceOdo, lastServiceDate: v.lastServiceDate, serviceIntervalKm: v.serviceIntervalKm, insuranceExpiry: v.insuranceExpiry, roadworthinessExpiry: v.roadworthinessExpiry, notes: v.notes, lastOdo, driverId: holder ? du(holder.id) : null, activeTripId: active?.id ?? null, demo: !!v.demo });
  }

  const staffById = new Map(d.staff.map(s => [s.id, s]));
  const reqById = new Map(d.requests.map(r => [r.id, r]));

  console.log(`Tasks (${d.tasks.length}), trips (${d.trips.length}), fuel (${d.fuel.length}), maintenance (${(d.maintenance ?? []).length})`);
  for (const t of d.tasks) {
    const r = t.requestId ? reqById.get(t.requestId) : null;
    const sf = r ? staffById.get(r.staffId) : null;
    put(`tasks/${t.id}`, { driverId: du(t.driverId), vehicleId: t.vehicleId, purpose: t.purpose, origin: t.origin, destination: t.destination, scheduledTs: t.scheduledTs, notes: t.notes, priority: t.priority ?? 'medium', status: t.status, acknowledged: !!t.acknowledged, acknowledgedTs: t.acknowledgedTs, tripId: t.tripId, requestId: t.requestId, requester: r ? { name: sf?.fullName ?? '', phone: sf?.phone ?? '', passengers: r.passengers, returnTs: r.returnTs, ref: r.ref } : null, createdTs: t.createdTs ?? now(), createdBy: t.createdBy ?? 'System', demo: !!t.demo });
  }
  for (const t of d.trips) {
    const uid = du(t.driverId);
    put(`trips/${t.id}`, { driverId: uid, vehicleId: t.vehicleId, taskId: t.taskId, requestId: t.requestId, status: t.status, paused: !!t.paused, startTs: t.startTs, startLat: t.startLat, startLng: t.startLng, startOdo: t.startOdo, startPhoto: await copyUpload(t.startPhotoId, `uploads/drivers/${uid}`), endTs: t.endTs, endLat: t.endLat, endLng: t.endLng, endOdo: t.endOdo, endPhoto: await copyUpload(t.endPhotoId, `uploads/drivers/${uid}`), endedBy: t.endedBy, notes: t.notes, stops: t.stops ?? [], demo: !!t.demo });
  }
  for (const f of d.fuel) {
    const uid = du(f.driverId);
    put(`fuel/${f.id}`, { driverId: uid, vehicleId: f.vehicleId, ts: f.ts, litres: f.litres, cost: f.cost, odometer: f.odometer, station: f.station, receipt: await copyUpload(f.receiptId, uid ? `uploads/drivers/${uid}` : 'uploads/office'), enteredBy: f.enteredBy ?? 'driver', demo: !!f.demo });
  }
  for (const m of d.maintenance ?? []) put(`maintenance/${m.id}`, { vehicleId: m.vehicleId, ts: m.ts, odometer: m.odometer, cost: m.cost, notes: m.notes, by: m.by ?? 'System', demo: !!m.demo });

  console.log(`Requests (${d.requests.length})`);
  for (const r of d.requests) {
    const sf = staffById.get(r.staffId) ?? {};
    const task = r.taskId ? d.tasks.find(t => t.id === r.taskId) : null;
    put(`requests/${r.id}`, {
      ref: r.ref, statusToken: r.statusToken, staffId: r.staffId,
      staff: { fullName: sf.fullName ?? '', designation: sf.designation ?? '', unit: sf.unit ?? '', email: sf.email ?? '', phone: sf.phone ?? '' },
      purpose: r.purpose, component: r.component, destination: r.destination, departTs: r.departTs, returnTs: r.returnTs, passengers: r.passengers,
      passengerList: r.passengerList ?? [], vehicle: r.vehicle, priority: r.priority ?? 'normal', urgentReason: r.urgentReason ?? '',
      assignment: r.assignment ?? '', remarks: r.remarks ?? '', doc: await copyUpload(r.docId, `uploads/staff/${r.staffId}`),
      status: r.status, createdTs: r.createdTs, updatedTs: r.updatedTs ?? r.createdTs, history: r.history ?? [],
      adminRemark: r.adminRemark ?? '', proposedDriverId: du(r.proposedDriverId), proposedVehicleId: r.proposedVehicleId ?? null,
      dispatchDriverId: du(r.dispatchDriverId), dispatchVehicleId: r.dispatchVehicleId ?? null, taskId: r.taskId ?? null,
      forwardedByName: r.forwardedByName ?? null, dispatchedByName: r.dispatchedByName ?? null, spcDecision: r.spcDecision ?? null,
      rescheduledFromDepart: r.rescheduledFromDepart ?? null, rescheduledFromReturn: r.rescheduledFromReturn ?? null,
      tripStarted: task ? task.status === 'inProgress' || task.status === 'completed' : false, demo: !!r.demo,
    });
  }

  const s = d.settings ?? {};
  put('settings/app', { orgName: s.orgName, publicBaseUrl: '', serviceIntervalKm: s.serviceIntervalKm, expiryWarnDays: s.expiryWarnDays, defaultOrigin: s.defaultOrigin, components: s.components, vehicleTypes: s.vehicleTypes });
  put('counters/requests', { seq: d.requestSeq ?? d.requests.length });
  for (const l of (d.logs ?? []).slice(0, 1000)) put(`logs/${l.id}`, { ts: l.ts, userId: uidOf.get(l.userId) ?? l.userId, userName: l.userName, action: l.action, detail: l.detail });
}

// Fresh start: the real staff directory plus the two office accounts.
async function seedOnly() {
  const staff = [
    ['STF-0001', 'SPINKN-PIUHR-I', 'Isah Nuraddeen Abubakar', 'PMC', 'Project Management & Coordination', 'State Project Coordinator', 'ainuraddeen@spinkano.com.ng', '0803 201 1001'],
    ['STF-0002', 'SPINKN-PIUHR-X', 'Yasir Jibril Ibrahim', 'PMC', 'Project Management & Coordination', 'Logistics & Transportation Officer', 'yasjibril@spinkano.com.ng', '0803 202 1002'],
    ['STF-0003', 'SPINKN-PIUHR-XII', 'Basheer Auwal', 'PMC', 'Project Management & Coordination', 'Water Users Officer & Scheme Manager', 'basheerauwal@spinkano.com.ng', '0803 203 1003'],
    ['STF-0004', 'SPINKN-PIUHR-XVII', 'Zainab Adnan Danbatta', 'PMC', 'Project Management & Coordination', 'Project Management Support', 'adzainab@spinkano.com.ng', '0803 204 1004'],
    ['STF-0005', 'SPINKN-PIUHR-XIX', 'Jamila Aliyu Baba', 'PMC', 'Project Management & Coordination', 'Planning, Research & Asset Mgmt.', 'abjamila@spinkano.com.ng', '0803 205 1005'],
    ['STF-0006', 'SPINKN-PIUHR-XVIII', 'Aslam Mukhtar Ismail', 'PMC', 'Project Management & Coordination', 'Head, Special Projects Department', 'imukhtar@spinkano.com.ng', '0803 206 1006'],
    ['STF-0007', 'SPINKN-PIUHR-XIV', 'Abubakar Ramadan', 'ETS', 'Engineering & Technical Service', 'Monitoring & Evaluation Specialist', 'aramadan@spinkano.com.ng', '0803 207 1007'],
    ['STF-0008', 'SPINKN-PIUHR-XI', 'Mustapha Muhammad Bello', 'ETS', 'Engineering & Technical Service', 'Irrigation Engineer', 'mmbello@spinkano.com.ng', '0803 208 1008'],
    ['STF-0009', 'SPINKN-PIUHR-V', 'Mukhtar Kiru Usman', 'ETS', 'Engineering & Technical Service', 'Project Engineer', 'mukhtarkiru@spinkano.com.ng', '0803 209 1009'],
    ['STF-0010', 'SPINKN-PIUHR-II', 'Yasmin Asiya Mukhtar', 'ESG', 'Environmental Safeguard', 'Environmental Specialist', 'aymukhtar@spinkano.com.ng', '0803 210 1010'],
    ['STF-0011', 'SPINKN-PIUHR-XV', 'Bashir Kabir Rabiu', 'ESG', 'Environmental Safeguard', 'Social Specialist', 'magikkalaz@gmail.com', '0803 211 1011'],
    ['STF-0012', 'SPINKN-PIUHR-XIII', 'Nafisat Ismail Mukhtar', 'ESG', 'Environmental Safeguard', 'Gender Specialist', 'nafmukh@spinkano.com.ng', '0803 212 1012'],
    ['STF-0013', 'SPINKN-PIUHR-VI', 'Nura Garba', 'POD', 'Project Operations & Development', 'ICT, Data & Asset Management Specialist', 'nuragarba@spinkano.com.ng', '0803 213 1013'],
    ['STF-0014', 'SPINKN-PIUHR-VII', 'Maryam Abdul Mustapha', 'POD', 'Project Operations & Development', 'Information & Communication Specialist', 'maryammustapha@spinkano.com.ng', '0803 214 1014'],
    ['STF-0015', 'SPINKN-PIUHR-VIII', 'Bilkisu Ibrahim Muazzam', 'POD', 'Project Operations & Development', 'Community Relations & Mobilization Specialist', 'mbilkisu@spinkano.com.ng', '0803 215 1015'],
    ['STF-0016', 'SPINKN-PIUHR-III', 'Zaharaddeen Lawan', 'PAF', 'Planning, Admin & Finance', 'Project Accountant', 'zlawan@spinkano.com.ng', '0803 216 1016'],
    ['STF-0017', 'SPINKN-PIUHR-IX', 'Muhammad Umar Ibrahim', 'PAF', 'Planning, Admin & Finance', 'Human Resources & Administration Officer', 'miumar@spinkano.com.ng', '0803 217 1017'],
    ['STF-0018', 'SPINKN-PIUHR-IV', 'Kakisu Ibrahim Ahmad', 'PAF', 'Planning, Admin & Finance', 'Procurement Specialist', 'ikakisu@spinkano.com.ng', '0803 218 1018'],
    ['STF-0019', 'SPINKN-PIUHR-XVI', 'Aisha Adnan Maje', 'PAF', 'Planning, Admin & Finance', 'Project Internal Auditor', 'adnanaisha@spinkano.com.ng', '0803 219 1019'],
  ];
  staff.forEach(([staffNo, employeeNo, fullName, unitCode, unit, designation, email, phone], i) => {
    put(`staff/stf-${i + 1}`, { staffNo, employeeNo, fullName, unitCode, unit, designation, email, phone, qrStatus: 'active', status: 'active' });
    put(`staffSecrets/stf-${i + 1}`, { qrToken: newStaffToken() });
  });
  await ensureUser({ id: 'admin', name: 'Yasir Jibril Ibrahim', email: 'yasjibril@spinkano.com.ng', role: 'admin', status: 'active' });
  await ensureUser({ id: 'spc', name: 'Isah Nuraddeen Abubakar', email: 'ainuraddeen@spinkano.com.ng', role: 'spc', status: 'active' });
  put('settings/app', {});
  put('counters/requests', { seq: 0 });
}

// ------------------------------------------------------------------ run

if (dbPath) await importDb(dbPath); else await seedOnly();

console.log(`\n${writes.length} documents${dryRun ? ' (dry run, nothing written)' : ''}`);
if (!dryRun) {
  const bw = db.bulkWriter();
  for (const [path, data] of writes) bw.set(db.doc(path), data, { merge: true });
  await bw.close();
}

const out = join(root, 'data', 'firebase-temp-passwords.csv');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, passwords.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'));
console.log(`Temporary passwords: ${out}  (hand them out, then delete this file)`);
