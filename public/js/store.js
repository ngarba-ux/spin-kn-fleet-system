// App state, server calls and the driver's offline queue.
import { useState, useEffect } from './lib.js';
import { t } from './i18n.js';

const subs = new Set();

export const store = {
  data: null,          // role-filtered state from /api/state (null = signed out)
  booted: false,
  toasts: [],
  dialog: null,        // active confirm/prompt dialog
  online: navigator.onLine,
  queue: [],           // driver actions waiting to upload
  syncing: false,
  syncErrors: [],
  lastSync: null,
};

export function update(patch) {
  Object.assign(store, patch);
  subs.forEach(f => f());
}

// Re-render the calling component whenever the store changes.
export function useStore() {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return store;
}

export function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
}

// ---------------------------------------------------------------- server calls

export async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'spin-fleet' }, body: JSON.stringify(body) });
  } catch {
    const err = new Error(t('networkError'));
    err.network = true;
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed (' + res.status + ')');
    err.code = data.code; err.status = res.status; err.details = data.details;
    if (res.status === 401 && store.data && path !== '/api/login') {
      update({ data: null });
      toast(t('sessionExpired'), 'warn');
    }
    throw err;
  }
  return data;
}

function setData(d) {
  update({ data: d, lastSync: new Date(), online: true });
}

export async function loadState() {
  try {
    setData(await api('/api/state'));
  } catch (e) {
    if (e.status === 401) update({ data: null });
    else if (e.network) update({ online: false });
    else throw e;
  }
}

export async function login(email, password) {
  setData(await api('/api/login', { email, password }));
  loadQueue();
  flush();
}

export async function logout() {
  try { await api('/api/logout', {}); } catch {}
  update({ data: null, queue: [], syncErrors: [] });
  location.hash = '';
}

// Run a server action. Errors are toasted (except scheduling conflicts, which
// the caller shows inline). Resolves to {ok, result, error}.
export async function act(type, data, okMsg) {
  try {
    const st = await api('/api/action', { type, data });
    const { result, ...rest } = st;
    setData(rest);
    if (okMsg) toast(okMsg);
    return { ok: true, result };
  } catch (e) {
    if (e.code !== 'conflict') toast(e.message, 'error');
    return { ok: false, error: e };
  }
}

export const publicApi = (type, data) => api('/api/public', { type, data });

// ---------------------------------------------------------------- toasts & dialogs

export function toast(msg, type = 'success', sub) {
  const id = uid();
  update({ toasts: [...store.toasts, { id, msg, type, sub }] });
  setTimeout(() => update({ toasts: store.toasts.filter(x => x.id !== id) }), type === 'error' ? 7000 : 4000);
}

// Promise-based confirm/prompt. Resolves false when dismissed, true when
// confirmed, or the entered text when `input` is given.
export function ask(opts) {
  return new Promise(resolve => update({ dialog: { ...opts, resolve } }));
}

// ---------------------------------------------------------------- driver offline queue

const qkey = () => 'spk-queue-' + (store.data && store.data.me ? store.data.me.id : 'anon');

export function loadQueue() {
  let q = [];
  try { q = JSON.parse(localStorage.getItem(qkey()) || '[]'); } catch {}
  update({ queue: Array.isArray(q) ? q : [] });
}

function saveQueue(q) {
  try { localStorage.setItem(qkey(), JSON.stringify(q)); return true; } catch { return false; }
}

// Every driver action goes through here, online or not, so there is one code
// path. The item is persisted before upload; the server de-duplicates by clientId.
export function enqueue(type, payload) {
  const item = { clientId: uid(), type, ts: new Date().toISOString(), payload };
  let q = [...store.queue, item];
  if (!saveQueue(q) && (payload.photo || payload.receipt)) {
    item.payload = { ...payload, photo: undefined, receipt: undefined };
    q = [...store.queue, item];
    saveQueue(q);
    toast('The photo could not be stored on this device and was skipped.', 'warn');
  }
  update({ queue: q });
  flush();
  return item;
}

