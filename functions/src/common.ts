// Shared setup and helpers for every function.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Transaction, WriteBatch } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, CallableRequest, FunctionsErrorCode } from 'firebase-functions/v2/https';
import { randomBytes } from 'node:crypto';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
export const auth = getAuth();
export const bucket = () => getStorage().bucket();

export const TIME_ZONE = 'Africa/Lagos';
export const DEFAULT_BASE_URL = 'https://spin-kn-fleet.web.app';

// 'super' holds both office roles (admin + SPC) in one account.
export type Role = 'admin' | 'spc' | 'driver' | 'super';

export interface Actor {
  uid: string;
  role: Role;
  name: string;
}

export function fail(code: FunctionsErrorCode, message: string, details?: unknown): never {
  throw new HttpsError(code, message, details);
}

// Signed-in caller with one of the given roles who has already set their own password.
export function actor(req: CallableRequest, ...roles: Role[]): Actor {
  const a = req.auth;
  if (!a) fail('unauthenticated', 'Please sign in again.');
  const role = a.token.role as Role | undefined;
  const allowed = !!role && (roles.includes(role) || (role === 'super' && (roles.includes('admin') || roles.includes('spc'))));
  if (!allowed) fail('permission-denied', 'Your account is not allowed to do that.');
  if (a.token.mustChangePassword) fail('failed-precondition', 'Please set a new password first.');
  return { uid: a.uid, role, name: (a.token.name as string) || (a.token.email as string) || 'User' };
}

// ------------------------------------------------------------------ input

// Read-only accessor over the JSON object sent by the browser.
export class Input {
  private d: Record<string, unknown>;
  constructor(data: unknown) {
    this.d = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  }

  raw(k: string): unknown { return this.d[k]; }
  has(k: string): boolean { return this.d[k] !== undefined && this.d[k] !== null; }

  str(k: string, max = 2000): string | null {
    const v = this.d[k];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s.length > max) fail('invalid-argument', `A field is too long (${k}).`);
    return s;
  }

  req(k: string, label: string, max = 2000): string {
    const s = this.str(k, max);
    if (s === null) fail('invalid-argument', `${label} is required.`, { field: k });
    return s;
  }

  num(k: string): number | null {
    const v = this.d[k];
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
    if (!Number.isFinite(n)) fail('invalid-argument', `'${k}' must be a number.`, { field: k });
    return n;
  }

  bool(k: string): boolean {
    const v = this.d[k];
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  obj(k: string): Input | null {
    const v = this.d[k];
    return v && typeof v === 'object' && !Array.isArray(v) ? new Input(v) : null;
  }

  list(k: string): Input[] {
    const v = this.d[k];
    return Array.isArray(v) ? v.filter(x => x && typeof x === 'object').map(x => new Input(x)) : [];
  }

  strList(k: string, max = 120): string[] | null {
    const v = this.d[k];
    if (!Array.isArray(v)) return null;
    const out = [...new Set(v.map(x => String(x ?? '').trim()).filter(s => s && s.length <= max))];
    return out.length ? out : null;
  }

  oneOf<T extends string>(k: string, label: string, allowed: readonly T[], fallback?: T): T {
    const v = this.str(k) ?? fallback;
    if (v === undefined || !allowed.includes(v as T)) fail('invalid-argument', `${label} has an invalid value.`);
    return v as T;
  }
}

// ------------------------------------------------------------------ time

export const nowIso = () => new Date().toISOString();

export function parseTs(s: unknown): Date | null {
  if (typeof s !== 'string' || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function reqTs(s: string | null, label: string): Date {
  const d = parseTs(s);
  if (!d) fail('invalid-argument', `${label} is not a valid date/time.`);
  return d;
}

// yyyy-MM-dd only (licence / insurance expiry dates).
export function dateOnly(s: string | null, label: string): string | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail('invalid-argument', `${label} must be a date (YYYY-MM-DD).`);
  return s;
}

export function fmtLocal(iso: string | null | undefined): string {
  const d = parseTs(iso);
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export function localYear(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric' }).format(new Date()));
}

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart <= bEnd && bStart <= aEnd;

// ------------------------------------------------------------------ misc

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

// Letters and digits that can't be confused when typed from paper.
export function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(12), b => chars[b % chars.length]).join('');
}

export function newStaffToken(): string {
  return 'spk_' + randomToken(15).replace(/[-_]/g, 'x');
}

export function looksLikeEmail(s: string | null | undefined): s is string {
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@.][^\s@]*$/.test(s);
}

type Writer = Transaction | WriteBatch;

export function log(w: Writer, a: Pick<Actor, 'uid' | 'name'> | null, action: string, detail = '') {
  // Transaction.set and WriteBatch.set take the same arguments.
  (w as WriteBatch).set(db.collection('logs').doc(), {
    ts: nowIso(), userId: a ? a.uid : 'system', userName: a ? a.name : 'System', action, detail,
  });
}

// ------------------------------------------------------------------ settings

export interface Settings {
  orgName: string;
  publicBaseUrl: string;
  serviceIntervalKm: number;
  expiryWarnDays: number;
  defaultOrigin: string;
  components: string[];
  vehicleTypes: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  orgName: 'SPIN Kano - Logistics & Transport Office',
  publicBaseUrl: '',
  serviceIntervalKm: 5000,
  expiryWarnDays: 30,
  defaultOrigin: 'SPIN Project Office, Kano',
  components: ['Dam & Power Infrastructure', 'Irrigation & Drainage', 'Agricultural Services & Livelihoods', 'Institutional Strengthening & Project Management'],
  vehicleTypes: ['Toyota Hilux', 'Long Nose Bus (14 Seater)', 'Any available vehicle'],
};

export async function getSettings(): Promise<Settings> {
  const snap = await db.doc('settings/app').get();
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<Settings> | undefined) };
}

export function baseUrl(s: Settings): string {
  return (s.publicBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// ------------------------------------------------------------------ files

const ALLOWED: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

function magicMatches(mime: string, b: Buffer): boolean {
  if (b.length < 12) return false;
  switch (mime) {
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8;
    case 'image/png': return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/webp': return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    case 'application/pdf': return b.toString('ascii', 0, 4) === '%PDF';
  }
  return false;
}

// Saves {name, data:"data:<mime>;base64,..."} to Storage under `folder` and
// returns the object path, or null when no file was sent.
export async function saveInline(file: Input | null, folder: string): Promise<string | null> {
  if (!file) return null;
  const data = file.str('data', 7_500_000);
  if (!data) return null;
  const m = /^data:([a-z/+.-]+);base64,(.+)$/s.exec(data);
  if (!m) fail('invalid-argument', 'The attached file could not be read.');
  const mime = m[1].toLowerCase();
  if (!ALLOWED[mime]) fail('invalid-argument', 'Only JPG, PNG, WEBP images or PDF documents can be attached.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 5 * 1024 * 1024) fail('invalid-argument', 'Attachments must be 5 MB or smaller.');
  if (!magicMatches(mime, bytes)) fail('invalid-argument', 'The attached file does not match its type.');
  const name = (file.str('name', 300) ?? `file.${ALLOWED[mime]}`).replace(/[^\w.\- ()]/g, '_');
  const path = `${folder}/${randomToken(12)}.${ALLOWED[mime]}`;
  await bucket().file(path).save(bytes, { contentType: mime, metadata: { metadata: { originalName: name } }, resumable: false });
  return path;
}
