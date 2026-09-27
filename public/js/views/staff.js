import { html, useState, useEffect, useRef } from '../lib.js';
import { t } from '../i18n.js';
import { publicApi, uid, ask, toast } from '../store.js';
import { Button, Field, Icon, Status, Alert, Tabs, FilePick, Modal, Empty, fmtDT, toLocalInput, copyText, todayStr } from '../ui.js';
import { StaffHeader, StatusDetails } from './status.js';

export function StaffPortal({ token }) {
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('new');
  const [editing, setEditing] = useState(null);   // request being corrected
  const [done, setDone] = useState(null);         // {ref, statusToken, resubmitted}
  const [viewing, setViewing] = useState(null);   // statusToken shown in a modal
  const [formKey, setFormKey] = useState(1);

  const load = async () => {
    try { setHome(await publicApi('lookup', { token })); setErr(null); }
    catch (e) { setErr(e); }
  };
  useEffect(() => { setHome(null); setErr(null); load(); }, [token]);

  const exit = () => { location.hash = ''; };
  const header = html`<${StaffHeader} right=${html`<${Button} variant="ghost" size="sm" icon="logout" onClick=${exit}>${t('endStaffSession')}<//>`} />`;

  if (err) {
    const key = ['invalidToken', 'revokedToken', 'inactiveStaff'].includes(err.code) ? err.code : null;
    return html`<div class="staff-page">${header}<main class="staff-main">
      <${Alert} tone="red" icon="xCircle" title=${key ? t(key) : err.message}>${t('staffCardHint')}<//>
      <a class="btn btn-secondary mt" href="#">${t('backHome')}</a>
    </main></div>`;
  }
  if (!home) return html`<div class="staff-page">${header}<main class="staff-main"><div class="loading"><span class="spinner dark" /> ${t('loading')}</div></main></div>`;

  const s = home.staff;
  const returned = home.requests.filter(r => r.canEdit);

  const submitted = res => {
    setHome(res.home);
    setDone({ ref: res.ref, statusToken: res.statusToken, resubmitted: !!editing });
    setEditing(null);
    window.scrollTo(0, 0);
  };

  const cancelReq = async r => {
    const reason = await ask({ title: t('cancelRequestQ'), body: t('cancelRequestBody'), input: { label: t('reason'), required: false }, confirmLabel: t('cancelRequest'), cancelLabel: t('keepRequest'), tone: 'danger' });
    if (reason === false) return;
    try { setHome(await publicApi('cancel', { token, id: r.id, reason })); toast(t('requestCancelled'), 'warn'); }
    catch (e) { toast(e.message, 'error'); }
  };

  let body;
  if (done) {
    const link = location.origin + '/#r=' + done.statusToken;
    body = html`<div class="card"><div class="card-bd success-panel">
      <span class="big-check"><${Icon} name="check" size=${34} /></span>
      <h2>${done.resubmitted ? t('resubmitted') : t('requestSubmitted')}</h2>
      <p class="muted">${t('submittedRecorded')}</p>
      <div class="ref-box"><div class="eyebrow">${t('reference')}</div><div class="ref-big">${done.ref}</div></div>
      <div class="link-box">
        <div class="eyebrow">${t('statusLink')}</div>
        <code>${link}</code>
        <p class="small muted">${t('statusLinkHint')}</p>
        <div class="row gap-sm wrap center">
          <${Button} variant="secondary" size="sm" icon="copy" onClick=${async () => { if (await copyText(link)) toast(t('copied')); }}>${t('copyLink')}<//>
          <${Button} variant="secondary" size="sm" icon="eye" onClick=${() => setViewing(done.statusToken)}>${t('checkStatus')}<//>
        </div>
      </div>
      <div class="row gap-sm wrap center mt">
        <${Button} icon="plus" onClick=${() => { setDone(null); setTab('new'); setFormKey(k => k + 1); }}>${t('newRequest')}<//>
        <${Button} variant="ghost" onClick=${() => { setDone(null); setTab('mine'); }}>${t('myRequests')}<//>
      </div>
    </div></div>`;
  } else if (editing) {
    body = html`<div class="stack">
      <${Alert} tone="red" icon="undo" title=${t('returnedBecause') + ':'}>${editing.returnReason || '—'}<//>
      <${RequestForm} token=${token} home=${home} initial=${editing} onDone=${submitted} onCancel=${() => setEditing(null)} />
    </div>`;
  } else {
    body = html`<div class="stack">
      ${returned.length ? html`<${Alert} tone="red" icon="undo" title=${t('sf_returned')}>
        ${returned.map(r => html`<div class="row between wrap gap-sm"><span><b>${r.ref}</b> — ${r.returnReason}</span><${Button} size="sm" variant="secondary" onClick=${() => setEditing(r)}>${t('editResubmit')}<//></div>`)}
      <//>` : null}
      <${Tabs} value=${tab} onChange=${setTab} items=${[{ value: 'new', label: t('newRequest') }, { value: 'mine', label: t('myRequests'), count: home.requests.length }]} />
      ${tab === 'new'
        ? html`<${RequestForm} key=${formKey} token=${token} home=${home} onDone=${submitted} />`
        : html`<${MyRequests} list=${home.requests} onView=${r => setViewing(r.statusToken)} onEdit=${setEditing} onCancel=${cancelReq} />`}
    </div>`;
  }

  return html`<div class="staff-page">${header}
    <main class="staff-main">
      <div class="staff-id">
        <span class="avatar">${initials(s.fullName)}</span>
        <div class="grow"><div class="staff-name">${s.fullName}</div><div class="muted small">${s.designation}</div><div class="muted xsmall">${s.unitCode} — ${s.unit}</div></div>
        <span class="badge tone-green"><${Icon} name="shield" size=${13} />${t('staff')}</span>
      </div>
      <p class="xsmall muted center">${t('staffSessionNote')}</p>
      ${body}
    </main>
    ${viewing ? html`<${Modal} title=${t('checkStatus')} onClose=${() => setViewing(null)}><${StatusDetails} statusToken=${viewing} /><//>` : null}
  </div>`;
}

export const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();

function MyRequests({ list, onView, onEdit, onCancel }) {
  if (!list.length) return html`<${Empty} icon="clipboard" text=${t('noRequestsYet')} />`;
  return html`<div class="stack-sm">
    ${list.map(r => html`<div class="card req-card"><div class="card-bd">
      <div class="row between wrap gap-sm"><strong>${r.ref}</strong><${Status} status=${r.status} staff /></div>
      <div class="req-purpose">${r.purpose}</div>
      <div class="muted small row gap-sm wrap"><span><${Icon} name="pin" size=${13} /> ${r.destination}</span><span><${Icon} name="calendar" size=${13} /> ${fmtDT(r.departTs)} → ${fmtDT(r.returnTs)}</span></div>
      ${r.canEdit ? html`<p class="small tone-text-red"><b>${t('returnedBecause')}:</b> ${r.returnReason}</p>` : null}
      <div class="row gap-sm wrap mt-sm">
        <${Button} size="sm" variant="secondary" icon="eye" onClick=${() => onView(r)}>${t('checkStatus')}<//>
        ${r.canEdit ? html`<${Button} size="sm" icon="edit" onClick=${() => onEdit(r)}>${t('editResubmit')}<//>` : null}
        ${r.canCancel ? html`<${Button} size="sm" variant="ghost-danger" icon="ban" onClick=${() => onCancel(r)}>${t('cancelRequest')}<//>` : null}
      </div>
    </div></div>`)}
  </div>`;
}

const splitIso = (iso, fallbackTime) => {
  if (!iso) return ['', fallbackTime];
  const v = toLocalInput(iso);
  return [v.slice(0, 10), v.slice(11, 16)];
};

function RequestForm({ token, home, initial, onDone, onCancel }) {
  const src = initial && initial.form;
  const [dd, dt] = splitIso(src && src.departTs, '08:00');
  const [rd, rt] = splitIso(src && src.returnTs, '16:00');
  const [f, setF] = useState(() => ({
    purpose: src ? src.purpose : '', component: src ? src.component : '', destination: src ? src.destination : '',
    departDate: dd, departTime: dt, returnDate: rd, returnTime: rt,
    passengers: src ? src.passengers : 1, passengerList: src ? (src.passengerList || []) : [],
    vehicle: src ? src.vehicle : (home.options.vehicleTypes[home.options.vehicleTypes.length - 1] || ''),
    priority: src ? src.priority : 'normal', urgentReason: src ? src.urgentReason : '',
    assignment: src ? src.assignment : '', remarks: src ? src.remarks : '', doc: null,
  }));
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const submissionId = useRef(uid());

  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const inp = k => ({ value: f[k] ?? '', onInput: e => set(k, e.target.value) });

  const validate = () => {
    const e = {};
    if (!f.purpose.trim()) e.purpose = t('v_required');
    if (!f.component) e.component = t('v_required');
    if (!f.destination.trim()) e.destination = t('v_required');
    if (!f.departDate) e.departDate = t('v_date');
    if (!f.returnDate) e.returnDate = t('v_date');
    const dep = new Date(`${f.departDate}T${f.departTime || '08:00'}`), ret = new Date(`${f.returnDate}T${f.returnTime || '16:00'}`);
    if (f.departDate && f.returnDate && ret < dep) e.returnDate = t('v_returnBeforeDeparture');
    const n = Number(f.passengers);
    if (!Number.isInteger(n) || n < 1 || n > 60) e.passengers = t('v_passengers');
    if (f.priority === 'urgent' && !f.urgentReason.trim()) e.urgentReason = t('v_urgentReason');
    return e;
  };

  const submit = async ev => {
    ev.preventDefault();
    const e = validate();
    setErrs(e);
    if (Object.keys(e).length) {
      setTimeout(() => { const el = document.querySelector('.field-error'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 0);
      return;
    }
    setBusy(true); setServerErr('');
    const payload = {
      token, submissionId: submissionId.current, purpose: f.purpose, component: f.component, destination: f.destination,
      departTs: new Date(`${f.departDate}T${f.departTime || '08:00'}`).toISOString(),
      returnTs: new Date(`${f.returnDate}T${f.returnTime || '16:00'}`).toISOString(),
      passengers: Number(f.passengers), passengerList: f.passengerList.filter(p => p.name && p.name.trim()),
      vehicle: f.vehicle, priority: f.priority, urgentReason: f.urgentReason, assignment: f.assignment, remarks: f.remarks, doc: f.doc,
    };
    try {
      const res = initial ? await publicApi('resubmit', { ...payload, id: initial.id }) : await publicApi('submit', payload);
      onDone(res);
    } catch (e2) {
      setServerErr(e2.code && t(e2.code) !== e2.code ? t(e2.code) : e2.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setBusy(false); }
  };

  const pax = f.passengerList;
  const setPax = (i, k, v) => set('passengerList', pax.map((p, j) => j === i ? { ...p, [k]: v } : p));

  return html`<form class="card" onSubmit=${submit} novalidate><div class="card-bd stack">
    <div><h2>${t('officialTripRequest')}</h2>${initial ? html`<p class="muted small">${initial.ref}</p>` : null}</div>
    ${serverErr ? html`<${Alert} tone="red" icon="xCircle">${serverErr}<//>` : null}

    <${Field} label=${t('tripPurpose')} required error=${errs.purpose}><textarea class="input" rows="2" maxlength="500" ...${inp('purpose')} /><//>
    <div class="grid-2">
      <${Field} label=${t('drivingComponent')} required error=${errs.component}>
        <select class="input" value=${f.component} onChange=${e => set('component', e.target.value)}>
          <option value="">${t('selectPlaceholder')}</option>
          ${home.options.components.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      <//>
      <${Field} label=${t('destination')} required error=${errs.destination}><input class="input" maxlength="300" ...${inp('destination')} /><//>
    </div>

    <fieldset class="fieldset"><legend>${t('departure')}</legend>
      <div class="grid-2">
        <${Field} label=${t('departureDate')} required error=${errs.departDate}><input class="input" type="date" min=${todayStr()} ...${inp('departDate')} /><//>
        <${Field} label=${t('departureTime')}><input class="input" type="time" ...${inp('departTime')} /><//>
      </div>
    </fieldset>
    <fieldset class="fieldset"><legend>${t('expectedReturn')}</legend>
      <div class="grid-2">
        <${Field} label=${t('returnDate')} required error=${errs.returnDate}><input class="input" type="date" min=${f.departDate || todayStr()} ...${inp('returnDate')} /><//>
        <${Field} label=${t('returnTime')}><input class="input" type="time" ...${inp('returnTime')} /><//>
      </div>
    </fieldset>

    <div class="grid-2">
      <${Field} label=${t('numPassengers')} hint=${t('passengersIncludingYou')} required error=${errs.passengers}><input class="input" type="number" min="1" max="60" inputmode="numeric" ...${inp('passengers')} /><//>
      <${Field} label=${t('vehicleRequirement')}>
        <select class="input" value=${f.vehicle} onChange=${e => set('vehicle', e.target.value)}>${home.options.vehicleTypes.map(v => html`<option value=${v}>${v}</option>`)}</select>
      <//>
    </div>

    <div>
      <div class="field-label">${t('passengerDetails')} <span class="muted">(${t('optional')})</span></div>
      ${pax.map((p, i) => html`<div class="pax-row">
        <input class="input" placeholder=${t('passengerName')} value=${p.name} onInput=${e => setPax(i, 'name', e.target.value)} />
        <input class="input" placeholder=${t('passengerOrg')} value=${p.org} onInput=${e => setPax(i, 'org', e.target.value)} />
        <button type="button" class="icon-btn" aria-label=${t('removeFile')} onClick=${() => set('passengerList', pax.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button>
      </div>`)}
      ${pax.length < 60 ? html`<${Button} variant="ghost" size="sm" icon="plus" onClick=${() => set('passengerList', [...pax, { name: '', org: '' }])}>${t('addPassenger')}<//>` : null}
    </div>

    <${Field} label=${t('priorityLbl')}>
      <div class="seg-toggle">
        <button type="button" class=${f.priority === 'normal' ? 'on' : ''} onClick=${() => set('priority', 'normal')}>${t('normal')}</button>
        <button type="button" class=${f.priority === 'urgent' ? 'on urgent' : ''} onClick=${() => set('priority', 'urgent')}>${t('urgent')}</button>
      </div>
    <//>
    ${f.priority === 'urgent' ? html`<${Field} label=${t('urgentJustification')} required error=${errs.urgentReason}><textarea class="input" rows="2" maxlength="500" ...${inp('urgentReason')} /><//>` : null}

    <${Field} label=${t('officialAssignment')}><input class="input" maxlength="500" ...${inp('assignment')} /><//>
    <${Field} label=${t('additionalRemarks')}><textarea class="input" rows="2" maxlength="1000" ...${inp('remarks')} /><//>
    <${Field} label=${html`${t('supportingDoc')} <span class="muted">(${t('optional')})</span>`}>
      <${FilePick} value=${f.doc} onChange=${v => set('doc', v)} />
    <//>

    <div class="row gap-sm wrap">
      <button type="submit" class="btn btn-primary btn-lg grow" disabled=${busy}>${busy ? html`<span class="spinner" />` : html`<${Icon} name="send" size=${17} />`}<span>${busy ? t('submitting') : initial ? t('resubmit') : t('submitTripRequest')}</span></button>
      ${onCancel ? html`<${Button} variant="ghost" onClick=${onCancel}>${t('cancel')}<//>` : null}
    </div>
  </div></form>`;
}