export async function flush() {
  if (store.syncing || !store.queue.length || !store.data) return;
  update({ syncing: true });
  const batch = store.queue.slice(0, 20);
  let again = false;
  try {
    const st = await api('/api/action', { type: 'driver.sync', data: { actions: batch } });
    const { result, ...rest } = st;
    const results = (result && result.results) || [];
    const done = new Set(results.map(r => r.clientId));
    const errors = results.filter(r => !r.ok).map(r => ({ ...r, item: batch.find(b => b.clientId === r.clientId) }));
    const q = store.queue.filter(x => !done.has(x.clientId));
    saveQueue(q);
    update({ queue: q, syncErrors: [...store.syncErrors, ...errors] });
    setData(rest);
    const ok = results.length - errors.length;
    if (ok > 0 && batch.some(b => Date.now() - Date.parse(b.ts) > 60000)) toast(t('syncedTitle'), 'success', t('syncedBody', { n: ok }));
    again = q.length > 0 && done.size > 0;
  } catch (e) {
    if (e.network) update({ online: false });
    else if (e.status !== 401) toast(e.message, 'error');
  } finally {
    update({ syncing: false });
  }
  if (again) flush();
}

// Driver data with not-yet-uploaded actions applied, so the UI reflects what
// the driver did even while offline.
export function withPending(data, queue) {
  if (!data || !queue.length) return data;
  const d = {
    ...data,
    trips: (data.trips || []).map(x => ({ ...x, stops: [...(x.stops || [])] })),
    tasks: (data.tasks || []).map(x => ({ ...x })),
    fuel: [...(data.fuel || [])],
  };
  for (const a of queue) {
    const p = a.payload || {};
    const trip = p.tripId ? d.trips.find(x => x.id === p.tripId) : null;
    if (a.type === 'trip.start') {
      const task = p.taskId ? d.tasks.find(x => x.id === p.taskId) : null;
      const vehicleId = (task && task.vehicleId) || p.vehicleId || (d.driver && d.driver.vehicleId);
      d.trips.unshift({ id: 't-' + a.clientId, driverId: d.driver && d.driver.id, vehicleId, taskId: p.taskId || null, status: 'inTransit', paused: false, startTs: a.ts, startLat: p.lat, startLng: p.lng, startOdo: p.odo, stops: [], pending: true });
      if (task) { task.status = 'inProgress'; task.acknowledged = true; task.tripId = 't-' + a.clientId; }
    } else if (a.type === 'trip.stop' && trip) {
      trip.paused = true; trip.pending = true;
      trip.stops.push({ id: 's-' + a.clientId, startTs: a.ts, note: p.note, lat: p.lat, lng: p.lng });
    } else if (a.type === 'trip.resume' && trip) {
      trip.paused = false; trip.pending = true;
      trip.stops = trip.stops.map(s => s.endTs ? s : { ...s, endTs: a.ts });
    } else if (a.type === 'trip.end' && trip) {
      trip.status = 'completed'; trip.paused = false; trip.pending = true;
      trip.endTs = a.ts; trip.endOdo = p.odo; trip.endLat = p.lat; trip.endLng = p.lng;
      trip.stops = trip.stops.map(s => s.endTs ? s : { ...s, endTs: a.ts });
      const task = d.tasks.find(x => x.tripId === trip.id);
      if (task) task.status = 'completed';
    } else if (a.type === 'fuel.add') {
      d.fuel.unshift({ id: 'f-' + a.clientId, vehicleId: p.vehicleId || (d.driver && d.driver.vehicleId), ts: a.ts, litres: +p.litres, cost: +p.cost, odometer: p.odometer ? +p.odometer : null, station: p.station, pending: true });
    } else if (a.type === 'task.ack') {
      const task = d.tasks.find(x => x.id === p.taskId);
      if (task) task.acknowledged = true;
    }
  }
  return d;
}
