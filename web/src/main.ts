import './style.css';
import { AlertEngine } from './sensing/alerts.ts';
import { Camera, type LiveSummary } from './sensing/camera.ts';
import { demoDay } from './demo.ts';
import { divergence, type Divergence } from './insights/divergence.ts';
import { sleepStatus, type SleepStatus } from './insights/sleep.ts';
import { suggestCheckIn, type Suggestion } from './insights/suggest.ts';
import { trackRecord, type TrackRecord } from './insights/trackrecord.ts';
import { Store, toCsv } from './store.ts';
import { DEFAULT_CONFIG, forecast, replay, type ChannelId, type ContextId, type Scenario, type TwinEvent, type TwinResult } from './twin/twin.ts';
import { fmtClock, kssChart, workloadChart, type Overlay } from './ui/charts.ts';
import { KSS_LABELS, openCheckIn, runPvt } from './ui/dialogs.ts';
import { openScience } from './ui/science.ts';

const params = new URLSearchParams(location.search);
const THEME_KEY = 'blinktwin.theme';
function applyTheme(theme: string) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  const b = document.querySelector<HTMLButtonElement>('#btn-theme');
  if (b) {
    b.textContent = theme === 'dark' ? 'Light' : 'Dark';
    b.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}
let savedTheme: string | null = null;
try {
  savedTheme = localStorage.getItem(THEME_KEY);
} catch {
  /* storage unavailable */
}
applyTheme(params.get('theme') ?? savedTheme ?? 'light');
const store = new Store();
// the app fills nights the person did not enter with habitual ones (research replays leave this off)
const cfg = { ...DEFAULT_CONFIG, fillMissingNights: true };
const H = 3_600_000;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
let scenario: { key: string; label: string; scenario: Scenario } | null = null;
let live: LiveSummary | null = null;
let lastKss: number | null = null;

const CONTEXTS: [ContextId, string][] = [
  ['focus', 'Focused work'],
  ['reading', 'Reading'],
  ['meeting', 'Meeting'],
  ['other', 'Other task'],
  ['break', 'Break'],
];

const fmtTime = fmtClock;
// the usual work rhythm assumed by the main forecast
const RHYTHM: Scenario = { breaksEveryMinutes: 50, breakMinutes: 10 };
const kssWord = (k: number) => KSS_LABELS[Math.min(8, Math.max(0, Math.round(k) - 1))];
const loadWord = (w: number) => (w < 30 ? 'Light' : w < 55 ? 'Moderate' : w < 75 ? 'High' : 'Very high');

// --- insights: recomputed only when the events or the minute change, not on every redraw ---
let insightCache: { key: string; sleep: SleepStatus; div: Divergence } | null = null;
function insights(events: TwinEvent[], now: number) {
  const key = `${store.isDemo}:${events.length}:${events.at(-1)?.t ?? 0}:${Math.floor(now / 60_000)}`;
  if (insightCache?.key !== key) insightCache = { key, sleep: sleepStatus(events, now, cfg), div: divergence(events, now, cfg) };
  return insightCache;
}

