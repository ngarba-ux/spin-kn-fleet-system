// QR codes and printable staff ID cards. Uses the vendored qrcode-generator
// (window.qrcode, loaded in index.html) so it works without internet.

declare global {
  interface Window {
    qrcode?: (type: number, level: string) => {
      addData(s: string): void;
      make(): void;
      createSvgTag(o: { cellSize: number; margin: number; scalable: boolean }): string;
    };
  }
}

export function qrSvg(text: string, color = '#065f46'): string {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace(/fill="(black|#000000)"/g, `fill="${color}"`);
}

// The link encoded on a staff card. Uses the configured public address so
// cards keep working if the app moves to a custom domain.
export function qrLink(token: string, publicBaseUrl?: string | null): string {
  return (publicBaseUrl || location.origin).replace(/\/+$/, '') + '/#s=' + token;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);

export interface CardStaff {
  fullName: string;
  designation?: string | null;
  unitCode?: string | null;
  unit?: string | null;
  employeeNo?: string | null;
  staffNo: string;
  token: string;
}

function cardHtml(s: CardStaff, base?: string | null): string {
  return `<div class="qr-card">
    <div class="qr-card-hd"><img src="/logo.png" alt="" /><div><div class="t1">SPIN KN FLEET MANAGEMENT</div><div class="t2">Staff Trip Request — Official ID QR</div></div></div>
    <div class="qr-card-bd">
      <div class="qr-card-code">${qrSvg(qrLink(s.token, base))}<div class="tok">${esc(s.token)}</div></div>
      <div class="qr-card-meta"><div class="nm">${esc(s.fullName)}</div><div>${esc(s.designation)}</div><div>${esc(s.unitCode)} — ${esc(s.unit)}</div><div>Ref: ${esc(s.employeeNo || s.staffNo)}</div></div>
    </div>
    <div class="qr-card-ft">Scan with your phone camera to request an official vehicle.</div>
  </div>`;
}

// Prints in the current page (no pop-up to block), then restores it.
export function printCards(list: CardStaff[], base?: string | null) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  const el = root;
  el.innerHTML = `<div class="qr-sheet">${list.map(s => cardHtml(s, base)).join('')}</div>`;
  const title = document.title;
  document.title = 'SPIN KN Fleet — Staff QR Cards';
  document.body.classList.add('print-mode');
  const done = () => {
    document.body.classList.remove('print-mode');
    el.innerHTML = '';
    document.title = title;
    removeEventListener('afterprint', done);
  };
  addEventListener('afterprint', done);
  setTimeout(() => print(), 50);
}
