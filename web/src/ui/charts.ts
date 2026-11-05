// Small SVG chart builders. The SVG is drawn at the container's own pixel width, so axis text keeps its
// size on a phone, and stays sharp when screenshots go into the paper.

import type { ForecastPoint, Snapshot, TwinEvent } from '../twin/twin.ts';

export interface Overlay {
  label: string;
  points: ForecastPoint[];
  className: string;
}

interface Frame {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// One clock format for the whole page (chart ticks, forecast text, what-if labels), following the locale's
// 12- or 24-hour convention.
const H12 = new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hourCycle?.startsWith('h1') ?? false;

/** Clock time, e.g. "21:40" or "9:40 PM". */
export function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString([], H12 ? { hour: 'numeric', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Short hour label for axis ticks, e.g. "21:00" or "9 PM". */
export function fmtHour(t: number): string {
  return H12 ? new Date(t).toLocaleTimeString([], { hour: 'numeric' }) : `${String(new Date(t).getHours()).padStart(2, '0')}:00`;
}

function sx(f: Frame, t: number) {
  return f.left + ((t - f.t0) / (f.t1 - f.t0)) * (f.w - f.left - f.right);
}
function sy(f: Frame, v: number) {
  return f.h - f.bottom - ((v - f.y0) / (f.y1 - f.y0)) * (f.h - f.top - f.bottom);
}
function path(f: Frame, pts: { t: number; v: number }[]) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${sx(f, p.t).toFixed(1)},${sy(f, p.v).toFixed(1)}`).join('');
}
function band(f: Frame, pts: { t: number; lo: number; hi: number }[]) {
  if (!pts.length) return '';
  const up = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(f, p.t).toFixed(1)},${sy(f, p.hi).toFixed(1)}`).join('');
  const down = [...pts].reverse().map((p) => `L${sx(f, p.t).toFixed(1)},${sy(f, p.lo).toFixed(1)}`).join('');
  return `${up}${down}Z`;
}
function hourTicks(f: Frame) {
  const out: string[] = [];
  const start = new Date(f.t0);
  start.setMinutes(0, 0, 0);
  // at least about 52 px between labels, whatever the width
  const pxPerHour = (f.w - f.left - f.right) / ((f.t1 - f.t0) / 3_600_000);
  const every = [1, 2, 3, 4, 6, 8].find((e) => e * pxPerHour >= (H12 ? 64 : 56)) ?? 12;
  for (let t = start.getTime(); t <= f.t1; t += 3_600_000) {
    const d = new Date(t);
    if (t < f.t0 || d.getHours() % every) continue;
    const x = sx(f, t);
    out.push(`<line class="grid" x1="${x}" x2="${x}" y1="${f.top}" y2="${f.h - f.bottom}"/>`);
    out.push(`<text class="tick" x="${x}" y="${f.h - f.bottom + 15}" text-anchor="middle">${fmtHour(t)}</text>`);
  }
  return out.join('');
}

/** Shaded future (forecast) region and the "now" line. */
function nowAndFuture(f: Frame, now: number, label: boolean) {
  const nx = sx(f, now);
  const right = f.w - f.right;
  const parts = [`<rect class="future" x="${nx}" y="${f.top}" width="${Math.max(0, right - nx)}" height="${f.h - f.top - f.bottom}"/>`];
  parts.push(`<line class="now" x1="${nx}" x2="${nx}" y1="${f.top}" y2="${f.h - f.bottom}"/>`);
  if (label) {
    parts.push(`<text class="now-label" x="${nx - 4}" y="${f.top - 8}" text-anchor="end">now</text>`);
    if (right - nx > 70) parts.push(`<text class="future-label" x="${nx + 6}" y="${f.top - 8}">forecast →</text>`);
  }
  return parts.join('');
}

const Z90 = 1.645;

export function kssChart(opts: {
  snapshots: Snapshot[];
  forecast: ForecastPoint[];
  overlays: Overlay[];
  events: TwinEvent[];
  now: number;
  t0: number;
  t1: number;
  width?: number;
  label?: string;
}): string {
  const w = Math.max(280, Math.round(opts.width ?? 760));
  const narrow = w < 520;
  const f: Frame = { w, h: narrow ? 240 : 290, left: 30, right: 10, top: 26, bottom: 28, t0: opts.t0, t1: opts.t1, y0: 1, y1: 9 };
  const snaps = opts.snapshots.filter((s) => s.t >= f.t0 && s.t <= f.t1);
  const parts: string[] = [];
  parts.push(`<rect class="zone-sleepy" x="${f.left}" y="${sy(f, 9)}" width="${f.w - f.left - f.right}" height="${sy(f, 7) - sy(f, 9)}"/>`);
  parts.push(nowAndFuture(f, opts.now, true));
  for (let k = 1; k <= 9; k += narrow ? 2 : 1) {
    parts.push(`<line class="grid${k % 2 ? '' : ' minor'}" x1="${f.left}" x2="${f.w - f.right}" y1="${sy(f, k)}" y2="${sy(f, k)}"/>`);
    parts.push(`<text class="tick" x="${f.left - 6}" y="${sy(f, k) + 4}" text-anchor="end">${k}</text>`);
  }
  parts.push(`<text class="axis-title" x="${f.left - 6}" y="${f.top - 9}" text-anchor="end">KSS</text>`);
  parts.push(`<text class="zone-label" x="${f.left + 6}" y="${sy(f, 9) + 13}">sleepy (KSS ≥ 7)</text>`);
  parts.push(hourTicks(f));
  // asleep periods of a what-if scenario
  for (const o of opts.overlays) {
    const asleep = o.points.filter((p) => p.asleep && p.t <= f.t1);
    if (!asleep.length) continue;
    const a = sx(f, asleep[0].t);
    const b = sx(f, Math.min(f.t1, asleep[asleep.length - 1].t));
    parts.push(`<rect class="asleep-zone" x="${a}" y="${f.top}" width="${Math.max(1, b - a)}" height="${f.h - f.top - f.bottom}"/>`);
    if (b - a > 44) parts.push(`<text class="asleep-label" x="${(a + b) / 2}" y="${sy(f, 2)}" text-anchor="middle">asleep</text>`);
  }
  parts.push(`<path class="band" d="${band(f, snaps.map((s) => ({ t: s.t, lo: Math.max(1, s.kss - Z90 * s.kssSd), hi: Math.min(9, s.kss + Z90 * s.kssSd) })))}"/>`);
  parts.push(`<path class="prior" d="${path(f, snaps.map((s) => ({ t: s.t, v: s.prior })))}"/>`);
  const fc = opts.forecast.filter((p) => !p.asleep && p.t <= f.t1);
  parts.push(`<path class="band forecast-band" d="${band(f, fc.map((p) => ({ t: p.t, lo: Math.max(1, p.kss - Z90 * p.kssSd), hi: Math.min(9, p.kss + Z90 * p.kssSd) })))}"/>`);
  parts.push(`<path class="twin" d="${path(f, snaps.map((s) => ({ t: s.t, v: s.kss })))}"/>`);
  parts.push(`<path class="forecast" d="${path(f, fc.map((p) => ({ t: p.t, v: p.kss })))}"/>`);
  for (const o of opts.overlays) {
    const segs: { t: number; v: number }[][] = [[]];
    for (const p of o.points.filter((q) => q.t <= f.t1)) {
      if (p.asleep) {
        if (segs[segs.length - 1].length) segs.push([]);
        continue;
      }
      segs[segs.length - 1].push({ t: p.t, v: p.kss });
    }
    for (const s of segs) if (s.length > 1) parts.push(`<path class="overlay ${o.className}" d="${path(f, s)}"><title>${esc(o.label)}</title></path>`);
  }
  const cams = opts.events.filter((e) => e.type === 'cam' && e.t >= f.t0 && e.t <= f.t1);
  for (const c of cams) parts.push(`<rect class="cam-mark" x="${sx(f, c.t - 60_000)}" y="${f.h - f.bottom + 1}" width="${Math.max(1, sx(f, c.t) - sx(f, c.t - 60_000))}" height="3"/>`);
  for (const e of opts.events) {
    if (e.t < f.t0 || e.t > f.t1) continue;
    if (e.type === 'kss') parts.push(`<circle class="checkin" cx="${sx(f, e.t)}" cy="${sy(f, e.value)}" r="5"><title>Check-in ${fmtClock(e.t)}: KSS ${e.value}</title></circle>`);
    if (e.type === 'pvt') {
      const x = sx(f, e.t);
      const y = f.h - f.bottom - 4;
      parts.push(`<path class="pvt-mark${e.durationS !== undefined && e.durationS < 180 ? ' short' : ''}" d="M${x - 5},${y} L${x + 5},${y} L${x},${y - 9}Z"><title>Reaction test ${fmtClock(e.t)}: median ${Math.round(e.medianRt)} ms, ${e.lapses} lapses${e.durationS !== undefined && e.durationS < 180 ? ' (1-minute test, not used by the twin)' : ''}</title></path>`);
    }
  }
  return `<svg viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" role="img" aria-label="${esc(opts.label ?? 'Sleepiness timeline')}">${parts.join('')}</svg>`;
}

export function workloadChart(opts: { snapshots: Snapshot[]; events: TwinEvent[]; now: number; t0: number; t1: number; width?: number; label?: string }): string {
  const w = Math.max(280, Math.round(opts.width ?? 760));
  const f: Frame = { w, h: w < 520 ? 140 : 160, left: 30, right: 10, top: 26, bottom: 28, t0: opts.t0, t1: opts.t1, y0: 0, y1: 100 };
  const snaps = opts.snapshots.filter((s) => s.t >= f.t0 && s.t <= f.t1);
  const parts: string[] = [];
  parts.push(nowAndFuture(f, opts.now, false));
  for (const v of [0, 50, 100]) {
    parts.push(`<line class="grid" x1="${f.left}" x2="${f.w - f.right}" y1="${sy(f, v)}" y2="${sy(f, v)}"/>`);
    parts.push(`<text class="tick" x="${f.left - 6}" y="${sy(f, v) + 4}" text-anchor="end">${v}</text>`);
  }
  parts.push(`<text class="axis-title" x="${f.left - 6}" y="${f.top - 9}" text-anchor="end">TLX</text>`);
  parts.push(hourTicks(f));
  parts.push(`<path class="band load-band" d="${band(f, snaps.map((s) => ({ t: s.t, lo: Math.max(0, s.workload - Z90 * s.workloadSd), hi: Math.min(100, s.workload + Z90 * s.workloadSd) })))}"/>`);
  parts.push(`<path class="load" d="${path(f, snaps.map((s) => ({ t: s.t, v: s.workload })))}"/>`);
  for (const e of opts.events) {
    if (e.type === 'tlx' && e.t >= f.t0 && e.t <= f.t1) parts.push(`<circle class="tlx" cx="${sx(f, e.t)}" cy="${sy(f, e.value)}" r="4.5"><title>NASA-TLX ${fmtClock(e.t)}: ${Math.round(e.value)}</title></circle>`);
  }
  return `<svg viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" role="img" aria-label="${esc(opts.label ?? 'Workload timeline')}">${parts.join('')}</svg>`;
}
