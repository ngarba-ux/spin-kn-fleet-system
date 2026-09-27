import { html, useState } from '../lib.js';
import { t } from '../i18n.js';
import { act, ask, toast } from '../store.js';
import { Button, Field, Icon, Status, Badge, Alert, Modal, Empty, Tabs, SearchBox, Select, Card, QR,
  fmtShort, timeAgo, byId, sortBy, bind, qrLink, qrSvg, esc, printHtml, copyText } from '../ui.js';
import { PageHead } from './office.js';
import { TempPasswordModal } from './fleet.js';

const localOnly = d => {
  const base = (d.settings.publicBaseUrl || location.origin).toLowerCase();
  return /\/\/(localhost|127\.)/.test(base);
};

function cardHtml(s) {
  return `<div class="qr-card">
    <div class="qr-card-hd"><img src="/logo.png" alt="" /><div><div class="t1">SPIN KN FLEET MANAGEMENT</div><div class="t2">Staff Trip Request — Official ID QR</div></div></div>
    <div class="qr-card-bd">
      <div class="qr-card-code">${qrSvg(qrLink(s.qrToken))}<div class="tok">${esc(s.qrToken)}</div></div>
      <div class="qr-card-meta"><div class="nm">${esc(s.fullName)}</div><div>${esc(s.designation || '')}</div><div>${esc(s.unitCode || '')} — ${esc(s.unit || '')}</div><div>Ref: ${esc(s.employeeNo || s.staffNo || '')}</div></div>
    </div>
    <div class="qr-card-ft">Scan with your phone camera to request an official vehicle.</div>
  </div>`;
}

export function printCards(list) {
  printHtml(`<div class="qr-sheet">${list.map(cardHtml).join('')}</div>`, 'SPIN KN Fleet — Staff QR Cards');
}

// ================================================================ staff & QR

export function StaffPage({ d }) {
  const [q, setQ] = useState('');
  const [unit, setUnit] = useState('');
  const [modal, setModal] = useState(null);
  const units = [...new Set(d.staff.map(s => s.unitCode).filter(Boolean))].sort();
  const rows = sortBy(d.staff.filter(s => (!unit || s.unitCode === unit) && (!q || [s.fullName, s.employeeNo, s.designation, s.email, s.unit].join(' ').toLowerCase().includes(q.toLowerCase()))), s => s.staffNo || s.fullName);
  const current = modal && modal.id ? byId(d.staff, modal.id) : null;
  const printable = rows.filter(s => s.status === 'active' && s.qrStatus === 'active');

  const toggle = async s => {
    const ok = await ask({ title: `${s.status === 'active' ? t('deactivate') : t('activate')} ${s.fullName}?`, body: s.status === 'active' ? 'Their QR card will stop working until reactivated.' : null, confirmLabel: s.status === 'active' ? t('deactivate') : t('activate'), tone: s.status === 'active' ? 'danger' : undefined });
    if (ok) act('staff.toggle', { id: s.id }, t('saved'));
  };

  return html`<div class="stack">
    <${PageHead} title=${t('staffDirectory')} sub="Each staff member's QR card lets them request a vehicle without an account."
      actions=${html`<${Button} variant="secondary" icon="printer" disabled=${!printable.length} onClick=${() => printCards(printable)}>${t('printAllCards')} (${printable.length})<//><${Button} icon="plus" onClick=${() => setModal({ kind: 'edit' })}>Add staff<//>`} />
    ${localOnly(d) ? html`<${Alert} tone="amber" title="QR codes point to this computer only" action=${html`<a class="btn btn-sm btn-secondary" href="#/settings">Open settings</a>`}>
      Cards printed now would open <code>${d.settings.publicBaseUrl || location.origin}</code>, which phones cannot reach. Set the public network address (for example <code>http://192.168.1.10:3000</code>) in Settings before printing.
    <//>` : null}
    <div class="toolbar">
      <${Select} value=${unit} onChange=${v => setUnit(v || '')} placeholder="All units" options=${units} />
      <${SearchBox} value=${q} onInput=${setQ} />
    </div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('fullName')}</th><th>${t('unitSection')}</th><th>${t('officialEmail')}</th><th class="num">Requests</th><th>QR</th><th>${t('status')}</th><th></th></tr></thead>
        <tbody>${rows.map(s => html`<tr class=${s.status !== 'active' ? 'dim' : ''}>
          <td><b>${s.fullName}</b><div class="xsmall muted">${s.designation} · ${s.employeeNo || s.staffNo}</div></td>
          <td>${s.unitCode}<div class="xsmall muted">${s.unit}</div></td>
          <td class="small">${s.email || html`<span class="tone-text-red">No email</span>`}<div class="xsmall muted">${s.phone || ''}</div></td>
          <td class="num">${d.requests.filter(r => r.staffId === s.id).length}</td>
          <td><${Status} status=${s.qrStatus === 'active' ? 'active' : 'revoked'} /></td>
          <td><${Status} status=${s.status} /></td>
          <td class="actions">
            <${Button} size="sm" variant="ghost" icon="qr" title=${t('viewQr')} onClick=${() => setModal({ kind: 'qr', id: s.id })} />
            <${Button} size="sm" variant="ghost" icon="edit" title=${t('edit')} onClick=${() => setModal({ kind: 'edit', id: s.id })} />
            <${Button} size="sm" variant="ghost" icon=${s.status === 'active' ? 'ban' : 'checkCircle'} title=${s.status === 'active' ? t('deactivate') : t('activate')} onClick=${() => toggle(s)} />
          </td>
        </tr>`)}</tbody></table></div>` : html`<${Empty} icon="users" text=${t('empty_search')} />`}
    <//>
    ${modal && modal.kind === 'qr' && current ? html`<${QrModal} s=${current} onClose=${() => setModal(null)} />` : null}
    ${modal && modal.kind === 'edit' ? html`<${StaffForm} d=${d} s=${current} onClose=${() => setModal(null)} />` : null}
  </div>`;
}

