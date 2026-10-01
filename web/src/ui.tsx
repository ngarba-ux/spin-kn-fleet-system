// Small shared UI pieces and formatters.
import { ButtonHTMLAttributes, ReactNode, useState } from 'react';

const TZ = 'Africa/Lagos';

export const fmtDT = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '-';

export const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '-';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'primary', busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-emerald-800 text-white hover:bg-emerald-700 disabled:bg-emerald-800/50',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50',
    danger: 'bg-red-700 text-white hover:bg-red-600',
    ghost: 'text-slate-700 hover:bg-slate-100',
  };
  return (
    <button {...rest} disabled={busy || rest.disabled}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed', styles[variant], className)}>
      {busy && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5', className)}>
      {(title || actions) && <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>{actions}</div>}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20';

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info' | 'warn' | 'success'; children: ReactNode }) {
  const t = { error: 'bg-red-50 text-red-800 ring-red-200', info: 'bg-sky-50 text-sky-800 ring-sky-200', warn: 'bg-amber-50 text-amber-900 ring-amber-200', success: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }[tone];
  return <div className={cx('rounded-lg px-3 py-2 text-sm ring-1', t)}>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><span className="size-5 animate-spin rounded-full border-2 border-emerald-800 border-t-transparent" />{label}</div>;
}

export const REQUEST_STATUS: Record<string, { label: string; tone: string }> = {
  SUBMITTED: { label: 'Submitted', tone: 'bg-sky-100 text-sky-800' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'bg-sky-100 text-sky-800' },
  UNDER_ADMIN_REVIEW: { label: 'Under review', tone: 'bg-indigo-100 text-indigo-800' },
  RETURNED_FOR_CORRECTION: { label: 'Returned', tone: 'bg-amber-100 text-amber-900' },
  FORWARDED_TO_SPC: { label: 'Awaiting SPC', tone: 'bg-violet-100 text-violet-800' },
  APPROVED: { label: 'Approved', tone: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Declined', tone: 'bg-red-100 text-red-800' },
  DRIVER_ASSIGNED: { label: 'Driver assigned', tone: 'bg-teal-100 text-teal-800' },
  TRIP_COMPLETED: { label: 'Trip completed', tone: 'bg-slate-200 text-slate-800' },
  CLOSED: { label: 'Closed', tone: 'bg-slate-100 text-slate-600' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-slate-100 text-slate-600' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = REQUEST_STATUS[status] ?? { label: status, tone: 'bg-slate-100 text-slate-700' };
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', s.tone)}>{s.label}</span>;
}

// Runs an async action with busy state and an error message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo.png" alt="" className={small ? 'size-9' : 'size-14'} />
      <div>
        <div className={cx('font-bold text-emerald-900', small ? 'text-sm' : 'text-lg')}>SPIN-KN Fleet</div>
        {!small && <div className="text-xs text-slate-500">Sustainable Power and Irrigation for Nigeria — Kano State</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dialogs

export function Modal({ title, sub, onClose, children, footer, wide }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className={cx('max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-base font-semibold">{title}</h2>{sub && <div className="text-sm text-slate-500">{sub}</div>}</div>
          <button className="rounded-lg px-2 text-xl leading-none text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// Shown once after creating an account or resetting a password.
export function TempPasswordModal({ info, onClose }: { info: { email: string; tempPassword: string; name?: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `SPIN-KN Fleet sign-in\nAddress: ${location.origin}\nEmail: ${info.email}\nTemporary password: ${info.tempPassword}\nYou will be asked to choose your own password at first sign-in.`;
  return (
    <Modal title="Account ready" sub={info.name} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => undefined); setCopied(true); }}>{copied ? 'Copied ✓' : 'Copy details'}</Button>
        <Button onClick={onClose}>Done</Button>
      </>}>
      <Alert tone="warn">Write this down or copy it now. The temporary password is not shown again.</Alert>
      <dl className="grid grid-cols-[9.5rem_1fr] gap-y-2 text-sm">
        <dt className="text-slate-500">Email</dt><dd className="font-medium">{info.email}</dd>
        <dt className="text-slate-500">Temporary password</dt><dd className="font-mono text-base font-semibold tracking-wide">{info.tempPassword}</dd>
      </dl>
      <p className="text-sm text-slate-600">They must choose their own password the first time they sign in.</p>
    </Modal>
  );
}

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue';

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  const t: Record<Tone, string> = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-800', blue: 'bg-sky-100 text-sky-800' };
  return <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', t[tone])}>{children}</span>;
}

// For a yyyy-MM-dd date: expired, due within warnDays, or fine.
export function expiryState(date: string | null | undefined, warnDays = 30): 'expired' | 'soon' | 'ok' | null {
  if (!date) return null;
  const days = (Date.parse(date + 'T23:59:59') - Date.now()) / 86400_000;
  return days < 0 ? 'expired' : days <= warnDays ? 'soon' : 'ok';
}

export function ExpiryBadge({ label, date, warnDays }: { label: string; date?: string | null; warnDays?: number }) {
  const s = expiryState(date, warnDays);
  if (!s || s === 'ok') return null;
  return <Badge tone={s === 'expired' ? 'red' : 'amber'}>{label} {s === 'expired' ? 'expired' : 'due'} {fmtDate(date)}</Badge>;
}

export const num = (n?: number | null) => (n == null ? '-' : Math.round(n).toLocaleString('en-GB'));

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={cx(inputCls, 'sm:max-w-xs')} type="search" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />;
}
