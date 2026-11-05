// Runs the website's BlinkMeter (src/sensing/blink.ts, unchanged, default options) over the per-frame
// MediaPipe eyeBlink scores extracted from the DROZY videos (analysis/drozy_mediapipe_compare.py extract).
// This is the website's webcam pipeline end to end, apart from frame capture: same model file, same
// blendshape, same blink logic. Frame times come from DROZY's timestamps.
//
// Also runs a diagnostic variant ("rs") in which each test's raw score is first rescaled to its own
// 5th..99.5th percentile range. It shows how much the outputs depend on the raw score reaching values
// near 1 for closed eyes, which it does not in these near-infrared videos.
//
// Usage (from web/): node scripts/drozy_mediapipe_blinks.ts <frames dir> <out tests csv> <out minutes csv>
// Outputs aggregates only (per test and per minute).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlinkMeter, percentile, type CamWindow } from '../src/sensing/blink.ts';

const [dir, outTests, outMinutes] = process.argv.slice(2);
if (!dir || !outTests || !outMinutes) {
  console.error('usage: node scripts/drozy_mediapipe_blinks.ts <frames dir> <out tests csv> <out minutes csv>');
  process.exit(1);
}

interface Frame {
  t: number;
  score: number | null;
}

function run(frames: Frame[]) {
  const meter = new BlinkMeter();
  const windows: CamWindow[] = [];
  const t0 = frames[0].t;
  let next = t0 + 60_000;
  for (const f of frames) {
    while (f.t > next) {
      windows.push(meter.window(next, 60_000));
      next += 60_000;
    }
    meter.push(f.t, f.score);
  }
  // last complete minute only
  return windows;
}

function summarise(w: CamWindow[]) {
  const withBlinks = w.filter((x) => x.blinks > 0);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  return {
    perclos: mean(w.map((x) => x.perclos)),
    blinkRate: mean(w.map((x) => x.blinkRate)),
    blinkMs: mean(withBlinks.map((x) => x.meanBlinkMs)),
    longPerMin: mean(w.map((x) => x.longClosures)),
    blinksTotal: w.reduce((s, x) => s + x.blinks, 0),
  };
}

const testRows = [
  'subject,test,fps,n_frames,face_rate,n_minutes,score_p50,score_p95,score_p99,score_max,mp_perclos,mp_blink_rate,mp_blink_ms,mp_long_per_min,mp_blinks_total,rs_perclos,rs_blink_rate,rs_blink_ms,rs_long_per_min',
];
const minuteRows = ['subject,test,minute,perclos,blink_rate,mean_blink_ms,long_closures,coverage,blinks,perclos_rs,blink_rate_rs,mean_blink_ms_rs,long_closures_rs,blinks_rs'];

const files = readdirSync(dir)
  .filter((f) => /^\d+-\d+\.csv$/.test(f))
  .sort((a, b) => {
    const [sa, ta] = a.replace('.csv', '').split('-').map(Number);
    const [sb, tb] = b.replace('.csv', '').split('-').map(Number);
    return sa - sb || ta - tb;
  });

for (const f of files) {
  const [subject, test] = f.replace('.csv', '').split('-').map(Number);
  const lines = readFileSync(join(dir, f), 'utf8').trim().split('\n').slice(1);
  const frames: Frame[] = lines.map((l) => {
    const c = l.split(',');
    return { t: Number(c[1]), score: c[2] === '1' ? Number(c[3]) : null };
  });
  const scores = frames.filter((x) => x.score !== null).map((x) => x.score as number);
  const p5 = percentile(scores, 0.05);
  const p995 = percentile(scores, 0.995);
  const rescaled = frames.map((x) => ({ t: x.t, score: x.score === null ? null : Math.min(1, Math.max(0, (x.score - p5) / Math.max(1e-6, p995 - p5))) }));
  const w = run(frames);
  const wr = run(rescaled);
  const s = summarise(w);
  const sr = summarise(wr);
  const durS = (frames[frames.length - 1].t - frames[0].t) / 1000;
  const fps = (frames.length - 1) / durS;
  testRows.push(
    [
      subject, test, fps.toFixed(2), frames.length, (scores.length / frames.length).toFixed(4), w.length,
      percentile(scores, 0.5).toFixed(4), percentile(scores, 0.95).toFixed(4), percentile(scores, 0.99).toFixed(4), Math.max(...scores).toFixed(4),
      s.perclos.toFixed(5), s.blinkRate.toFixed(3), Number.isNaN(s.blinkMs) ? '' : s.blinkMs.toFixed(1), s.longPerMin.toFixed(3), s.blinksTotal,
      sr.perclos.toFixed(5), sr.blinkRate.toFixed(3), Number.isNaN(sr.blinkMs) ? '' : sr.blinkMs.toFixed(1), sr.longPerMin.toFixed(3),
    ].join(','),
  );
  w.forEach((x, i) => {
    const r = wr[i];
    minuteRows.push(
      [subject, test, i + 1, x.perclos.toFixed(5), x.blinkRate, x.meanBlinkMs.toFixed(1), x.longClosures, x.coverage.toFixed(4), x.blinks, r.perclos.toFixed(5), r.blinkRate, r.meanBlinkMs.toFixed(1), r.longClosures, r.blinks].join(','),
    );
  });
  console.log(`${subject}-${test}: ${fps.toFixed(1)} fps, face ${(100 * scores.length / frames.length).toFixed(1)}%, score p99 ${percentile(scores, 0.99).toFixed(2)}, blinks/min ${s.blinkRate.toFixed(1)} (rescaled ${sr.blinkRate.toFixed(1)}), PERCLOS ${(100 * s.perclos).toFixed(2)}% (rescaled ${(100 * sr.perclos).toFixed(2)}%)`);
}

writeFileSync(outTests, testRows.join('\n') + '\n');
writeFileSync(outMinutes, minuteRows.join('\n') + '\n');
console.log(`wrote ${outTests} (${testRows.length - 1} tests) and ${outMinutes} (${minuteRows.length - 1} minutes)`);
