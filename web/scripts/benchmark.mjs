// Compute benchmark.
//
// 1. Camera pipeline, in headless Chromium with a fake camera: achieved frames per second, time per
//    MediaPipe Face Landmarker call (mean and 95th percentile), and the share of wall time the page's main
//    thread is busy. The page is opened with ?perf=1, which makes src/sensing/camera.ts record the time of
//    every detectForVideo call; main-thread time comes from Chromium's own task counters.
// 2. The twin, in Node: time to replay a 10-day event log (built with the simulator: a minute webcam
//    summary for every waking minute, four check-ins and four reaction tests a day) and to do the work of one
//    dashboard refresh on it.
//
// Usage (from web/): node scripts/benchmark.mjs [--no-build]
// Needs Playwright with Chromium. Writes ../results/benchmark.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { makePerson, mulberry32, simulate } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, forecast, replay } from '../src/twin/twin.ts';
import { buildSite, FAKE_CAMERA_ARGS, fetchModel, loadPlaywright, sleep, startPreview } from './browser-harness.mjs';

const OUT = '../results/benchmark.json';
const WARMUP_S = 10;
const MEASURE_S = 30;

const quantile = (v, q) => {
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------------- browser
fetchModel();
buildSite();
const server = await startPreview(4174);
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: FAKE_CAMERA_ARGS });
const browserVersion = browser.version();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
const page = await context.newPage();
await page.goto(`${server.url}?perf=1`, { waitUntil: 'networkidle' });
await page.click('#cam-toggle');
await page.waitForFunction(() => globalThis.__blinktwinPerf && globalThis.__blinktwinPerf.frames > 5, null, { timeout: 120_000 });
await sleep(WARMUP_S * 1000);
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const snap = () => page.evaluate(() => ({ frames: globalThis.__blinktwinPerf.frames, n: globalThis.__blinktwinPerf.detectMs.length, delegate: globalThis.__blinktwinPerf.delegate, t: performance.now() }));
const m0 = await metrics();
const s0 = await snap();
await sleep(MEASURE_S * 1000);
const m1 = await metrics();
const s1 = await snap();
const detect = await page.evaluate(([a, b]) => globalThis.__blinktwinPerf.detectMs.slice(a, b), [s0.n, s1.n]);
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGL2 available') : 'no WebGL2';
});
await browser.close();
server.stop();
const wallS = (s1.t - s0.t) / 1000;
const pipeline = {
  measured_s: round(wallS, 1),
  frames_per_second: round((s1.frames - s0.frames) / wallS, 1),
  frame_cap_per_second: 24,
  detect_ms_mean: round(mean(detect)),
  detect_ms_p95: round(quantile(detect, 0.95)),
  detect_ms_max: round(Math.max(...detect)),
  detect_calls: detect.length,
  main_thread_busy_share: round((m1.TaskDuration - m0.TaskDuration) / wallS, 3),
  script_share: round((m1.ScriptDuration - m0.ScriptDuration) / wallS, 3),
  js_heap_mb: round(m1.JSHeapUsedSize / 1e6, 1),
  mediapipe_delegate: s1.delegate,
  webgl_renderer: gpu,
};

// ---------------------------------------------------------------------------------------------- twin
const H = 3_600_000;
const day0 = Date.UTC(2026, 0, 5, 7);
const rng = mulberry32(42);
const person = makePerson(1, rng);
const events = [];
for (let d = 0; d < 10; d++) {
  const start = day0 + d * 24 * H;
  const { events: ev } = simulate(
    person,
    {
      start,
      sleepHours: 7.5,
      awakeHours: 16,
      blockMinutes: 50,
      breakMinutes: 10,
      checkIns: [2, 6, 10, 14].map((h) => start + h * H),
      pvtEveryHours: 0,
      pvtAfterCheckIn: true,
      camera: true,
      tzOffsetMinutes: 0,
    },
    rng,
  );
  events.push(...ev);
}
const end = day0 + 9 * 24 * H + 16 * H;
const cfg = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const count = (type) => events.filter((e) => e.type === type).length;
const time = (fn, runs = 10) => {
  for (let i = 0; i < 2; i++) fn();
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    ms.push(performance.now() - t);
  }
  return { median_ms: round(quantile(ms, 0.5), 1), max_ms: round(Math.max(...ms), 1), runs };
};
const replayAll = time(() => replay(events, cfg, { until: end, stepMinutes: 5 }));
// one dashboard refresh, as in src/main.ts: a replay to find the current night, a replay of the last 16 h
// on a 5-minute grid, and an 8-hour forecast with the usual work rhythm
const refresh = time(() => {
  const r0 = replay(events, cfg, { until: end, stepMinutes: 5 });
  const t0 = Math.max(r0.sleep.wake, end - 16 * H);
  const r = replay(events, cfg, { until: end, from: t0, stepMinutes: 5 });
  forecast(r, cfg, { hours: 8, stepMinutes: 10, scenario: { breaksEveryMinutes: 50, breakMinutes: 10 } });
});

const cpus = os.cpus();
const result = {
  date: new Date().toISOString(),
  machine: {
    cpu: cpus[0]?.model ?? 'unknown',
    logical_cores: cpus.length,
    memory_gb: round(os.totalmem() / 2 ** 30, 1),
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    node: process.version,
    browser: `Chromium ${browserVersion}, headless`,
  },
  caveat:
    'Measured in a cloud container: shared virtual CPUs, no GPU (MediaPipe falls back to its CPU delegate and WebGL is software-rendered) and a headless browser with a fake camera. This is not a typical laptop; a laptop with a GPU should run the face model faster, and these numbers are a conservative reference, not a laptop result.',
  camera_pipeline: pipeline,
  twin_replay: {
    event_log: { days: 10, events: events.length, webcam_minutes: count('cam'), check_ins: count('kss'), reaction_tests: count('pvt'), context_changes: count('context') },
    replay_10_days_5min_grid: replayAll,
    dashboard_refresh_on_10_day_log: refresh,
  },
};
mkdirSync('../results', { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(
  `camera: ${pipeline.frames_per_second} fps (cap 24), MediaPipe ${pipeline.detect_ms_mean} ms mean / ${pipeline.detect_ms_p95} ms p95 (${pipeline.mediapipe_delegate}), main thread busy ${(pipeline.main_thread_busy_share * 100).toFixed(0)}%; ` +
    `twin: 10-day replay ${replayAll.median_ms} ms, dashboard refresh ${refresh.median_ms} ms (${events.length} events) -> ${OUT}`,
);
