// Live Firestore data hooks and the driver's offline action queue.
import { useEffect, useState } from 'react';
import { collection, doc, DocumentData, onSnapshot, Query, query, setDoc, where } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';

export type WithId<T> = T & { id: string };

// Subscribes to a query; `key` must change whenever the query changes.
export function useCollection<T = DocumentData>(q: Query | null, key: string) {
  const [state, setState] = useState<{ data: WithId<T>[]; loading: boolean; error: string | null; fromCache: boolean }>({ data: [], loading: true, error: null, fromCache: false });
  useEffect(() => {
    if (!q) { setState({ data: [], loading: false, error: null, fromCache: false }); return; }
    return onSnapshot(q, { includeMetadataChanges: true },
      snap => setState({ data: snap.docs.map(d => ({ id: d.id, ...(d.data() as T) })), loading: false, error: null, fromCache: snap.metadata.fromCache }),
      err => setState(s => ({ ...s, loading: false, error: err.message })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useDocument<T = DocumentData>(path: string | null) {
  const [data, setData] = useState<WithId<T> | null>(null);
  useEffect(() => {
    if (!path) { setData(null); return; }
    return onSnapshot(doc(db, path), snap => setData(snap.exists() ? { id: snap.id, ...(snap.data() as T) } : null));
  }, [path]);
  return data;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

// ---------------------------------------------------------------- driver queue

export type DriverActionType = 'trip.start' | 'trip.stop' | 'trip.resume' | 'trip.end' | 'fuel.add' | 'task.ack';

export interface DriverAction {
  driverId: string;
  type: DriverActionType;
  ts: string;
  seq: number;
  payload: Record<string, unknown>;
  state: 'pending' | 'applied' | 'rejected';
  error?: string | null;
}

function randomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
}

// Strictly increasing on this device, even if the clock is changed.
function nextSeq(): number {
  let last = 0;
  try { last = Number(localStorage.getItem('spk-seq') || 0); } catch { /* storage blocked */ }
  const seq = Math.max(Date.now(), last + 1);
  try { localStorage.setItem('spk-seq', String(seq)); } catch { /* storage blocked */ }
  return seq;
}

// Every driver action goes through here, online or not. The write lands in the
// local cache immediately and is uploaded by the SDK when there is signal; the
// server applies actions in `seq` order. Returns the action id, which is also
// the id of a trip it starts ("t-<id>").
export function queueDriverAction(type: DriverActionType, payload: Record<string, unknown>): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again.');
  const id = randomId();
  const clean = JSON.parse(JSON.stringify(payload));
  setDoc(doc(db, 'driverActions', id), { driverId: uid, type, ts: new Date().toISOString(), seq: nextSeq(), payload: clean, state: 'pending', createdAt: new Date().toISOString() })
    .catch(e => console.error('Could not queue action', e));
  return id;
}

export function useMyActions(uid: string | null) {
  return useCollection<DriverAction>(uid ? query(collection(db, 'driverActions'), where('driverId', '==', uid)) : null, 'actions-' + uid);
}

// Uploads a photo to the driver's own folder and returns its Storage path.
// Needs a connection; callers fall back to recording without the photo.
export async function uploadDriverPhoto(file: Blob): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again.');
  const path = `uploads/drivers/${uid}/${randomId()}.jpg`;
  await uploadBytes(storageRef(storage, path), file, { contentType: 'image/jpeg' });
  return path;
}

// Shrinks a camera photo so it uploads quickly on mobile data.
export async function shrinkImage(file: File, maxDim = 1400, quality = 0.7): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not read the photo.'))), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Reads a file as {name, data:"data:...;base64,..."} for the staff portal.
export function readAsDataUrl(file: File): Promise<{ name: string; data: string }> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: file.name, data: String(r.result) });
    r.onerror = () => rej(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

export function getPosition(timeout = 12000): Promise<{ lat?: number; lng?: number }> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}
