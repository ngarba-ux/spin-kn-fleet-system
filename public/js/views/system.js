import { html, useState } from '../lib.js';
import { t } from '../i18n.js';
import { act, ask } from '../store.js';
import { Button, Field, Icon, Status, Alert, Modal, Empty, Tabs, SearchBox, Select, Card, KV,
  fmtDT, fmtShort, num, sortBy, bind, downloadCsv } from '../ui.js';
import { PageHead } from './office.js';

// ================================================================ activity log

export function ActivityPage({ d }) {
  const [q, setQ] = useState('');
  const [user, setUser] = useState('');
  const users = [...new Set(d.logs.map(l => l.userName))].sort();
  const rows = d.logs.filter(l => (!user || l.userName === user) && (!q || (l.action + ' ' + l.detail).toLowerCase().includes(q.toLowerCase())));
  const exportCsv = () => downloadCsv('activity-log.csv', [['Time', 'User', 'Action', 'Detail'], ...rows.map(l => [fmtDT(l.ts), l.userName, l.action, l.detail])]);
  return html`<div class="stack">
    <${PageHead} title=${t('activityLog')} sub="Every change made in the system, newest first (latest 600 shown)." actions=${html`<${Button} variant="secondary" icon="download" onClick=${exportCsv}>${t('exportCsv')}<//>`} />
    <div class="toolbar"><${Select} value=${user} onChange=${v => setUser(v || '')} placeholder="All users" options=${users} /><${SearchBox} value=${q} onInput=${setQ} /></div>
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table compact">
        <thead><tr><th>${t('time')}</th><th>${t('user')}</th><th>${t('action')}</th><th>${t('related')}</th></tr></thead>
        <tbody>${rows.map(l => html`<tr><td class="nowrap small">${fmtShort(l.ts)}</td><td class="small">${l.userName}</td><td><b class="small">${l.action}</b></td><td class="small">${l.detail}</td></tr>`)}</tbody>
      </table></div>` : html`<${Empty} icon="list" text=${t('empty_logs')} />`}
    <//>
  </div>`;
}

// ================================================================ email log