// a check-in suggestion stays up until the person acts on it or dismisses it
const SUGGESTED_KEY = 'blinktwin.lastSuggestedAt';
let nudge: (Suggestion & { shownAt: number }) | null = null;
let demoLastSuggested: number | null = null;
function lastSuggestedAt(): number | null {
  if (store.isDemo) return demoLastSuggested;
  try {
    const v = localStorage.getItem(SUGGESTED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function setLastSuggestedAt(t: number) {
  if (store.isDemo) demoLastSuggested = t;
  else {
    try {
      localStorage.setItem(SUGGESTED_KEY, String(t));
    } catch {
      /* storage unavailable */
    }
  }
}

/** Default wake time of the night that ends inside the 24-h window ending at `to`. */
function nightWake(to: number): number {
  const w = new Date(to);
  w.setHours(cfg.defaultWakeHour, 0, 0, 0);
  if (w.getTime() > to) w.setDate(w.getDate() - 1);
  return w.getTime();
}

/** Bedtime for the what-if: 23:00 today, or in 30 minutes if that has passed. */
function bedTime(now: number): number {
  const bed = new Date(now);
  bed.setHours(23, 0, 0, 0);
  return bed.getTime() < now ? now + 30 * 60_000 : bed.getTime();
}

function compute(): { r: TwinResult; now: number; t0: number } {
  const now = store.now();
  const events = store.all();
  const r0 = replay(events, cfg, { until: now, stepMinutes: 5 });
  const t0 = Math.max(r0.sleep.wake, now - 16 * H);
  return { r: replay(events, cfg, { until: now, from: t0, stepMinutes: 5 }), now, t0 };
}

function render() {
  const { r, now, t0 } = compute();
  const t1 = now + 8 * H;
  // the main forecast assumes the usual rhythm of 50-minute work blocks and 10-minute breaks
  const f = forecast(r, cfg, { hours: 8, stepMinutes: 10, scenario: RHYTHM });
  const overlays: Overlay[] = [];
  let scenarioNote = '';
  if (scenario) {
    const s = forecast(r, cfg, { hours: 8, stepMinutes: 10, scenario: scenario.scenario });
    overlays.push({ label: scenario.label, points: s.points, className: 'what-if' });
    scenarioNote = `<b>What if: ${scenario.label}.</b> ${s.sleepyAt ? `Sleepy (KSS 7) around ${fmtTime(s.sleepyAt)}` : 'Stays below KSS 7 for the next 8 hours'}${
      f.sleepyAt ? `, against ${fmtTime(f.sleepyAt)} with your usual breaks.` : ', as with your usual breaks.'
    }`;
  }

  const events = store.all();
  const assumed = r.sleepAssumption;
  // a warning from the twin's own estimate needs a recorded night, not the default one
  lastKss = assumed.usesDefault ? null : r.now.kss;
  const ins = insights(events, now);
  $('#demo-banner').hidden = !store.isDemo;
  $('#start').hidden = store.isDemo || events.some((e) => e.type === 'kss');
  const lo = Math.max(1, r.now.kss - 1.645 * r.now.kssSd);
  const hi = Math.min(9, r.now.kss + 1.645 * r.now.kssSd);
  $('#now-kss').textContent = r.now.kss.toFixed(1);
  $('#now-kss-sd').textContent = `± ${(1.645 * r.now.kssSd).toFixed(1)}`;
  $('#now-kss-sd').title = `90% range ${lo.toFixed(1)} to ${hi.toFixed(1)}`;
  $('#now-kss-word').textContent = kssWord(r.now.kss);
  $('#now-kss-range').textContent = `90% range ${lo.toFixed(1)} to ${hi.toFixed(1)}`;
  $('#now-load').textContent = String(Math.round(r.now.workload));
  $('#now-load-sd').textContent = `± ${Math.round(1.645 * r.now.workloadSd)}`;
  $('#now-load-word').textContent = `${loadWord(r.now.workload)} workload`;
  $('#forecast-line').innerHTML =
    r.now.kss >= 7
      ? `You are at <b>KSS 7 or above</b> (sleepy) now.`
      : f.sleepyAt
        ? `At this rate you will reach <b>KSS 7</b> (sleepy) around <b>${fmtTime(f.sleepyAt)}</b>.`
        : `KSS 7 (sleepy) is not expected in the next 8 hours.`;
  const inOneHour = f.points.find((p) => p.t >= now + H) ?? f.points[f.points.length - 1];
  $('#forecast-p').textContent = inOneHour ? `Chance of KSS 7 or more one hour from now: ${Math.round(inOneHour.pSleepy * 100)}%.` : '';
  const defaults = $('#defaults-note');
  defaults.hidden = !assumed.usesDefault && assumed.filledNights === 0;
  const noEntry = !events.some((e) => e.type === 'sleep');
  const assumption = assumed.usesDefault
    ? noEntry
      ? `Estimated from a default night (woke ${fmtTime(r.sleep.wake)} after ${cfg.defaultSleepHours} h).`
      : `Your last sleep entry is more than 30 h old, so this uses a default night (woke ${fmtTime(r.sleep.wake)} after ${cfg.defaultSleepHours} h).`
    : `This assumes ${assumed.filledNights} habitual ${assumed.filledNights === 1 ? 'night' : 'nights'} you did not enter.`;
  defaults.innerHTML = `${assumption} <button type="button" class="info-link" data-go="sleep">Enter your sleep</button> for a personal estimate.`;
  renderSleepStatus(ins.sleep, now);
  renderNudge(r, f.sleepyAt, now, ins.div);
  const width = (sel: string) => Math.max(280, $(sel).clientWidth || 760);
  const chartLabel = `Sleepiness from ${fmtTime(t0)} to ${fmtTime(t1)}. Now KSS ${r.now.kss.toFixed(1)}. ${f.sleepyAt ? `Forecast reaches KSS 7 at ${fmtTime(f.sleepyAt)}.` : 'Forecast stays below KSS 7.'}`;
  $('#kss-chart').innerHTML = kssChart({ snapshots: r.snapshots, forecast: f.points, overlays, events, now, t0, t1, width: width('#kss-chart'), label: chartLabel });
  $('#load-chart').innerHTML = workloadChart({ snapshots: r.snapshots, events, now, t0, t1, width: width('#load-chart'), label: `Workload from ${fmtTime(t0)} to now. Now ${Math.round(r.now.workload)} on the NASA-TLX scale.` });
  $('#scenario-note').innerHTML = scenarioNote;
  $('#lg-whatif').hidden = !scenario;
  if (scenario) $('#lg-whatif').textContent = `what-if: ${scenario.label}`;
  $('#bed-time').textContent = fmtTime(bedTime(now));
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => {
    b.classList.toggle('on', b.dataset.scenario === scenario?.key);
    b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario?.key));
  });

  // why: decompose the current estimate
  const rows: [string, number, string][] = [
    ['Daily rhythm model', r.now.prior, 'Three-Process Model: time since waking, time of day, sleep inertia'],
    ['Time on task', r.now.tot, `${(r.now.tot / cfg.totPerHour).toFixed(1)} h since your last long break`],
    ['Your check-ins', r.contributions.kss, `${r.checkIns} KSS rating${r.checkIns === 1 ? '' : 's'}`],
    ['Reaction test', r.contributions.pvt, 'through your personal reaction-time model'],
    ['Eyes (webcam)', r.contributions.cam, 'blink duration and eye closure, through your personal model'],
  ];
  // the rhythm model is the starting point on the 1-9 scale; every other row is a signed shift from it,
  // drawn as a bar to the right (sleepier) or left (more alert) of zero on a common scale
  const scale = Math.max(1, ...rows.slice(1).map(([, v]) => Math.abs(v)));
  $('#why').innerHTML =
    rows
      .map(([name, v, note], i) => {
        const pct = Math.min(50, (Math.abs(v) / scale) * 50);
        const bar =
          i === 0
            ? `<div class="why-bar scale" aria-hidden="true"><span class="base" style="width:${((v - 1) / 8) * 100}%"></span></div>`
            : `<div class="why-bar diverging" aria-hidden="true"><span class="${v >= 0 ? 'up' : 'down'}" style="${v >= 0 ? 'left:50%' : `left:${50 - pct}%`};width:${pct}%"></span></div>`;
        const val = i === 0 ? v.toFixed(2) : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
        return `<div class="why-row"><div class="why-name">${name}<span class="muted small">${note}</span></div>${bar}<div class="why-val">${val}</div></div>`;
      })
      .join('') +
    `<div class="why-row total"><div class="why-name">Twin estimate</div><div class="why-axis small muted" aria-hidden="true"><span>← alert</span><span>sleepy →</span></div><div class="why-val">${r.now.kss.toFixed(1)}</div></div>`;

  // personal calibration: the anchors learned from check-ins
  const certainty = 1 - r.now.offsetSd ** 2 / cfg.offsetPriorSd ** 2;
  const learned = (c: ChannelId) => Math.max(0, Math.round((1 - r.anchors[c].sd ** 2 / cfg.channels[c].biasSd ** 2) * 100));
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const anchorText = (c: ChannelId, unit: string, word: [string, string]) => {
    const a = r.anchors[c];
    return `${Math.abs(a.mean).toFixed(c === 'perclos' ? 1 : 0)} ${unit} ${a.mean >= 0 ? word[0] : word[1]} than the population at the same sleepiness (± ${(1.645 * a.sd).toFixed(c === 'perclos' ? 1 : 0)})`;
  };
  const meter = (label: string, pct: number) => `<div class="calib-row"><span>${label}</span><div class="meter"><span style="width:${pct}%"></span></div><span>${pct}%</span></div>`;
  $('#calib').innerHTML = `
    ${meter('Offset learned', Math.max(0, Math.round(certainty * 100)))}
    ${meter('Reaction-time anchor', learned('pvt'))}
    ${meter('Blink-duration anchor', learned('blink'))}
    ${meter('Eye-closure anchor', learned('perclos'))}
    <dl class="calib-dl">
      <dt>You vs the daily rhythm model</dt><dd>${signed(r.now.offset)} KSS (± ${(1.645 * r.now.offsetSd).toFixed(2)}) from ${r.checkIns} check-in${r.checkIns === 1 ? '' : 's'}</dd>
      <dt>Your reaction time</dt><dd>${anchorText('pvt', 'ms', ['slower', 'faster'])}</dd>
      <dt>Your blinks</dt><dd>${anchorText('blink', 'ms', ['longer', 'shorter'])}</dd>
      <dt>Your eye closure</dt><dd>${anchorText('perclos', 'percentage points', ['higher', 'lower'])}</dd>
    </dl>`;

  // objective check, not anchored to the person's own ratings: the last full reaction test on the population scale,
  // and whether reactions and ratings have been drifting apart
  const d = ins.div;
  const obj = $('#objective');
  obj.classList.toggle('alert', d.verdict === 'slower');
  const gapBar = d.latest
    ? (() => {
        const g = Math.max(-3, Math.min(3, d.latest.gap));
        const pct = (Math.abs(g) / 3) * 50;
        return `<div class="gap-row"><span class="small">Test vs your estimate</span><div class="why-bar diverging" role="img" aria-label="Reaction test reads ${Math.abs(d.latest.gap).toFixed(1)} KSS points ${d.latest.gap >= 0 ? 'sleepier' : 'more alert'} than your estimate"><span class="${g >= 0 ? 'up' : 'down'}" style="${g >= 0 ? 'left:50%' : `left:${50 - pct}%`};width:${pct}%"></span></div><span class="why-val small">${d.latest.gap >= 0 ? '+' : '−'}${Math.abs(d.latest.gap).toFixed(1)}</span></div>`;
      })()
    : '';
  obj.innerHTML = d.latest
    ? `<b>Objective check</b> <span class="muted">(reaction test only, not adjusted to you)</span><br>Your last full test (${fmtTime(d.latest.t)}, median ${Math.round(d.latest.medianRt)} ms) matches a typical person at <b>KSS ${d.latest.objectiveKss.toFixed(1)}</b>.${gapBar}<p class="div-msg">${d.message}</p>`
    : `<b>Objective check</b> <span class="muted">(not adjusted to you)</span><br>Take a 3-minute reaction test for a reading that does not depend on how sleepy you say you feel.`;

  document.querySelectorAll<HTMLButtonElement>('[data-context]').forEach((b) => {
    b.classList.toggle('on', b.dataset.context === r.context);
    b.setAttribute('aria-pressed', String(b.dataset.context === r.context));
  });
  const counts = store.all().reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  $('#data-counts').textContent = `${counts.kss ?? 0} check-ins, ${counts.pvt ?? 0} reaction tests, ${counts.cam ?? 0} webcam minutes stored in this browser.`;
  const wakeInput = $<HTMLInputElement>('#wake');
  if (document.activeElement !== wakeInput) wakeInput.value = new Date(r.sleep.wake).toTimeString().slice(0, 5);
  const hoursInput = $<HTMLInputElement>('#slept');
  if (document.activeElement !== hoursInput) hoursInput.value = String(r.sleep.hours);
  renderTrack();
}

