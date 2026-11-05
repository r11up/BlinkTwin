// Runs BlinkTwin's own blink meter (src/sensing/blink.ts, unchanged) on DROZY's frame-level 68-point
// landmarks, so the paper validates the same blink logic the website uses.
//
// Per frame: eye aspect ratio (EAR; Soukupova & Cech, 2016), mean of both eyes, from iBUG points
// 36-41 and 42-47. The website feeds MediaPipe's eyeBlink blendshape (0 open, 1 closed); here the
// equivalent closure score is EAR rescaled per test: score = clamp((EAR_open - EAR) / (EAR_open - EAR_closed)),
// with EAR_open = 90th and EAR_closed = 1st percentile of that test's valid EAR.
// Frames with missing or degenerate landmarks are treated as "no face".
//
// The released DROZY results were computed before the blink meter learned to hold its open-eye baseline
// during closures of 2 s or more (src/sensing/blink.ts, freezeAfterMs). By default this script reproduces
// them exactly ({ freezeAfterMs: Infinity }); pass --fixed-baseline to use the website's current meter.
//
// Usage (from web/): node scripts/drozy_eyes.ts <DROZY dir> <out sessions csv> [out minutes csv] [--fixed-baseline]
// Outputs aggregates only (per test and per minute), never per-frame data.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlinkMeter, percentile } from '../src/sensing/blink.ts';

const args = process.argv.slice(2);
const FIXED_BASELINE = args.includes('--fixed-baseline');
const [dir, outSessions, outMinutes] = args.filter((a) => a !== '--fixed-baseline');
if (!dir || !outSessions) {
  console.error('usage: node scripts/drozy_eyes.ts <DROZY dir> <out sessions csv> [out minutes csv]');
  process.exit(1);
}

const dist = (a: number[], i: number, j: number) => Math.hypot(a[2 * i] - a[2 * j], a[2 * i + 1] - a[2 * j + 1]);

function ear(p: number[], o: number): number {
  // points o..o+5 = p1..p6
  const v = dist(p, o + 1, o + 5) + dist(p, o + 2, o + 4);
  const h = 2 * dist(p, o, o + 3);
  return h > 0 ? v / h : NaN;
}

const sessions: string[] = [];
const minutes: string[] = [];
sessions.push('subject,test,fps,n_frames,face_coverage,ear_open,ear_closed,n_minutes,perclos,blink_rate,mean_blink_ms,median_blink_ms_minutes,long_closures_per_min,blinks_total');
minutes.push('subject,test,minute,perclos,blink_rate,mean_blink_ms,long_closures,coverage,blinks');

const tests = readdirSync(join(dir, 'annotations-auto'))
  .filter((f) => f.endsWith('-s2.txt'))
  .map((f) => f.replace('-s2.txt', ''))
  .sort((a, b) => {
    const [sa, ta] = a.split('-').map(Number);
    const [sb, tb] = b.split('-').map(Number);
    return sa - sb || ta - tb;
  });

for (const id of tests) {
  const [subject, test] = id.split('-').map(Number);
  const lm = readFileSync(join(dir, 'annotations-auto', `${id}-s2.txt`), 'utf8').trim().split('\n');
  const ts = readFileSync(join(dir, 'timestamps', `${id}.txt`), 'utf8').trim().split('\n');
  if (lm.length !== ts.length) console.warn(`${id}: ${lm.length} landmark lines vs ${ts.length} timestamps; using the shorter`);
  const n = Math.min(lm.length, ts.length);
  const t: number[] = [];
  const e: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const tf = ts[i].trim().split(/\s+/).map(Number);
    t.push(tf[7]);
    const p = lm[i].trim().split(/\s+/).map(Number);
    if (p.length !== 136 || p.some((v) => !Number.isFinite(v)) || p.every((v) => v === 0)) {
      e.push(null);
      continue;
    }
    const v = (ear(p, 36) + ear(p, 42)) / 2;
    e.push(Number.isFinite(v) && v > 0 && v < 1 ? v : null);
  }
  const valid = e.filter((v): v is number => v !== null);
  const open = percentile(valid, 0.9);
  const closed = percentile(valid, 0.01);
  const span = Math.max(1e-6, open - closed);
  const meter = new BlinkMeter(FIXED_BASELINE ? {} : { freezeAfterMs: Infinity });
  const wins: ReturnType<BlinkMeter['window']>[] = [];
  let nextWin = 60_000;
  for (let i = 0; i < n; i++) {
    const score = e[i] === null ? null : Math.min(1, Math.max(0, (open - (e[i] as number)) / span));
    meter.push(t[i], score);
    if (t[i] >= nextWin) {
      wins.push(meter.window(t[i], 60_000));
      nextWin += 60_000;
    }
  }
  const durS = (t[n - 1] - t[0]) / 1000;
  const fps = (n - 1) / durS;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const withBlinks = wins.filter((w) => w.blinks > 0);
  wins.forEach((w, k) =>
    minutes.push([subject, test, k + 1, w.perclos, w.blinkRate, w.blinks ? w.meanBlinkMs : '', w.longClosures, w.coverage, w.blinks].join(',')),
  );
  sessions.push(
    [
      subject,
      test,
      fps.toFixed(2),
      n,
      (valid.length / n).toFixed(4),
      open.toFixed(4),
      closed.toFixed(4),
      wins.length,
      mean(wins.map((w) => w.perclos)).toFixed(5),
      mean(wins.map((w) => w.blinkRate)).toFixed(3),
      mean(withBlinks.map((w) => w.meanBlinkMs)).toFixed(1),
      percentile(withBlinks.map((w) => w.meanBlinkMs), 0.5).toFixed(1),
      mean(wins.map((w) => w.longClosures)).toFixed(3),
      wins.reduce((s, w) => s + w.blinks, 0),
    ].join(','),
  );
  console.log(`${id}: ${fps.toFixed(1)} fps, coverage ${(valid.length / n).toFixed(3)}, EAR open ${open.toFixed(3)} closed ${closed.toFixed(3)}, ${wins.length} min, blink rate ${mean(wins.map((w) => w.blinkRate)).toFixed(1)}/min, blink ${mean(withBlinks.map((w) => w.meanBlinkMs)).toFixed(0)} ms, PERCLOS ${(100 * mean(wins.map((w) => w.perclos))).toFixed(2)}%`);
}

writeFileSync(outSessions, sessions.join('\n') + '\n');
if (outMinutes) writeFileSync(outMinutes, minutes.join('\n') + '\n');