function QrModal({ s, onClose }) {
  const link = qrLink(s.qrToken);
  const revoke = async () => {
    const ok = await ask({ title: `${t('revoke')} QR for ${s.fullName}?`, body: 'The printed card stops working immediately. Generate a new one to reissue.', confirmLabel: t('revoke'), tone: 'danger' });
    if (ok) act('staff.revokeToken', { id: s.id }, t('tokenRevoked'));
  };
  const regen = async () => {
    const ok = await ask({ title: 'Generate a new QR code?', body: 'Any previously printed card for this person stops working. Print and hand over the new card.', confirmLabel: t('regenerate') });
    if (ok) act('staff.regenerateToken', { id: s.id }, t('tokenRegenerated'));
  };
  return html`<${Modal} title=${s.fullName} sub=${s.designation} size="sm" onClose=${onClose}
      footer=${html`${s.qrStatus === 'active' ? html`<${Button} variant="ghost-danger" icon="ban" onClick=${revoke}>${t('revoke')}<//>` : null}<${Button} variant="ghost" icon="refresh" onClick=${regen}>${t('regenerate')}<//>${s.qrStatus === 'active' ? html`<${Button} icon="printer" onClick=${() => printCards([s])}>${t('printCard')}<//>` : null}`}>
    ${s.qrStatus === 'active' ? html`<div class="stack center">
      <div class="qr-frame"><${QR} text=${link} size=${220} /></div>
      <p class="small muted">${t('scanToRequest')}</p>
      <code class="wrap-any small">${link}</code>
      <div class="row gap-sm center"><${Button} size="sm" variant="secondary" icon="copy" onClick=${async () => { if (await copyText(link)) toast(t('copied')); }}>${t('copyLink')}<//></div>
    </div>` : html`<${Alert} tone="red" title=${t('qrRevoked')}>This card has been revoked. Generate a new QR code to reissue it.<//>`}
  <//>`;
}