function renderSleepStatus(st: SleepStatus, now: number) {
  const el = $('#sleep-status');
  el.textContent = st.message;
  const attention = st.usesDefaultSleep || st.staleSleep || st.usesFilledNight || st.nights.some((n) => n.status === 'assumed-no-sleep' || n.status === 'filled-habitual');
  el.classList.toggle('attention', attention);
  // one-tap entries for the most recent missing nights
  const missing = st.nights.filter((n) => !n.entry).slice(0, 3);
  const hab = cfg.tpm.habitualSleepHours;
  $('#sleep-chips').innerHTML = missing
    .map((n) => {
      const wake = nightWake(n.to);
      const label = n.index === 0 ? 'Last night' : `Night before ${new Date(wake).toLocaleDateString([], { weekday: 'short' })}`;
      return `<button type="button" class="chip" data-night="${wake}" title="Add this night: woke ${fmtTime(wake)} after ${hab} h">${label}: about ${hab} h</button>`;
    })
    .join('');
  void now;
}

function renderNudge(r: TwinResult, sleepyAt: number | null, now: number, d: Divergence) {
  const lastCheckInAt = store.all().reduce<number | null>((m, e) => (e.type === 'kss' && (m === null || e.t > m) ? e.t : m), null);
  if (nudge && lastCheckInAt !== null && lastCheckInAt >= nudge.shownAt) nudge = null; // answered
  if (!nudge) {
    const s = suggestCheckIn({ now, result: r, sleepyAt, lastCheckInAt, lastSuggestedAt: lastSuggestedAt(), objectiveGap: d.latest?.gap ?? null });
    if (s) nudge = { ...s, shownAt: now };
  }
  $('#nudge').hidden = !nudge;
  if (nudge) $('#nudge-text').textContent = nudge.message;
}

