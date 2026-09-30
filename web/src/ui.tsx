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
