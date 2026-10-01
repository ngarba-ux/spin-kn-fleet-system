// Staff directory and their QR cards (admin only: QR tokens are credentials).
import { FormEvent, useMemo, useState } from 'react';
import { collection } from 'firebase/firestore';
import { db, call } from '../firebase';
import { useCollection, useSettings, WithId } from '../data';
import { printCards, qrLink, qrSvg, CardStaff } from '../print';
import { Staff } from '../types';
import { Alert, Badge, Button, Card, cx, Field, inputCls, Modal, SearchInput, Spinner, useAction } from '../ui';

export function StaffPage() {
  const staff = useCollection<Staff>(collection(db, 'staff'), 'staff');
  const secrets = useCollection<{ qrToken: string }>(collection(db, 'staffSecrets'), 'staffSecrets');
  const settings = useSettings();
  const [q, setQ] = useState('');
  const [unit, setUnit] = useState('');
  const [editing, setEditing] = useState<WithId<Staff> | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const tokenOf = (id: string) => secrets.data.find(x => x.id === id)?.qrToken ?? '';
  const units = useMemo(() => [...new Set(staff.data.map(s => s.unitCode).filter((x): x is string => !!x))].sort(), [staff.data]);
  const rows = staff.data
    .filter(s => (!unit || s.unitCode === unit) && (!q || [s.fullName, s.employeeNo, s.designation, s.email, s.unit].join(' ').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.staffNo || a.fullName).localeCompare(b.staffNo || b.fullName));
  const card = (s: WithId<Staff>): CardStaff => ({ ...s, token: tokenOf(s.id) });
  const printable = rows.filter(s => s.status === 'active' && s.qrStatus === 'active' && tokenOf(s.id));
  const current = viewing ? staff.data.find(s => s.id === viewing) : undefined;

  const toggle = (s: WithId<Staff>) => {
    if (!confirm(s.status === 'active' ? `Deactivate ${s.fullName}? Their QR card stops working until reactivated.` : `Reactivate ${s.fullName}?`)) return;
    run(() => call('staffToggle', { id: s.id }));
  };

  if (staff.loading || secrets.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Each staff member's QR card lets them request a vehicle without an account. Cards link to <b>{(settings.publicBaseUrl || location.origin).replace(/^https?:\/\//, '')}</b>.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <select className={cx(inputCls, 'w-auto')} value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="">All units</option>
            {units.map(u => <option key={u}>{u}</option>)}
          </select>
          <SearchInput value={q} onChange={setQ} placeholder="Search name, role, email…" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!printable.length} onClick={() => printCards(printable.map(card), settings.publicBaseUrl)}>
            Print {unit || q ? 'these' : 'all'} cards ({printable.length})
          </Button>
          <Button onClick={() => setEditing('new')}>Add staff</Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Unit</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">QR card</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(s => (
              <tr key={s.id} className={s.status !== 'active' ? 'opacity-60' : ''}>
                <td className="px-4 py-2.5"><div className="font-semibold">{s.fullName}</div><div className="text-xs text-slate-500">{s.designation} · {s.employeeNo || s.staffNo}</div></td>
                <td className="px-4 py-2.5">{s.unitCode}<div className="text-xs text-slate-500">{s.unit}</div></td>
                <td className="px-4 py-2.5 text-slate-600">{s.email ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {s.status !== 'active' ? <Badge>Staff inactive</Badge> : s.qrStatus === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="red">Revoked</Badge>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <Button variant="ghost" onClick={() => setViewing(s.id)}>QR</Button>
                  <Button variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                  <Button variant="ghost" busy={busy} onClick={() => toggle(s)}>{s.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No staff match.</p>}
      </Card>
      {current && <QrModal s={current} token={tokenOf(current.id)} base={settings.publicBaseUrl} onClose={() => setViewing(null)} />}
      {editing && <StaffForm s={editing === 'new' ? null : editing} all={staff.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function QrModal({ s, token, base, onClose }: { s: WithId<Staff>; token: string; base: string; onClose: () => void }) {
  const { busy, error, run } = useAction();
  const [copied, setCopied] = useState(false);
  const link = qrLink(token, base);
  const active = s.qrStatus === 'active' && s.status === 'active';

  const revoke = () => {
    if (confirm(`Revoke ${s.fullName}'s QR card? The printed card stops working immediately.`)) run(() => call('staffToken', { id: s.id, action: 'revoke' }));
  };
  const regenerate = () => {
    if (confirm('Generate a new QR code? Any card already printed for this person stops working. Print and hand over the new card.')) run(() => call('staffToken', { id: s.id, action: 'regenerate' }));
  };

  return (
    <Modal title={s.fullName} sub={s.designation ?? undefined} onClose={onClose}
      footer={<>
        {s.qrStatus === 'active' && <Button variant="ghost" busy={busy} onClick={revoke}>Revoke</Button>}
        <Button variant="ghost" busy={busy} onClick={regenerate}>New QR code</Button>
        {active && <Button onClick={() => printCards([{ ...s, token }], base)}>Print card</Button>}
      </>}>
      {active ? (
        <>
          <div className="qr-preview mx-auto w-56" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
          <div className="break-all rounded-lg bg-slate-50 p-2 text-center font-mono text-xs text-slate-600">{link}</div>
          <div className="flex justify-center">
            <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => undefined); setCopied(true); }}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
          </div>
          <p className="text-center text-xs text-slate-500">Anyone holding this card can request trips in {s.fullName}'s name. If it is lost, revoke it or make a new code.</p>
        </>
      ) : (
        <Alert>{s.status !== 'active' ? 'This staff member is inactive, so their card does not work.' : 'This card has been revoked. Make a new QR code to reissue it.'}</Alert>
      )}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

function StaffForm({ s, all, onClose }: { s: WithId<Staff> | null; all: WithId<Staff>[]; onClose: () => void }) {
  const [f, setF] = useState({
    fullName: s?.fullName ?? '', employeeNo: s?.employeeNo ?? '', designation: s?.designation ?? '',
    unitCode: s?.unitCode ?? '', unit: s?.unit ?? '', email: s?.email ?? '', phone: s?.phone ?? '',
  });
  const { busy, error, run } = useAction();
  // Unit code -> unit name, from the existing directory.
  const units = useMemo(() => Object.fromEntries(all.filter(x => x.unitCode && x.unit).map(x => [x.unitCode!, x.unit!])), [all]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => { await call('staffSave', { ...f, id: s?.id }); onClose(); });
  };
  return (
    <Modal wide title={s ? `Edit ${s.fullName}` : 'Add staff member'} sub={s ? undefined : 'A QR card is created automatically.'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} type="submit" form="staff-form">Save</Button></>}>
      <form id="staff-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Full name *"><input className={inputCls} value={f.fullName} onChange={set('fullName')} required /></Field></div>
        <Field label="Employee no."><input className={inputCls} value={f.employeeNo} onChange={set('employeeNo')} /></Field>
        <Field label="Designation"><input className={inputCls} value={f.designation} onChange={set('designation')} /></Field>
        <Field label="Unit code">
          <input className={inputCls} list="unit-codes" value={f.unitCode}
            onChange={e => { const c = e.target.value; setF(x => ({ ...x, unitCode: c, unit: x.unit || units[c] || '' })); }} />
          <datalist id="unit-codes">{Object.entries(units).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</datalist>
        </Field>
        <Field label="Unit / section"><input className={inputCls} value={f.unit} onChange={set('unit')} /></Field>
        <Field label="Official email" hint="Trip request updates are emailed here."><input className={inputCls} type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input className={inputCls} type="tel" value={f.phone} onChange={set('phone')} /></Field>
      </form>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
