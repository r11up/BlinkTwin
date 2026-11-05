import './style.css';
import { AlertEngine } from './sensing/alerts.ts';
import { Camera, type LiveSummary } from './sensing/camera.ts';
import { demoDay } from './demo.ts';
import { Store, toCsv } from './store.ts';
import { DEFAULT_CONFIG, forecast, replay, type ChannelId, type ContextId, type Scenario, type TwinEvent, type TwinResult } from './twin/twin.ts';
import { kssChart, workloadChart, type Overlay } from './ui/charts.ts';
import { KSS_LABELS, openCheckIn, runPvt } from './ui/dialogs.ts';
import { openScience } from './ui/science.ts';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const store = new Store();
const cfg = DEFAULT_CONFIG;
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

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const kssWord = (k: number) => KSS_LABELS[Math.min(8, Math.max(0, Math.round(k) - 1))];
const loadWord = (w: number) => (w < 30 ? 'Light' : w < 55 ? 'Moderate' : w < 75 ? 'High' : 'Very high');

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
  const f = forecast(r, cfg, { hours: 8, stepMinutes: 10 });
  const overlays: Overlay[] = [];
  let scenarioNote = '';
  if (scenario) {
    const s = forecast(r, cfg, { hours: 8, stepMinutes: 10, scenario: scenario.scenario });
    overlays.push({ label: scenario.label, points: s.points, className: 'what-if' });
    scenarioNote = `<b>${scenario.label}:</b> ${s.sleepyAt ? `sleepy (KSS 7) around ${fmtTime(s.sleepyAt)}` : 'stays below KSS 7 for the next 8 hours'}${
      f.sleepyAt ? `, compared with ${fmtTime(f.sleepyAt)} if nothing changes.` : '.'
    }`;
  }

  lastKss = r.now.kss;
  $('#demo-banner').hidden = !store.isDemo;
  $('#now-kss').textContent = r.now.kss.toFixed(1);
  $('#now-kss-sd').textContent = `± ${(1.645 * r.now.kssSd).toFixed(1)}`;
  $('#now-kss-word').textContent = kssWord(r.now.kss);
  $('#now-load').textContent = String(Math.round(r.now.workload));
  $('#now-load-sd').textContent = `± ${Math.round(1.645 * r.now.workloadSd)}`;
  $('#now-load-word').textContent = `${loadWord(r.now.workload)} workload`;
  $('#forecast-line').innerHTML = f.sleepyAt
    ? `At this rate you will reach <b>KSS 7</b> (sleepy) around <b>${fmtTime(f.sleepyAt)}</b>.`
    : `No sleepiness peak (KSS 7) expected in the next 8 hours.`;
  $('#kss-chart').innerHTML = kssChart({ snapshots: r.snapshots, forecast: f.points, overlays, events: store.all(), now, t0, t1 });
  $('#load-chart').innerHTML = workloadChart({ snapshots: r.snapshots, events: store.all(), now, t0, t1 });
  $('#scenario-note').innerHTML = scenarioNote;
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => b.classList.toggle('on', b.dataset.scenario === scenario?.key));

  // why: decompose the current estimate
  const rows: [string, number, string][] = [
    ['Daily rhythm model', r.now.prior, 'Three-Process Model: time since waking, time of day, sleep inertia'],
    ['Time on task', r.now.tot, `${(r.now.tot / cfg.totPerHour).toFixed(1)} h since your last long break`],
    ['Your check-ins', r.contributions.kss, `${r.checkIns} KSS rating${r.checkIns === 1 ? '' : 's'}`],
    ['Reaction test', r.contributions.pvt, 'through your personal reaction-time model'],
    ['Eyes (webcam)', r.contributions.cam, 'blink duration and eye closure, through your personal model'],
  ];
  $('#why').innerHTML =
    rows
      .map(([name, v, note], i) => {
        const w = Math.min(100, Math.abs(v) * (i === 0 ? 11 : 40));
        return `<div class="why-row"><div class="why-name">${name}<span class="muted small">${note}</span></div>
        <div class="why-bar"><span class="${i === 0 ? 'base' : v >= 0 ? 'up' : 'down'}" style="width:${w}%"></span></div>
        <div class="why-val">${i === 0 ? v.toFixed(1) : (v >= 0 ? '+' : '') + v.toFixed(2)}</div></div>`;
      })
      .join('') + `<div class="why-row total"><div class="why-name">Twin estimate</div><div></div><div class="why-val">${r.now.kss.toFixed(1)}</div></div>`;

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

  // objective check, not anchored to the person's own ratings: what the last reaction test says on the population scale
  const lastPvt = [...store.all()].reverse().find((e): e is Extract<TwinEvent, { type: 'pvt' }> => e.type === 'pvt');
  const ch = cfg.channels.pvt;
  $('#objective').innerHTML = lastPvt
    ? `Objective check (not adjusted to you): your last reaction test, median ${Math.round(lastPvt.medianRt)} ms, matches a typical person at <b>KSS ${Math.min(9, Math.max(1, 3 + (lastPvt.medianRt - ch.at3) / ch.perKss)).toFixed(1)}</b>. If that is well above how sleepy you feel, you may be underrating your impairment.`
    : 'Run a reaction test for an objective check that does not depend on how sleepy you say you feel.';

  document.querySelectorAll<HTMLButtonElement>('[data-context]').forEach((b) => b.classList.toggle('on', b.dataset.context === r.context));
  const counts = store.all().reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  $('#data-counts').textContent = `${counts.kss ?? 0} check-ins, ${counts.pvt ?? 0} reaction tests, ${counts.cam ?? 0} webcam minutes stored in this browser.`;
  const wakeInput = $<HTMLInputElement>('#wake');
  if (document.activeElement !== wakeInput) wakeInput.value = new Date(r.sleep.wake).toTimeString().slice(0, 5);
  const hoursInput = $<HTMLInputElement>('#slept');
  if (document.activeElement !== hoursInput) hoursInput.value = String(r.sleep.hours);
}

