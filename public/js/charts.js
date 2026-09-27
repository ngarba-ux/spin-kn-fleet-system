import { html } from './lib.js';
import { num } from './ui.js';

// Column chart: data = [{label, value}]
export function Columns({ data, height = 170, format = num, tone = 'brand' }) {
  const max = Math.max(1, ...data.map(d => d.value || 0));
  return html`<div class="columns" style=${{ height: height + 'px' }}>
    ${data.map(d => html`<div class="col" title=${d.label + ': ' + format(d.value)}>
      <span class="col-val">${d.value ? format(d.value) : ''}</span>
      <div class="col-track"><div class=${'col-bar tone-' + tone} style=${{ height: ((d.value || 0) / max) * 100 + '%' }} /></div>
      <span class="col-lbl">${d.label}</span>
    </div>`)}
  </div>`;
}

// Horizontal bars with labels: data = [{label, value, sub}]
export function HBars({ data, format = num, tone = 'brand', empty }) {
  const max = Math.max(1, ...data.map(d => d.value || 0));
  if (!data.length) return html`<p class="muted small">${empty || '—'}</p>`;
  return html`<div class="hbars">
    ${data.map(d => html`<div class="hbar">
      <div class="hbar-top"><span class="hbar-lbl">${d.label}${d.sub ? html` <span class="muted">${d.sub}</span>` : null}</span><span class="hbar-val">${format(d.value)}</span></div>
      <div class="hbar-track"><div class=${'hbar-fill tone-' + tone} style=${{ width: ((d.value || 0) / max) * 100 + '%' }} /></div>
    </div>`)}
  </div>`;
}

// Stacked segment bar for status mixes: parts = [{label, value, tone}]
export function Segments({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return html`<div>
    <div class="segments">${parts.filter(p => p.value).map(p => html`<div class=${'seg tone-' + p.tone} style=${{ width: (p.value / total) * 100 + '%' }} title=${p.label + ': ' + p.value} />`)}</div>
    <div class="seg-legend">${parts.map(p => html`<span><i class=${'tone-' + p.tone} />${p.label} <b>${p.value}</b></span>`)}</div>
  </div>`;
}
