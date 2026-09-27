import { html, useState, useEffect, useRef } from '../lib.js';
import { t } from '../i18n.js';
import { login, logout, act, toast, store, useStore } from '../store.js';
import { Button, Field, Icon, LangToggle, Alert } from '../ui.js';

export function Landing() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async e => {
    e.preventDefault();
    if (!email.trim() || !password) { setErr(t('v_required')); return; }
    setBusy(true); setErr('');
    try { await login(email.trim(), password); location.hash = ''; }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return html`<div class="landing">
    <aside class="landing-brand">
      <div class="brand-row"><img src="/logo.png" alt="SPIN" class="brand-logo" /><div><div class="brand-name">${t('appName')}</div><div class="brand-sub">${t('subtitle')}</div></div></div>
      <div class="landing-hero">
        <h1>Official vehicles, requests and trips — in one place.</h1>
        <ul>
          <li><${Icon} name="qr" /> Staff request a vehicle by scanning their ID card</li>
          <li><${Icon} name="shield" /> Logistics reviews, the SPC approves, a driver is dispatched</li>
          <li><${Icon} name="navigation" /> Drivers log trips, stops and fuel — even offline</li>
        </ul>
      </div>
      <div class="landing-foot">Sustainable Power and Irrigation for Nigeria · Kano State</div>
    </aside>

    <main class="landing-main">
      <div class="landing-top"><${LangToggle} /></div>
      <div class="landing-cards">
        <form class="card login-card" onSubmit=${submit} novalidate>
          <div class="card-bd">
            <h2>${t('signIn')}</h2>
            <p class="muted">${t('signInSub')}</p>
            ${err ? html`<${Alert} tone="red" icon="xCircle">${err}<//>` : null}
            <${Field} label=${t('email')}>
              <input class="input" type="email" autocomplete="username" value=${email} onInput=${e => setEmail(e.target.value)} autofocus />
            <//>
            <${Field} label=${t('password')}>
              <div class="input-group">
                <input class="input" type=${show ? 'text' : 'password'} autocomplete="current-password" value=${password} onInput=${e => setPassword(e.target.value)} />
                <button type="button" class="icon-btn" onClick=${() => setShow(!show)} aria-label="Show password"><${Icon} name=${show ? 'ban' : 'eye'} size=${16} /></button>
              </div>
            <//>
            <button type="submit" class="btn btn-primary btn-block btn-lg" disabled=${busy}>${busy ? html`<span class="spinner" />` : null}<span>${t('signIn')}</span></button>
          </div>
        </form>

        <${StaffEntry} />
      </div>
    </main>
  </div>`;
}

function StaffEntry() {
  const [token, setToken] = useState('');
  const [scan, setScan] = useState(false);
  const go = tok => { const m = String(tok).match(/(?:[?#&]s=|token[=:])\s*([\w-]+)/i); location.hash = '#s=' + (m ? m[1] : String(tok).trim()); };
  return html`<div class="card staff-card"><div class="card-bd">
    <div class="staff-card-hd"><span class="round-icon"><${Icon} name="qr" size=${22} /></span><div><h3>${t('orStaff')} ${t('staffQrAccess')}</h3><p class="muted small">${t('staffAccessSub')}</p></div></div>
    <p class="small muted">${t('staffCardHint')}</p>
    ${scan ? html`<${Scanner} onResult=${go} onClose=${() => setScan(false)} />` : null}
    <form class="row gap-sm" onSubmit=${e => { e.preventDefault(); if (token.trim()) go(token); }}>
      <input class="input grow" placeholder=${t('tokenPlaceholder')} value=${token} onInput=${e => setToken(e.target.value)} />
      <${Button} variant="secondary" type="submit">${t('resolve')}<//>
    </form>
    ${'BarcodeDetector' in window && !scan ? html`<${Button} variant="ghost" icon="camera" cls="mt-sm" onClick=${() => setScan(true)}>${t('scanQr')}<//>` : null}
  </div></div>`;
}

// In-browser QR scanning where supported (Chrome on Android). Phone camera apps
// open the card link directly, so this is only a convenience.
function Scanner({ onResult, onClose }) {
  const video = useRef();
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream, raf, stopped = false;
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped) return;
          try { const r = await det.detect(video.current); if (r && r[0]) { onResult(r[0].rawValue); return; } } catch {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { setErr(t('cameraUnsupported')); }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(x => x.stop()); };
  }, []);
  return html`<div class="scanner">
    ${err ? html`<p class="field-error">${err}</p>` : html`<video ref=${video} playsinline muted />`}
    <${Button} variant="ghost" size="sm" icon="x" onClick=${onClose}>${t('stopCamera')}<//>
  </div>`;
}

export function PasswordForm({ onDone, forced }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (f.next.length < 8) return setErr(t('pwMin'));
    if (f.next !== f.confirm) return setErr(t('pwMismatch'));
    setBusy(true); setErr('');
    const r = await act('me.password', { current: f.current, next: f.next }, t('pwChanged'));
    setBusy(false);
    if (r.ok) { setF({ current: '', next: '', confirm: '' }); onDone && onDone(); }
  };
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return html`<form onSubmit=${submit} class="stack" novalidate>
    ${err ? html`<${Alert} tone="red" icon="xCircle">${err}<//>` : null}
    <${Field} label=${t('currentPassword')}><input class="input" type="password" autocomplete="current-password" value=${f.current} onInput=${set('current')} /><//>
    <${Field} label=${t('newPassword')} hint=${t('pwMin')}><input class="input" type="password" autocomplete="new-password" value=${f.next} onInput=${set('next')} /><//>
    <${Field} label=${t('confirmPassword')}><input class="input" type="password" autocomplete="new-password" value=${f.confirm} onInput=${set('confirm')} /><//>
    <button type="submit" class=${'btn btn-primary' + (forced ? ' btn-block btn-lg' : '')} disabled=${busy}>${busy ? html`<span class="spinner" />` : null}<span>${t('changePassword')}</span></button>
  </form>`;
}

export function ForcedPasswordChange() {
  const s = useStore();
  return html`<div class="center-page">
    <div class="card narrow"><div class="card-bd">
      <div class="row between"><img src="/logo.png" alt="" class="brand-logo sm" /><${LangToggle} compact /></div>
      <h2>${t('setNewPassword')}</h2>
      <p class="muted">${t('setNewPasswordSub')}</p>
      <p class="small"><strong>${s.data.me.name}</strong> · ${s.data.me.email}</p>
      <${PasswordForm} forced />
      <button type="button" class="link mt" onClick=${logout}>${t('logout')}</button>
    </div></div>
  </div>`;
}
