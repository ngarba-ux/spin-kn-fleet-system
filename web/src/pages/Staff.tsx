// Staff arrive by scanning the QR code on their ID card (#s=<token>). No
// account: every call sends the card token to the staffPortal function.
import { FormEvent, useEffect, useState } from 'react';
import { call } from '../firebase';
import { readAsDataUrl } from '../data';
import { Alert, Button, Card, Field, fmtDT, inputCls, Logo, Spinner, StatusBadge, useAction } from '../ui';

interface StaffRequest {
  id: string; ref: string; status: string; purpose: string; destination: string; departTs: string; returnTs: string;
  statusToken: string; canCancel: boolean; canEdit: boolean; returnReason: string | null;
  form: Record<string, unknown> | null;
}

interface Home {
  staff: { fullName: string; designation: string; unit: string };
  requests: StaffRequest[];
  options: { components: string[]; vehicleTypes: string[] };
  orgName: string;
}

export function StaffPortal({ token }: { token: string }) {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffRequest | 'new' | null>(null);
  const [done, setDone] = useState<{ ref: string; statusToken: string } | null>(null);

  useEffect(() => {
    call<Home>('staffPortal', { type: 'lookup', token }).then(setHome, e => setError(e.message));
  }, [token]);

  if (error) return <Shell><Alert>{error}</Alert></Shell>;
  if (!home) return <Shell><Spinner label="Checking your card…" /></Shell>;

  if (editing) {
    return (
      <Shell>
        <RequestForm token={token} home={home} existing={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onDone={r => { setHome(r.home); setDone(r); setEditing(null); }} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <div className="text-lg font-semibold">{home.staff.fullName}</div>
        <div className="text-sm text-slate-600">{home.staff.designation} · {home.staff.unit}</div>
      </Card>
      {done && <Alert tone="success">Request {done.ref} sent. You will get an email as it progresses. <a className="font-semibold underline" href={`#r=${done.statusToken}`}>Track it</a></Alert>}
      <Button className="w-full" onClick={() => { setDone(null); setEditing('new'); }}>Request a vehicle</Button>
      <Card title="My requests">
        {home.requests.length === 0 ? <p className="text-sm text-slate-500">No requests yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {home.requests.map(r => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex items-center justify-between gap-2"><a className="font-semibold text-emerald-900 underline" href={`#r=${r.statusToken}`}>{r.ref}</a><StatusBadge status={r.status} /></div>
                <div className="text-sm">{r.purpose} → {r.destination}</div>
                <div className="text-xs text-slate-500">{fmtDT(r.departTs)} – {fmtDT(r.returnTs)}</div>
                {r.returnReason && <Alert tone="warn">Returned: {r.returnReason}</Alert>}
                <div className="flex gap-2 pt-1">
                  {r.canEdit && <Button variant="secondary" onClick={() => setEditing(r)}>Correct & resubmit</Button>}
                  {r.canCancel && <CancelButton token={token} id={r.id} onDone={setHome} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl space-y-4 px-4 py-6"><Logo />{children}</div>;
}

function CancelButton({ token, id, onDone }: { token: string; id: string; onDone: (h: Home) => void }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <Button variant="ghost" busy={busy} onClick={() => {
        const reason = prompt('Why are you cancelling this request?');
        if (reason !== null) run(async () => onDone(await call<Home>('staffPortal', { type: 'cancel', token, id, reason })));
      }}>Cancel request</Button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </>
  );
}

const local = (iso: unknown) => {
  if (typeof iso !== 'string') return { date: '', time: '' };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

function RequestForm({ token, home, existing, onCancel, onDone }: {
  token: string; home: Home; existing: StaffRequest | null;
  onCancel: () => void; onDone: (r: { ref: string; statusToken: string; home: Home }) => void;
}) {
  const f0 = existing?.form ?? {};
  const [f, setF] = useState({
    purpose: String(f0.purpose ?? ''), destination: String(f0.destination ?? ''), component: String(f0.component ?? home.options.components[0] ?? ''),
    departDate: local(f0.departTs).date, departTime: local(f0.departTs).time || '08:00',
    returnDate: local(f0.returnTs).date, returnTime: local(f0.returnTs).time || '16:00',
    passengers: String(f0.passengers ?? '1'), vehicle: String(f0.vehicle ?? home.options.vehicleTypes.at(-1) ?? ''),
    priority: String(f0.priority ?? 'normal'), urgentReason: String(f0.urgentReason ?? ''),
    assignment: String(f0.assignment ?? ''), remarks: String(f0.remarks ?? ''),
  });
  const [file, setFile] = useState<File | null>(null);
  const [submissionId] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const doc = file ? await readAsDataUrl(file) : undefined;
      const payload = {
        token, submissionId, doc,
        type: existing ? 'resubmit' : 'submit', id: existing?.id,
        purpose: f.purpose, destination: f.destination, component: f.component,
        departTs: new Date(`${f.departDate}T${f.departTime}`).toISOString(),
        returnTs: new Date(`${f.returnDate}T${f.returnTime}`).toISOString(),
        passengers: Number(f.passengers), vehicle: f.vehicle, priority: f.priority, urgentReason: f.urgentReason,
        assignment: f.assignment, remarks: f.remarks,
      };
      onDone(await call('staffPortal', payload));
    });
  };

  return (
    <Card title={existing ? `Correct ${existing.ref}` : 'Request a vehicle'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Purpose of trip"><input className={inputCls} value={f.purpose} onChange={set('purpose')} required maxLength={500} /></Field>
        <Field label="Destination"><input className={inputCls} value={f.destination} onChange={set('destination')} required maxLength={300} /></Field>
        <Field label="Project component">
          <select className={inputCls} value={f.component} onChange={set('component')}>{home.options.components.map(c => <option key={c}>{c}</option>)}</select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Departure date"><input className={inputCls} type="date" value={f.departDate} onChange={set('departDate')} required /></Field>
          <Field label="Time"><input className={inputCls} type="time" value={f.departTime} onChange={set('departTime')} required /></Field>
          <Field label="Return date"><input className={inputCls} type="date" value={f.returnDate} onChange={set('returnDate')} required /></Field>
          <Field label="Time"><input className={inputCls} type="time" value={f.returnTime} onChange={set('returnTime')} required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Passengers"><input className={inputCls} type="number" min={1} max={60} value={f.passengers} onChange={set('passengers')} required /></Field>
          <Field label="Vehicle">
            <select className={inputCls} value={f.vehicle} onChange={set('vehicle')}>{home.options.vehicleTypes.map(c => <option key={c}>{c}</option>)}</select>
          </Field>
        </div>
        <Field label="Priority">
          <select className={inputCls} value={f.priority} onChange={set('priority')}><option value="normal">Normal</option><option value="urgent">Urgent</option></select>
        </Field>
        {f.priority === 'urgent' && <Field label="Why is it urgent?"><textarea className={inputCls} rows={2} value={f.urgentReason} onChange={set('urgentReason')} required /></Field>}
        <Field label="Assignment / reference (optional)"><input className={inputCls} value={f.assignment} onChange={set('assignment')} /></Field>
        <Field label="Remarks (optional)"><textarea className={inputCls} rows={2} value={f.remarks} onChange={set('remarks')} /></Field>
        <Field label="Supporting document (optional)" hint="JPG, PNG, WEBP or PDF, up to 5 MB">
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" busy={busy} className="flex-1">{existing ? 'Resubmit' : 'Send request'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Back</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- status page (#r=<token>)

interface Status {
  ref: string; status: string; purpose: string; destination: string; departTs: string; returnTs: string; staffName: string;
  timeline: { action: string; ts: string; note: string }[];
  driver: { name: string; phone: string } | null;
  vehicle: { reg: string; model: string; colour: string } | null;
  orgName: string;
}

const STEP: Record<string, string> = {
  TRIP_REQUEST_SUBMITTED: 'Request submitted', TRIP_REQUEST_RESUBMITTED: 'Corrected and resubmitted', ADMIN_ACKNOWLEDGED: 'Acknowledged by the office',
  ADMIN_REVIEWED: 'Under review', FORWARDED_TO_SPC: 'Sent for approval', RETURNED_FOR_CORRECTION: 'Returned for correction', SPC_APPROVED: 'Approved',
  SPC_REJECTED: 'Declined', TRIP_RESCHEDULED: 'Rescheduled', DRIVER_ASSIGNED: 'Vehicle & driver assigned', REQUEST_CANCELLED: 'Cancelled',
  TRIP_COMPLETED: 'Trip completed', REQUEST_CLOSED: 'Closed',
};

export function StatusPage({ token }: { token: string }) {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { call<Status>('staffPortal', { type: 'status', statusToken: token }).then(setS, e => setError(e.message)); }, [token]);

  if (error) return <Shell><Alert>{error}</Alert></Shell>;
  if (!s) return <Shell><Spinner /></Shell>;
  return (
    <Shell>
      <Card title={s.ref} actions={<StatusBadge status={s.status} />}>
        <div className="space-y-1 text-sm">
          <div><b>{s.purpose}</b> → {s.destination}</div>
          <div className="text-slate-600">{fmtDT(s.departTs)} – {fmtDT(s.returnTs)}</div>
          <div className="text-slate-600">Requested by {s.staffName}</div>
        </div>
        {s.driver && s.vehicle && (
          <Alert tone="success"><b>Driver:</b> {s.driver.name}{s.driver.phone ? ` (${s.driver.phone})` : ''}<br /><b>Vehicle:</b> {s.vehicle.reg} – {s.vehicle.model}{s.vehicle.colour ? `, ${s.vehicle.colour}` : ''}</Alert>
        )}
      </Card>
      <Card title="Progress">
        <ol className="space-y-3 border-l-2 border-emerald-200 pl-4">
          {s.timeline.map((t, i) => (
            <li key={i}>
              <div className="text-sm font-medium">{STEP[t.action] ?? t.action}</div>
              <div className="text-xs text-slate-500">{fmtDT(t.ts)}</div>
              {t.note && <div className="text-sm text-slate-700">{t.note}</div>}
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-center text-xs text-slate-500">{s.orgName}</p>
    </Shell>
  );
}
