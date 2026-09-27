import { html, useState, useEffect } from '../lib.js';
import { t } from '../i18n.js';
import { useStore, logout, loadState } from '../store.js';
import { Icon, LangToggle, Modal, Card, Stat, Status, Alert, Empty, Button,
  fmtDT, fmtShort, timeAgo, duration, money, num, expiryState, mapUrl, byId } from '../ui.js';
import { Columns, HBars, Segments } from '../charts.js';
import { PasswordForm } from './landing.js';
import { initials } from './staff.js';
import { RequestsPage, ApprovalsPage, needsAdmin } from './requests.js';
import { VehiclesPage, DriversPage, TasksPage } from './fleet.js';
import { TripsPage, FuelPage } from './ops.js';
import { StaffPage, UsersPage } from './people.js';
import { ReportsPage } from './reports.js';
import { ActivityPage, EmailsPage, SettingsPage } from './system.js';

const ADMIN_NAV = [
  { group: 'Overview', items: [{ id: 'dashboard', icon: 'dashboard', label: 'dashboard' }, { id: 'requests', icon: 'inbox', label: 'tripRequests', badge: d => d.requests.filter(needsAdmin).length }] },
  { group: 'Fleet', items: [{ id: 'vehicles', icon: 'car', label: 'vehicles' }, { id: 'drivers', icon: 'users', label: 'drivers' }, { id: 'tasks', icon: 'clipboard', label: 'tasks' }] },
  { group: 'Operations', items: [{ id: 'trips', icon: 'route', label: 'trips', badge: d => d.trips.filter(x => x.status === 'inTransit').length, tone: 'amber' }, { id: 'fuel', icon: 'fuel', label: 'Fuel & service' }] },
  { group: 'People', items: [{ id: 'staff', icon: 'qr', label: 'staffQr' }, { id: 'users', icon: 'shield', label: 'User accounts' }] },
  { group: 'Insights', items: [{ id: 'reports', icon: 'chart', label: 'reports' }, { id: 'activity', icon: 'list', label: 'activityLog' }, { id: 'emails', icon: 'mail', label: 'emailLog', badge: d => d.notifications.filter(n => n.status === 'failed').length, tone: 'red' }] },
  { group: 'System', items: [{ id: 'settings', icon: 'sliders', label: 'settings' }] },
];

const SPC_NAV = [
  { group: 'Decisions', items: [{ id: 'approvals', icon: 'shield', label: 'spcDashboard', badge: d => d.requests.filter(r => r.status === 'FORWARDED_TO_SPC').length }, { id: 'requests', icon: 'inbox', label: 'tripRequests' }] },
  { group: 'Overview', items: [{ id: 'dashboard', icon: 'dashboard', label: 'dashboard' }, { id: 'vehicles', icon: 'car', label: 'vehicles' }, { id: 'drivers', icon: 'users', label: 'drivers' }, { id: 'trips', icon: 'route', label: 'trips' }, { id: 'fuel', icon: 'fuel', label: 'Fuel & service' }] },
  { group: 'Insights', items: [{ id: 'reports', icon: 'chart', label: 'reports' }, { id: 'activity', icon: 'list', label: 'activityLog' }] },
];

const PAGES = {
  dashboard: Dashboard, requests: RequestsPage, approvals: ApprovalsPage, vehicles: VehiclesPage, drivers: DriversPage, tasks: TasksPage,
  trips: TripsPage, fuel: FuelPage, staff: StaffPage, users: UsersPage, reports: ReportsPage, activity: ActivityPage, emails: EmailsPage, settings: SettingsPage,
};