function renderLive() {
  const el = $('#cam-live');
  if (!live) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<span><b>${live.blinkRate.toFixed(0)}</b> blinks/min</span><span><b>${live.meanBlinkMs ? Math.round(live.meanBlinkMs) : '-'}</b> ms blink</span><span><b>${(live.perclos * 100).toFixed(1)}%</b> PERCLOS</span><span><b>${live.longClosures}</b> long closures</span><span><b>${live.nods}</b> nods/min</span><span><b>${Math.round(live.coverage * 100)}%</b> face seen</span>`;
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
    store.add({ t: Date.now(), type: 'cam', perclos: w.perclos, blinkRate: w.blinkRate, meanBlinkMs: w.meanBlinkMs, coverage: w.coverage, nods: w.nods, headMovement: w.headMovement });
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

async function checkIn() {
  const res = await openCheckIn({ askTlx: true });
  if (!res) return;
  const t = store.now();
  store.add({ t, type: 'kss', value: res.kss });
  if (res.tlx) store.add({ t: t + 1000, type: 'tlx', value: res.tlx.value, items: res.tlx.items });
  render();
}

$('#btn-checkin').addEventListener('click', checkIn);
$('#btn-pvt').addEventListener('click', async () => {
  const quick = $<HTMLInputElement>('#pvt-quick').checked;
  // rate first, then test: a rating given after seeing reaction times would be coloured by them
  await checkIn();
  const res = await runPvt(quick ? 60_000 : 180_000);
  if (!res || !res.n) return;
  store.add({ t: store.now(), type: 'pvt', medianRt: res.medianRt, lapses: res.lapses, n: res.n, falseStarts: res.falseStarts });
  $('#pvt-last').textContent = `Last test: median ${Math.round(res.medianRt)} ms, ${res.lapses} lapses, ${res.falseStarts} false starts.`;
  render();
});

document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) =>
  b.addEventListener('click', () => {
    const now = store.now();
    const key = b.dataset.scenario as string;
    if (scenario?.key === key) scenario = null;
    else if (key === 'break') scenario = { key, label: 'Take a 15-minute break now', scenario: { breakNow: true } };
    else if (key === 'bed') {
      const bed = new Date(now);
      bed.setHours(23, 0, 0, 0);
      if (bed.getTime() < now) bed.setTime(now + 30 * 60_000);
      scenario = { key, label: `Sleep at ${fmtTime(bed.getTime())} for 7.5 h`, scenario: { sleepAt: bed.getTime(), sleepHours: 7.5 } };
    } else scenario = { key, label: 'Keep going without a break', scenario: {} };
    render();
  }),
);

$('#sleep-form').addEventListener('change', () => {
  const [hh, mm] = $<HTMLInputElement>('#wake').value.split(':').map(Number);
  const hours = Number($<HTMLInputElement>('#slept').value);
  if (Number.isNaN(hh) || !hours) return;
  const wake = new Date(store.now());
  wake.setHours(hh, mm, 0, 0);
  if (wake.getTime() > store.now()) wake.setDate(wake.getDate() - 1);
  store.add({ t: Math.min(store.now(), wake.getTime() + 1), type: 'sleep', wake: wake.getTime(), hours });
  render();
});

$('#btn-demo').addEventListener('click', () => {
  if (store.isDemo) store.stopDemo();
  else store.startDemo(demoDay());
  $('#btn-demo').textContent = store.isDemo ? 'Leave demo' : 'Demo day';
  scenario = null;
  render();
});

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