let trackDirty = true;
function renderTrack() {
  const details = $<HTMLDetailsElement>('#track');
  const n = store.all().filter((e) => e.type === 'kss').length;
  $('#track-hint').textContent = details.open ? '' : n ? `Compare its predictions with your ${n} rating${n === 1 ? '' : 's'}` : 'After your first check-in';
  if (!details.open || !trackDirty) return;
  trackDirty = false;
  const tr = trackRecord(store.all(), cfg);
  $('#track-body').innerHTML = trackHtml(tr, $('#track-body').clientWidth || 700);
}

function trackHtml(tr: TrackRecord, width: number): string {
  const s = tr.summary;
  const fmt = (x: number | null) => (x === null ? '–' : x.toFixed(2));
  const maxMae = Math.max(s.maeTwin ?? 0, s.maePrior ?? 0, 0.5);
  const bar = (label: string, v: number | null, cls: string) =>
    `<div class="mae-row"><span>${label}</span><div class="meter"><span class="${cls}" style="width:${v === null ? 0 : (v / maxMae) * 100}%"></span></div><span class="why-val">${fmt(v)}</span></div>`;
  const stats = s.n
    ? `<div class="track-stats">${bar('Twin, just before each rating', s.maeTwin, 'twin-bar')}${bar('Body-clock model alone', s.maePrior, 'prior-bar')}<p class="small muted">Mean error in KSS points (lower is better). ${s.coverage90 === null ? '' : `${Math.round(s.coverage90 * s.n)} of ${s.n} ratings inside the 90% range.`}</p></div>`
    : '';
  return `<p>${s.verdict}</p>${stats}${tr.rows.length ? trackChart(tr, width) : ''}`;
}