export function OfficeApp() {
  const s = useStore();
  const d = s.data;
  const role = d.me.role;
  const nav = role === 'admin' ? ADMIN_NAV : SPC_NAV;
  const allowed = nav.flatMap(g => g.items);
  const current = allowed.find(n => n.id === s.route.page) || allowed[0];
  const [drawer, setDrawer] = useState(false);
  const [account, setAccount] = useState(false);
  useEffect(() => setDrawer(false), [s.route.page]);
  const Page = PAGES[current.id];

  return html`<div class=${'office' + (drawer ? ' drawer-open' : '')}>
    <aside class="sidebar">
      <div class="side-brand"><img src="/logo.png" alt="" class="brand-logo sm" /><div><div class="brand-name sm">SPIN-KN Fleet</div><div class="side-role">${role === 'admin' ? t('logisticsDashboard') : t('spcSuperNote')}</div></div></div>
      <nav class="side-nav">
        ${nav.map(g => html`<div class="side-group"><div class="side-group-lbl">${g.group}</div>
          ${g.items.map(n => {
            const count = n.badge ? n.badge(d) : 0;
            return html`<a href=${'#/' + n.id} class=${'side-link' + (n.id === current.id ? ' on' : '')}><${Icon} name=${n.icon} size=${18} /><span>${t(n.label)}</span>${count ? html`<span class=${'side-badge tone-' + (n.tone || 'brand')}>${count}</span>` : null}</a>`;
          })}
        </div>`)}
      </nav>
      <div class="side-foot">
        <button type="button" class="side-user" onClick=${() => setAccount(true)}><span class="avatar sm">${initials(d.me.name)}</span><span class="grow"><b>${d.me.name}</b><span class="xsmall">${d.me.email}</span></span><${Icon} name="key" size=${15} /></button>
      </div>
    </aside>
    <div class="scrim" onClick=${() => setDrawer(false)} />
    <div class="office-main">
      <header class="topbar">
        <button type="button" class="icon-btn menu-btn" onClick=${() => setDrawer(true)} aria-label="Menu"><${Icon} name="menu" /></button>
        <div class="topbar-title">${t(current.label)}</div>
        <div class="row gap-sm">
          <span class="sync-note xsmall muted" title="Refreshes every 20 seconds">${s.lastSync ? 'Updated ' + s.lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          <button type="button" class="icon-btn" onClick=${() => loadState()} aria-label=${t('refresh')}><${Icon} name="refresh" size=${17} /></button>
          <${LangToggle} compact />
          <button type="button" class="btn btn-ghost btn-sm" onClick=${logout}><${Icon} name="logout" size=${16} /><span class="hide-sm">${t('logout')}</span></button>
        </div>
      </header>
      <main class="office-content"><${Page} d=${d} id=${s.route.id} role=${role} /></main>
    </div>
    ${account ? html`<${Modal} title=${t('account')} onClose=${() => setAccount(false)} size="sm">
      <p class="small"><b>${d.me.name}</b><br /><span class="muted">${d.me.email} · ${d.me.role.toUpperCase()}</span></p>
      <h4 class="mt">${t('changePassword')}</h4>
      <${PasswordForm} onDone=${() => setAccount(false)} />
    <//>` : null}
  </div>`;
}

export function PageHead({ title, sub, actions }) {
  return html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : null}</div>${actions ? html`<div class="row gap-sm wrap">${actions}</div>` : null}</div>`;
}

// ---------------------------------------------------------------- dashboard