function StaffForm({ d, s, onClose }) {
  const [f, setF] = useState(() => s ? { ...s } : { fullName: '', employeeNo: '', designation: '', unitCode: '', unit: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const b = k => bind(f, setF, k);
  const units = {};
  d.staff.forEach(x => { if (x.unitCode) units[x.unitCode] = x.unit; });
  const save = async () => {
    setBusy(true);
    const r = await act('staff.save', { ...f, id: s ? s.id : null }, t('saved'));
    setBusy(false);
    if (r.ok) onClose();
  };
  return html`<${Modal} title=${s ? `${t('edit')} ${s.fullName}` : 'Add staff member'} onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${t('save')}<//>`}>
    <div class="grid-2">
      <${Field} label=${t('fullName')} required cls="span-2"><input class="input" ...${b('fullName')} /><//>
      <${Field} label="Employee no."><input class="input" ...${b('employeeNo')} /><//>
      <${Field} label=${t('designation')}><input class="input" ...${b('designation')} /><//>
      <${Field} label="Unit code"><input class="input" list="unit-codes" ...${b('unitCode')} onChange=${e => { const c = e.target.value; setF(x => ({ ...x, unitCode: c, unit: x.unit || units[c] || '' })); }} /><datalist id="unit-codes">${Object.keys(units).map(c => html`<option value=${c}>${units[c]}</option>`)}</datalist><//>
      <${Field} label=${t('unitSection')}><input class="input" ...${b('unit')} /><//>
      <${Field} label=${t('officialEmail')} hint="Status emails are sent here."><input class="input" type="email" ...${b('email')} /><//>
      <${Field} label=${t('phone')}><input class="input" type="tel" ...${b('phone')} /><//>
    </div>
    ${!s ? html`<p class="xsmall muted mt">A unique QR code is generated when you save.</p>` : null}
  <//>`;
}

// ================================================================ user accounts

export function UsersPage({ d }) {
  const [role, setRole] = useState('all');
  const [modal, setModal] = useState(null);
  const [cred, setCred] = useState(null);
  const rows = sortBy(d.users.filter(u => role === 'all' || u.role === role), u => ({ admin: 0, spc: 1, driver: 2 }[u.role] + u.name));
  const roleLabel = { admin: 'Administrator', spc: 'SPC', driver: t('driver') };
  const reset = async u => {
    const ok = await ask({ title: `Reset password for ${u.name}?`, body: 'A new temporary password will be generated and their sessions ended.', confirmLabel: 'Reset password' });
    if (!ok) return;
    const r = await act('user.resetPassword', { id: u.id });
    if (r.ok) setCred(r.result);
  };
  const toggle = async u => {
    const off = u.status === 'active';
    const ok = await ask({ title: `${off ? t('deactivate') : t('activate')} ${u.name}?`, confirmLabel: off ? t('deactivate') : t('activate'), tone: off ? 'danger' : undefined });
    if (ok) act(u.role === 'driver' ? 'driver.toggle' : 'user.toggle', u.role === 'driver' ? { id: (d.drivers.find(x => x.userId === u.id) || {}).id } : { id: u.id }, t('saved'));
  };
  return html`<div class="stack">
    <${PageHead} title="User accounts" sub="People who sign in. Drivers are added from the Drivers page." actions=${html`<${Button} icon="plus" onClick=${() => setModal({})}>Add office user<//>`} />
    <${Tabs} value=${role} onChange=${setRole} items=${[{ value: 'all', label: 'All', count: d.users.length }, { value: 'admin', label: 'Administrators', count: d.users.filter(u => u.role === 'admin').length }, { value: 'spc', label: 'SPC', count: d.users.filter(u => u.role === 'spc').length }, { value: 'driver', label: t('drivers'), count: d.users.filter(u => u.role === 'driver').length }]} />
    <${Card} pad=${false}><div class="table-wrap"><table class="table">
      <thead><tr><th>${t('fullName')}</th><th>Role</th><th>${t('status')}</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>${rows.map(u => html`<tr class=${u.status !== 'active' ? 'dim' : ''}>
        <td><b>${u.name}</b>${u.id === d.me.id ? html` <${Badge} tone="sky">You<//>` : null}<div class="xsmall muted">${u.email}</div></td>
        <td><${Badge} tone=${u.role === 'admin' ? 'violet' : u.role === 'spc' ? 'teal' : 'slate'}>${roleLabel[u.role]}<//></td>
        <td><${Status} status=${u.status} />${u.mustChangePassword ? html`<div class="xsmall muted">Must set password</div>` : null}</td>
        <td class="small">${u.lastLoginTs ? timeAgo(u.lastLoginTs) : html`<span class="muted">Never</span>`}</td>
        <td class="actions">
          ${u.role !== 'driver' ? html`<${Button} size="sm" variant="ghost" icon="edit" title=${t('edit')} onClick=${() => setModal({ user: u })} />` : null}
          <${Button} size="sm" variant="ghost" icon="key" title="Reset password" onClick=${() => reset(u)} />
          ${u.id !== d.me.id ? html`<${Button} size="sm" variant="ghost" icon=${u.status === 'active' ? 'ban' : 'checkCircle'} title=${u.status === 'active' ? t('deactivate') : t('activate')} onClick=${() => toggle(u)} />` : null}
        </td>
      </tr>`)}</tbody></table></div><//>
    ${modal ? html`<${UserForm} u=${modal.user} onClose=${() => setModal(null)} onCreated=${setCred} />` : null}
    ${cred ? html`<${TempPasswordModal} info=${cred} onClose=${() => setCred(null)} />` : null}
  </div>`;
}

function UserForm({ u, onClose, onCreated }) {
  const [f, setF] = useState(() => u ? { name: u.name, email: u.email, role: u.role } : { name: '', email: '', role: 'admin' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act('user.save', { ...f, id: u ? u.id : null }, t('saved'));
    setBusy(false);
    if (r.ok) { onClose(); if (r.result) onCreated(r.result); }
  };
  return html`<${Modal} title=${u ? `${t('edit')} ${u.name}` : 'Add office user'} size="sm" onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>${t('cancel')}<//><${Button} busy=${busy} onClick=${save}>${t('save')}<//>`}>
    <div class="stack">
      <${Field} label=${t('fullName')} required><input class="input" ...${bind(f, setF, 'name')} /><//>
      <${Field} label="Email" required><input class="input" type="email" ...${bind(f, setF, 'email')} /><//>
      <${Field} label="Role">
        <${Select} value=${f.role} onChange=${v => setF({ ...f, role: v || 'admin' })} options=${[{ value: 'admin', label: 'Administrator — Logistics & Transport (full management)' }, { value: 'spc', label: 'SPC — approves trip requests, read-only elsewhere' }]} />
      <//>
    </div>
  <//>`;
}