function trackChart(tr: TrackRecord, width: number): string {
  const w = Math.max(280, width);
  const h = 170;
  const L = 30;
  const R = 10;
  const T = 14;
  const B = 26;
  const rows = tr.rows;
  const x = (i: number) => L + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * (w - L - R);
  const y = (v: number) => h - B - ((v - 1) / 8) * (h - T - B);
  const parts: string[] = [];
  for (const k of [1, 3, 5, 7, 9]) parts.push(`<line class="grid" x1="${L}" x2="${w - R}" y1="${y(k)}" y2="${y(k)}"/><text class="tick" x="${L - 6}" y="${y(k) + 4}" text-anchor="end">${k}</text>`);
  parts.push(`<text class="axis-title" x="${L - 6}" y="${T - 4}" text-anchor="end">KSS</text>`);
  const every = Math.max(1, Math.ceil(rows.length / Math.floor((w - L - R) / 70)));
  rows.forEach((row, i) => {
    const cx = x(i);
    parts.push(`<line class="err" x1="${cx}" x2="${cx}" y1="${y(row.predicted)}" y2="${y(row.rating)}"/>`);
    parts.push(`<line class="prior-pt" x1="${cx - 5}" x2="${cx + 5}" y1="${y(row.priorOnly)}" y2="${y(row.priorOnly)}"/>`);
    parts.push(`<circle class="pred" cx="${cx}" cy="${y(row.predicted)}" r="3.5"><title>Predicted ${row.predicted.toFixed(1)} before the rating at ${fmtTime(row.t)}</title></circle>`);
    parts.push(`<circle class="checkin" cx="${cx}" cy="${y(row.rating)}" r="5"><title>Your rating ${row.rating} at ${fmtTime(row.t)}</title></circle>`);
    if (i % every === 0) parts.push(`<text class="tick" x="${cx}" y="${h - B + 15}" text-anchor="middle">${new Date(row.t).toLocaleDateString([], { day: 'numeric', month: 'short' })} ${fmtTime(row.t)}</text>`);
  });
  const legend = `<div class="legend small"><span class="lg checkin">your rating</span><span class="lg pred">twin's prediction just before</span><span class="lg prior">body-clock model alone</span></div>`;
  return `${legend}<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Your ratings and the twin's predictions made just before each one">${parts.join('')}</svg>`;
}

/** PERCLOS is only meaningful if ordinary blinks reach the PERCLOS closure level on this camera (see DEFAULT_CONFIG.perclosMinPeakClosure). */
function perclosMeasurable(w: LiveSummary): boolean {
  return w.peakClosure === null || w.peakClosure >= cfg.perclosMinPeakClosure;
}