// Everything that needs attention across the fleet, most urgent first.
export function fleetAlerts(d) {
  const out = [];
  const warn = d.settings.expiryWarnDays;
  for (const dr of d.drivers) {
    if (dr.account !== 'active') continue;
    const e = expiryState(dr.licenceExpiry, warn);
    if (e.key === 'expired') out.push({ tone: 'red', icon: 'user', text: `${dr.name}: driving licence expired ${Math.abs(e.days)} day(s) ago`, go: 'drivers' });
    else if (e.key === 'expiring') out.push({ tone: 'amber', icon: 'user', text: `${dr.name}: driving licence expires in ${e.days} day(s)`, go: 'drivers' });
  }
  for (const v of d.vehicles) {
    if (v.status === 'outOfService') continue;
    if (v.serviceState === 'due') out.push({ tone: 'red', icon: 'wrench', text: `${v.reg}: service due (${num(v.kmSinceService)} km since last service)`, go: 'vehicles' });
    else if (v.serviceState === 'soon') out.push({ tone: 'amber', icon: 'wrench', text: `${v.reg}: service due soon (${num(v.kmSinceService)} km)`, go: 'vehicles' });
    for (const [k, lbl] of [['insuranceExpiry', 'insurance'], ['roadworthinessExpiry', 'roadworthiness']]) {
      const e = expiryState(v[k], warn);
      if (e.key === 'expired') out.push({ tone: 'red', icon: 'car', text: `${v.reg}: ${lbl} expired`, go: 'vehicles' });
      else if (e.key === 'expiring') out.push({ tone: 'amber', icon: 'car', text: `${v.reg}: ${lbl} expires in ${e.days} day(s)`, go: 'vehicles' });
    }
  }
  for (const tr of d.trips) {
    if (tr.status === 'inTransit' && Date.now() - new Date(tr.startTs) > 14 * 3600e3) {
      const v = byId(d.vehicles, tr.vehicleId), dr = byId(d.drivers, tr.driverId);
      out.push({ tone: 'amber', icon: 'clock', text: `${v ? v.reg : 'Trip'} (${dr ? dr.name : ''}) has been on the road for ${duration(tr.startTs)}`, go: 'trips' });
    }
  }
  const soon = Date.now() + 2 * 3600e3;
  for (const tk of d.tasks) {
    if (tk.status === 'scheduled' && !tk.acknowledged && new Date(tk.scheduledTs) < soon) {
      const dr = byId(d.drivers, tk.driverId);
      out.push({ tone: new Date(tk.scheduledTs) < Date.now() ? 'red' : 'amber', icon: 'clipboard', text: `${dr ? dr.name : 'Driver'} has not acknowledged "${tk.purpose}" (${fmtShort(tk.scheduledTs)})`, go: 'tasks' });
    }
  }
  const failed = d.notifications.filter(n => n.status === 'failed').length;
  if (failed && d.me.role === 'admin') out.push({ tone: 'red', icon: 'mail', text: `${failed} email notification(s) failed to send`, go: 'emails' });
  return out.sort((a, b) => (a.tone === 'red' ? 0 : 1) - (b.tone === 'red' ? 0 : 1));
}