export function EmailsPage({ d }) {
  const [tab, setTab] = useState('all');
  const [view, setView] = useState(null);
  const tabs = [{ value: 'all', label: 'All', fn: () => true }, { value: 'failed', label: 'Failed', fn: n => n.status === 'failed' }, { value: 'queued', label: 'Queued', fn: n => n.status === 'queued' || n.status === 'sending' }, { value: 'sent', label: 'Sent', fn: n => n.status === 'sent' }];
  const g = tabs.find(x => x.value === tab);
  const rows = d.notifications.filter(g.fn);
  const test = async () => {
    const to = await ask({ title: 'Send a test email', input: { label: 'Send to', value: d.me.email, required: true }, confirmLabel: 'Send' });
    if (to) act('smtp.test', { to }, 'Test email queued — check the list below in a few seconds.');
  };
  return html`<div class="stack">
    <${PageHead} title=${t('emailLog')} sub="Emails sent to staff about their trip requests, and to the office about new requests."
      actions=${d.smtpConfigured ? html`<${Button} variant="secondary" icon="send" onClick=${test}>Send test email<//>` : null} />
    ${d.smtpConfigured ? null : html`<${Alert} tone="amber" icon="mail" title="Email sending is not configured">
      Notifications are recorded here but not sent. To send real emails, fill in the <code>smtp</code> section of <code>server/config.json</code>
      (host, port, user, password, from) with your mail provider's details and restart the server. Messages recorded while email was off can then be re-sent.
    <//>`}
    <${Tabs} value=${tab} onChange=${setTab} items=${tabs.map(x => ({ value: x.value, label: x.label, count: d.notifications.filter(x.fn).length }))} />
    <${Card} pad=${false}>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>${t('time')}</th><th>To</th><th>Subject</th><th>${t('status')}</th><th></th></tr></thead>
        <tbody>${rows.map(n => html`<tr>
          <td class="nowrap small">${fmtShort(n.ts)}</td>
          <td class="small">${n.toName || ''}<div class="xsmall muted">${n.to || '—'}</div></td>
          <td class="small">${n.subject}${n.error && n.status !== 'sent' ? html`<div class="xsmall tone-text-red">${n.error}</div>` : null}</td>
          <td><${Status} status=${n.status} />${n.attempts > 1 ? html`<div class="xsmall muted">${n.attempts} attempts</div>` : null}</td>
          <td class="actions">
            <${Button} size="sm" variant="ghost" icon="eye" title=${t('view')} onClick=${() => setView(n)} />
            ${d.smtpConfigured && n.status !== 'sent' && n.status !== 'sending' && n.to ? html`<${Button} size="sm" variant="ghost" icon="refresh" title=${t('resend')} onClick=${() => act('notification.resend', { id: n.id }, t('resent'))} />` : null}
          </td>
        </tr>`)}</tbody></table></div>` : html`<${Empty} icon="mail" text="No emails yet." />`}
    <//>
    ${view ? html`<${Modal} title=${view.subject} sub=${'To: ' + (view.to || '—')} onClose=${() => setView(null)}><pre class="email-body">${view.body}</pre><//>` : null}
  </div>`;
}

// ================================================================ settings

export function SettingsPage({ d }) {
  const s = d.settings;
  const [f, setF] = useState({
    orgName: s.orgName, publicBaseUrl: s.publicBaseUrl || '', serviceIntervalKm: s.serviceIntervalKm, expiryWarnDays: s.expiryWarnDays,
    defaultOrigin: s.defaultOrigin, components: (s.components || []).join('\n'), vehicleTypes: (s.vehicleTypes || []).join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const b = k => bind(f, setF, k);
  const here = location.origin;
  const save = async () => {
    setBusy(true);
    await act('settings.save', {
      ...f, components: f.components.split('\n').map(x => x.trim()).filter(Boolean), vehicleTypes: f.vehicleTypes.split('\n').map(x => x.trim()).filter(Boolean),
    }, t('saved'));
    setBusy(false);
  };
  const clearDemo = async () => {
    const ok = await ask({ title: 'Remove demo records?', body: 'Deletes the sample drivers (and their sign-in accounts), sample vehicles, tasks, trips, fuel records and the sample trip request. Staff, office users and anything you created are kept. This cannot be undone.', confirmLabel: 'Remove demo records', tone: 'danger' });
    if (ok) act('demo.clear', {}, 'Demo records removed');
  };
  const localBase = /\/\/(localhost|127\.)/.test(f.publicBaseUrl || here);

  return html`<div class="stack-lg">
    <${PageHead} title=${t('settings')} actions=${html`<${Button} icon="check" busy=${busy} onClick=${save}>${t('save')}<//>`} />
    <div class="grid-2 gap-lg align-start">
      <${Card} title="Network address" icon="globe" sub="Used in staff QR codes and in links inside emails.">
        <div class="stack">
          <${Field} label="Public address" hint=${`The address phones on the office network use to reach this server. You are connected via ${here}.`}>
            <div class="input-group"><input class="input" placeholder="http://192.168.1.10:3000" ...${b('publicBaseUrl')} /><${Button} variant="secondary" size="sm" onClick=${() => setF({ ...f, publicBaseUrl: here })}>Use ${here.replace(/^https?:\/\//, '')}<//></div>
          <//>
          ${localBase ? html`<${Alert} tone="amber">“localhost” only works on this computer. Open the app from another device using the network address shown in the server window, then click “Use …” above.<//>` : null}
          <p class="xsmall muted">Changing this after cards are printed breaks the printed cards; reprint them from Staff & QR.</p>
        </div>
      <//>
      <${Card} title=${t('systemPrefs')} icon="sliders">
        <div class="stack">
          <${Field} label=${t('projectName')}><input class="input" ...${b('orgName')} /><//>
          <div class="grid-2">
            <${Field} label="Service interval (km)" hint="Default for vehicles without their own."><input class="input" type="number" min="100" ...${b('serviceIntervalKm')} /><//>
            <${Field} label="Expiry warning (days)" hint="Licence, insurance, roadworthiness."><input class="input" type="number" min="1" max="365" ...${b('expiryWarnDays')} /><//>
          </div>
          <${Field} label="Default trip origin" hint="Used for tasks created from trip requests."><input class="input" ...${b('defaultOrigin')} /><//>
        </div>
      <//>
      <${Card} title="Trip request form" icon="clipboard" sub="Options staff choose from. One per line.">
        <div class="grid-2">
          <${Field} label=${t('drivingComponent')}><textarea class="input" rows="6" ...${b('components')} /><//>
          <${Field} label=${t('vehicleRequirement')}><textarea class="input" rows="6" ...${b('vehicleTypes')} /><//>
        </div>
      <//>
      <${Card} title="Data" icon="database">
        <div class="stack">
          <${KV} items=${[['Email', d.smtpConfigured ? 'Configured' : 'Not configured (see Email log)'], ['Server time', fmtDT(d.serverTime)], ['Automatic backups', 'Daily, last 30 days kept in data\\backups']]} />
          <div class="row gap-sm wrap">
            <a class="btn btn-secondary" href="/api/backup" download><${Icon} name="download" size=${17} /><span>Download full backup</span></a>
            ${d.hasDemo ? html`<${Button} variant="ghost-danger" icon="trash" onClick=${clearDemo}>Remove demo records<//>` : null}
          </div>
          <p class="xsmall muted">The backup contains every record including password hashes — store it somewhere safe.</p>
        </div>
      <//>
    </div>
  </div>`;
}