function renderLive() {
  const el = $('#cam-live');
  if (!live) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<span><b>${live.blinkRate.toFixed(0)}</b> blinks/min</span><span><b>${live.meanBlinkMs ? Math.round(live.meanBlinkMs) : '-'}</b> ms blink</span><span title="${perclosMeasurable(live) ? 'Share of the last minute with the eyes at least 80% closed' : 'Your full blinks do not reach the 80% closure level on this camera, so PERCLOS cannot register eye closure and the twin ignores it'}"><b>${perclosMeasurable(live) ? (live.perclos * 100).toFixed(1) + '%' : 'n/a'}</b> PERCLOS</span><span><b>${live.longClosures}</b> long closures</span><span><b>${live.nods}</b> nods/min</span><span><b>${Math.round(live.coverage * 100)}%</b> face seen</span>`;
}

// --- live sensing and alerts ---
const alerts = new AlertEngine();
const trace: { t: number; closure: number | null; pitch: number | null }[] = [];
let audio: AudioContext | null = null;
let beepTimer = 0;

function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.35);
  } catch {
    /* sound unavailable */
  }
}

function showAlert(level: string, reason: string) {
  const alarm = $('#alarm');
  const warn = $('#warn');
  alarm.hidden = level !== 'alarm';
  warn.hidden = level !== 'warning';
  $('#alarm-reason').textContent = reason;
  $('#warn-reason').textContent = reason;
  document.body.classList.toggle('alarming', level === 'alarm');
  clearInterval(beepTimer);
  if (level === 'alarm') {
    beep();
    beepTimer = window.setInterval(beep, 700);
    $<HTMLButtonElement>('#alarm-ok').focus();
  }
  $('#alert-status').textContent = level === 'notice' ? reason : '';
}

function drawTrace() {
  const c = $<HTMLCanvasElement>('#trace');
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const w = (c.width = c.clientWidth * devicePixelRatio);
  const h = (c.height = c.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  if (trace.length < 2) return;
  const t1 = trace[trace.length - 1].t;
  const x = (t: number) => w - ((t1 - t) / 30_000) * w;
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent');
  ctx.beginPath();
  let pen = false;
  for (const p of trace) {
    if (p.closure === null) {
      pen = false;
      continue;
    }
    const y = h - p.closure * (h * 0.9) - h * 0.05;
    pen ? ctx.lineTo(x(p.t), y) : ctx.moveTo(x(p.t), y);
    pen = true;
  }
  ctx.stroke();
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--load');
  ctx.beginPath();
  pen = false;
  for (const p of trace) {
    if (p.pitch === null) {
      pen = false;
      continue;
    }
    const y = h / 2 - Math.max(-30, Math.min(30, p.pitch)) * (h / 70);
    pen ? ctx.lineTo(x(p.t), y) : ctx.moveTo(x(p.t), y);
    pen = true;
  }
  ctx.stroke();
}

const camera = new Camera($<HTMLVideoElement>('#video'), $<HTMLCanvasElement>('#overlay'), {
  onFrame: (fr) => {
    const bar = $('#eye-bar');
    bar.style.width = fr.closure === null ? '0%' : `${Math.round(fr.closure * 100)}%`;
    bar.classList.toggle('closed', fr.closure !== null && fr.closure >= 0.8);
    trace.push({ t: fr.t, closure: fr.closure, pitch: fr.pose?.pitch ?? null });
    while (trace.length && trace[0].t < fr.t - 30_000) trace.shift();
    $('#head-live').innerHTML = fr.pose
      ? `<span>pitch <b>${fr.pose.pitch.toFixed(0)}°</b></span><span>yaw <b>${fr.pose.yaw.toFixed(0)}°</b></span><span>roll <b>${fr.pose.roll.toFixed(0)}°</b></span>` +
        (fr.gaze ? `<span>gaze <b>${fr.gaze.x > 0.15 ? 'left' : fr.gaze.x < -0.15 ? 'right' : 'centre'}${fr.gaze.y > 0.15 ? ', up' : fr.gaze.y < -0.15 ? ', down' : ''}</b></span>` : '')
      : '<span>No face</span>';
    const { state, escalated } = alerts.frame({ t: fr.t, face: fr.face, eyesClosedForMs: fr.eyesClosedForMs, headDroppedForMs: fr.headDroppedForMs, closure: fr.closure ?? 0, lookingDown: fr.lookingDown });
    if (state.since === fr.t) {
      showAlert(state.level, state.reason);
      if (escalated && (state.level === 'alarm' || state.level === 'warning') && !store.isDemo) {
        store.add({ t: Date.now(), type: 'alert', level: state.level, reason: state.reason });
      }
    }
  },
  onLive: (w) => {
    live = w;
    renderLive();
    drawTrace();
    alerts.updateMinute({ perclos: w.perclos, longClosures: w.longClosures, meanBlinkMs: w.meanBlinkMs, blinks: w.blinks, twinKss: lastKss });
  },
  onWindow: (w) => {
    if (store.isDemo) return;
    store.add({ t: Date.now(), type: 'cam', perclos: w.perclos, blinkRate: w.blinkRate, meanBlinkMs: w.meanBlinkMs, coverage: w.coverage, nods: w.nods, headMovement: w.headMovement, ...(w.peakClosure !== null ? { peakClosure: w.peakClosure } : {}) });
    render();
  },
  onError: (m) => {
    $('#cam-status').textContent = m;
    $('#cam-toggle').textContent = 'Start camera';
  },
});

$('#alarm-ok').addEventListener('click', () => {
  clearInterval(beepTimer);
  $('#alarm').hidden = true;
  document.body.classList.remove('alarming');
});
$('#warn-ok').addEventListener('click', () => {
  alerts.acknowledge(performance.now());
  $('#warn').hidden = true;
});

function setCameraUi(on: boolean) {
  $('#video-placeholder').hidden = on;
  $<HTMLButtonElement>('#cam-toggle').disabled = on;
  $('#cam-toggle').textContent = on ? 'Camera on' : 'Start camera';
  $<HTMLButtonElement>('#cam-stop').disabled = !on;
  $('#hide-wrap').hidden = !on;
  if (!on) {
    $<HTMLInputElement>('#hide-video').checked = false;
    $('.video-wrap').classList.remove('hidden-video');
  }
}

function stopCamera() {
  camera.stop();
  live = null;
  trace.length = 0;
  renderLive();
  drawTrace();
  $('#head-live').innerHTML = '';
  $('#eye-bar').style.width = '0%';
  showAlert('ok', '');
  setCameraUi(false);
  $('#cam-status').textContent = 'Camera off.';
}

$('#cam-toggle').addEventListener('click', async () => {
  $('#cam-toggle').textContent = 'Starting…';
  await camera.start((m) => ($('#cam-status').textContent = m));
  if (camera.active) {
    setCameraUi(true);
    $('#cam-status').textContent = 'Watching blinks. Video stays on this page; one summary is saved per minute.';
  } else {
    $('#cam-toggle').textContent = 'Start camera';
  }
});
$('#cam-stop').addEventListener('click', stopCamera);
$('#hide-video').addEventListener('change', (e) => {
  $('.video-wrap').classList.toggle('hidden-video', (e.target as HTMLInputElement).checked);
});
$('#btn-quit').addEventListener('click', async () => {
  if (camera.active) stopCamera();
  try {
    await fetch('/api/quit', { method: 'POST' });
  } catch {
    /* server already gone */
  }
  document.body.innerHTML = '<div class="quit-msg"><h1>BlinkTwin has stopped.</h1><p>You can close this window. Open BlinkTwin from the Desktop to start again.</p></div>';
  window.close();
});

/** Asks for a check-in; true if one was saved. */
async function checkIn(): Promise<boolean> {
  const res = await openCheckIn({ askTlx: true });
  if (!res) return false;
  const t = store.now();
  store.add({ t, type: 'kss', value: res.kss });
  if (res.tlx) store.add({ t: t + 1000, type: 'tlx', value: res.tlx.value, items: res.tlx.items });
  if (nudge) setLastSuggestedAt(store.now());
  trackDirty = true;
  render();
  return true;
}

$('#btn-checkin').addEventListener('click', checkIn);
$('#btn-pvt').addEventListener('click', async () => {
  const quick = $<HTMLInputElement>('#pvt-quick').checked;
  // rate first, then test: a rating given after seeing reaction times would be coloured by them
  if (!(await checkIn())) return;
  const durationS = quick ? 60 : 180;
  const res = await runPvt(durationS * 1000);
  if (!res || !res.n) return;
  store.add({ t: store.now(), type: 'pvt', medianRt: res.medianRt, lapses: res.lapses, n: res.n, falseStarts: res.falseStarts, durationS });
  $('#pvt-last').textContent = `Last test: median ${Math.round(res.medianRt)} ms, ${res.lapses} lapses, ${res.falseStarts} false starts.${
    durationS < cfg.pvtMinSeconds ? ' 1-minute tests are shown to you but not used by the twin.' : ''
  }`;
  render();
});

document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) =>
  b.addEventListener('click', () => {
    const now = store.now();
    const key = b.dataset.scenario as string;
    if (scenario?.key === key) scenario = null;
    else if (key === 'break') scenario = { key, label: 'a 15-minute break now, then the usual breaks', scenario: { ...RHYTHM, breakNow: true, breakNowMinutes: 15 } };
    else if (key === 'bed') {
      const bed = bedTime(now);
      scenario = { key, label: `sleep at ${fmtTime(bed)} for 7.5 h`, scenario: { ...RHYTHM, sleepAt: bed, sleepHours: 7.5 } };
    } else scenario = { key, label: 'keep working without breaks', scenario: {} };
    render();
  }),
);

$('#sleep-form').addEventListener('change', (e) => {
  const noSleep = $<HTMLInputElement>('#no-sleep').checked;
  $<HTMLInputElement>('#slept').disabled = noSleep;
  const [hh, mm] = $<HTMLInputElement>('#wake').value.split(':').map(Number);
  // a night without sleep is stored as 0 hours, so it is not filled with a habitual night
  const hours = noSleep ? 0 : Number($<HTMLInputElement>('#slept').value);
  if (Number.isNaN(hh) || (!noSleep && !hours)) return;
  if ((e.target as HTMLElement).id === 'no-sleep' && !noSleep) return; // unticking alone changes nothing yet
  const wake = new Date(store.now());
  wake.setHours(hh, mm, 0, 0);
  if (wake.getTime() > store.now()) wake.setDate(wake.getDate() - 1);
  store.add({ t: Math.min(store.now(), wake.getTime() + 1), type: 'sleep', wake: wake.getTime(), hours });
  render();
});

function toggleDemo() {
  if (store.isDemo) store.stopDemo();
  else store.startDemo(demoDay());
  $('#btn-demo').textContent = store.isDemo ? 'Leave demo' : 'Demo day';
  scenario = null;
  nudge = null;
  trackDirty = true;
  render();
}
$('#btn-demo').addEventListener('click', toggleDemo);
$('#start-demo').addEventListener('click', toggleDemo);
$('#start-checkin').addEventListener('click', checkIn);
const goToSleep = () => {
  $('#sleep-form').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  $<HTMLInputElement>('#wake').focus({ preventScroll: true });
};
$('#start-sleep').addEventListener('click', goToSleep);
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-go="sleep"]')) goToSleep();
});
$('#nudge-checkin').addEventListener('click', async () => {
  if (!(await checkIn())) return;
  nudge = null;
  render();
});
$('#nudge-dismiss').addEventListener('click', () => {
  setLastSuggestedAt(store.now());
  nudge = null;
  render();
});
$('#sleep-chips').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-night]');
  if (!b) return;
  const wake = Number(b.dataset.night);
  store.add({ t: Math.min(store.now(), wake + 1), type: 'sleep', wake, hours: cfg.tpm.habitualSleepHours });
  trackDirty = true;
  render();
});
$('#track').addEventListener('toggle', () => renderTrack());
$('#btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage unavailable */
  }
  drawTrace();
});
// redraw the charts at their new width (they are drawn at the container's pixel width)
let lastChartWidth = 0;
new ResizeObserver(() => {
  const w = $('#kss-chart').clientWidth;
  if (Math.abs(w - lastChartWidth) < 2) return;
  lastChartWidth = w;
  requestAnimationFrame(render);
}).observe($('#kss-chart'));

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
$('#btn-json').addEventListener('click', () => download('blinktwin-events.json', JSON.stringify(store.all(), null, 1), 'application/json'));
$('#btn-csv').addEventListener('click', () => download('blinktwin-events.csv', toCsv(store.all()), 'text/csv'));
$('#btn-clear').addEventListener('click', () => {
  const b = $('#btn-clear');
  if (b.dataset.armed) {
    store.clear();
    nudge = null;
    trackDirty = true;
    delete b.dataset.armed;
    b.textContent = 'Delete my data';
    render();
  } else {
    b.dataset.armed = '1';
    b.textContent = 'Click again to delete';
    setTimeout(() => {
      delete b.dataset.armed;
      b.textContent = 'Delete my data';
    }, 4000);
  }
});

document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-science]');
  if (b) openScience(b.dataset.science);
});

$('#contexts').innerHTML = CONTEXTS.map(([id, label]) => `<button data-context="${id}">${label}</button>`).join('');
document.querySelectorAll<HTMLButtonElement>('[data-context]').forEach((b) =>
  b.addEventListener('click', () => {
    store.add({ t: store.now(), type: 'context', context: b.dataset.context as ContextId });
    render();
  }),
);
if (params.get('demo') === '1' && !store.isDemo) store.startDemo(demoDay());
$('#btn-demo').textContent = store.isDemo ? 'Leave demo' : 'Demo day';
render();
setInterval(() => {
  if (!store.isDemo) render();
}, 60_000);