function Dashboard({ d, role }) {
  const vs = d.vehicles;
  const cnt = st => vs.filter(v => v.status === st).length;
  const active = d.trips.filter(x => x.status === 'inTransit');
  const pending = role === 'admin' ? d.requests.filter(needsAdmin) : d.requests.filter(r => r.status === 'FORWARDED_TO_SPC');
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const fuelMonth = d.fuel.filter(f => new Date(f.ts) >= monthStart);
  const fuelCost = fuelMonth.reduce((s, f) => s + f.cost, 0);
  const alerts = fleetAlerts(d);

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - i);
    const next = new Date(day); next.setDate(day.getDate() + 1);
    days.push({ label: day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', ' '), value: d.trips.filter(x => { const s = new Date(x.startTs); return s >= day && s < next; }).length });
  }
  const byVehicle = vs.map(v => ({ label: v.reg, sub: v.model, value: fuelMonth.filter(f => f.vehicleId === v.id).reduce((s, f) => s + f.cost, 0) })).filter(x => x.value).sort((a, b) => b.value - a.value);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return html`<div class="stack-lg">
    <${PageHead} title=${t('dashboard')} sub=${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
    <div class="stats">
      <${Stat} icon="car" tone="brand" label=${t('totalVehicles')} value=${vs.length} sub=${`${cnt('available') + cnt('assigned')} ready · ${cnt('maintenance')} in maintenance`} onClick=${() => (location.hash = '#/vehicles')} />
      <${Stat} icon="route" tone="amber" label=${t('activeTrips')} value=${active.length} sub=${`${d.trips.filter(x => new Date(x.startTs) >= today).length} ${t('todaysTrips').toLowerCase()}`} onClick=${() => (location.hash = '#/trips')} />
      <${Stat} icon="inbox" tone="violet" label=${role === 'admin' ? 'Requests to action' : t('pending')} value=${pending.length} sub=${`${d.requests.filter(r => r.priority === 'urgent' && pending.includes(r)).length} urgent`} onClick=${() => (location.hash = role === 'admin' ? '#/requests' : '#/approvals')} />
      <${Stat} icon="fuel" tone="sky" label=${t('fuelCost') + ' · ' + new Date().toLocaleDateString('en-GB', { month: 'short' })} value=${money(fuelCost)} sub=${num(fuelMonth.reduce((s, f) => s + f.litres, 0)) + ' L'} onClick=${() => (location.hash = '#/fuel')} />
    </div>

    <div class="grid-main">
      <div class="stack-lg">
        <${Card} title=${t('vehicleStatus')} icon="car">
          <${Segments} parts=${[
            { label: t('st_available'), value: cnt('available'), tone: 'green' }, { label: t('st_assigned'), value: cnt('assigned'), tone: 'sky' },
            { label: t('st_inTransit'), value: cnt('inTransit'), tone: 'amber' }, { label: t('st_maintenance'), value: cnt('maintenance'), tone: 'violet' },
            { label: t('st_outOfService'), value: cnt('outOfService'), tone: 'red' }]} />
        <//>
        <${Card} title="Trips — last 14 days" icon="chart"><${Columns} data=${days} /><//>
        <${Card} title=${t('activeTrips')} icon="navigation" pad=${false}>
          ${active.length ? html`<div class="list-card flat">${active.map(tr => {
            const v = byId(d.vehicles, tr.vehicleId), dr = byId(d.drivers, tr.driverId), tk = byId(d.tasks, tr.taskId);
            const u = mapUrl(tr.startLat, tr.startLng);
            return html`<div class="list-row">
              <div class="row gap-sm"><span class=${'live-dot' + (tr.paused ? ' stopped' : '')} /><div><b>${v ? v.reg : ''}</b> · ${dr ? dr.name : ''}<div class="xsmall muted">${tk ? tk.purpose + ' → ' + tk.destination : 'Ad-hoc trip'} · ${t('startTime')} ${fmtShort(tr.startTs)} · ${duration(tr.startTs)}${tr.stops.length ? ' · ' + tr.stops.length + ' ' + (tr.stops.length === 1 ? 'stop' : 'stops') : ''}</div></div></div>
              <div class="row gap-xs">${tr.paused ? html`<${Status} status="stopped" />` : html`<span class="badge tone-amber">${t('moving')}</span>`}${u ? html`<a class="icon-btn" href=${u} target="_blank" rel="noopener" title=${t('viewMap')}><${Icon} name="pin" size=${16} /></a>` : null}</div>
            </div>`;
          })}</div>` : html`<${Empty} icon="route" text="No vehicles on the road right now." />`}
        <//>
      </div>
      <div class="stack-lg">
        <${Card} title=${t('alerts')} icon="alert" sub=${alerts.length ? alerts.length + ' item(s)' : null} pad=${false}>
          ${alerts.length ? html`<div class="alert-list">${alerts.slice(0, 12).map(a => html`<a href=${'#/' + a.go} class=${'alert-row tone-' + a.tone}><${Icon} name=${a.icon} size=${15} /><span>${a.text}</span></a>`)}</div>`
            : html`<${Empty} icon="checkCircle" text="Nothing needs attention." />`}
        <//>
        <${Card} title=${t('fuelByVehicle')} sub="This month" icon="fuel"><${HBars} data=${byVehicle} format=${money} empty=${t('empty_fuel')} /><//>
        <${Card} title=${t('recentActivity')} icon="list" actions=${html`<a class="link small" href="#/activity">${t('viewAll')}</a>`} pad=${false}>
          <div class="list-card flat">${d.logs.slice(0, 8).map(l => html`<div class="list-row"><div><b class="small">${l.action}</b><div class="xsmall muted">${l.userName}${l.detail ? ' · ' + l.detail : ''}</div></div><span class="xsmall muted nowrap">${timeAgo(l.ts)}</span></div>`)}</div>
        <//>
      </div>
    </div>
  </div>`;
}
