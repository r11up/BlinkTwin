// Power of the pre-specified validation study (paper, validation protocol), by simulating its primary
// outcome: the error of predicting each observed KSS rating (noisy and rounded, as people enter it) from
// all events of that day before it.
//
//   node scripts/power.ts [poolSize=1000] [outDir=../results]
//
// Virtual people: POPULATION (the 'workday' scenario of the simulation study). Each person is followed for
// 10 independent working days: same person parameters, a new seed each day; wake 07:00 after 7.5 h; check-ins
// at 09:30, 12:00, 14:30 and 17:00, each followed by a 3-min reaction test 4 min later; webcam from 07:30.
// Each day is replayed on its own, so anchors and offsets learned on one day do not carry to the next. This is
// conservative for BlinkTwin, whose anchors would carry over in the real study.
// Per person: MAE over the 40 ratings for the rhythm model alone (A: Three-Process Model plus time on task, from
// the sleep and context entries), check-ins only (B) and BlinkTwin (E).
// Studies of n people are drawn with replacement from the pool (5000 per n).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, POPULATION, simulate } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const POOL = Number(process.argv[2] ?? 1000);
const OUT = process.argv[3] ?? '../results';
const DAYS = 10;
const H = 3_600_000;
const M = 60_000;
const DAY0 = Date.UTC(2026, 0, 5, 7); // 07:00 UTC, tz offset 0
const BASE: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const CFG: Record<'A' | 'B' | 'E', TwinConfig> = { A: BASE, B: { ...BASE, usePassive: false }, E: BASE };
const NS = [20, 30, 40, 60, 80];
const STUDIES = 5000;
const MARGIN = 0.1;

const keep = (events: TwinEvent[], m: 'A' | 'B' | 'E') =>
  m === 'A' ? events.filter((e) => e.type === 'sleep' || e.type === 'context') : m === 'B' ? events.filter((e) => e.type !== 'pvt' && e.type !== 'cam') : events;

// ---------------------------------------------------------------- Student t quantile (for the t-intervals)
function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 / (Math.abs(1 + aa * d) < 1e-30 ? 1e-30 : 1 + aa * d);
    c = Math.abs(1 + aa / c) < 1e-30 ? 1e-30 : 1 + aa / c;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 / (Math.abs(1 + aa * d) < 1e-30 ? 1e-30 : 1 + aa * d);
    c = Math.abs(1 + aa / c) < 1e-30 ? 1e-30 : 1 + aa / c;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
const tCdf = (t: number, df: number) => {
  const p = 0.5 * betai(df / 2, 0.5, df / (df + t * t));
  return t > 0 ? 1 - p : p;
};
function tQuantile(p: number, df: number): number {
  let lo = -50;
  let hi = 50;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- the pool
const t0 = Date.now();
const per: { A: number; B: number; E: number }[] = [];
let nRatings = 0;
for (let i = 0; i < POOL; i++) {
  const person = makePerson(i, mulberry32(1000 + i), POPULATION);
  const err = { A: [] as number[], B: [] as number[], E: [] as number[] };
  for (let d = 0; d < DAYS; d++) {
    const start = DAY0 + d * 24 * H;
    const checkIns = [2.5, 5, 7.5, 10].map((h) => start + h * H);
    const sim = simulate(
      person,
      { start, sleepHours: 7.5, awakeHours: 16, blockMinutes: 50, breakMinutes: 10, checkIns, pvtEveryHours: 0, pvtAfterCheckIn: true, camera: true, tzOffsetMinutes: 0 },
      mulberry32(900_000 + i * 101 + d),
      POPULATION,
    );
    const ratings = sim.events.filter((e): e is Extract<TwinEvent, { type: 'kss' }> => e.type === 'kss');
    for (const m of ['A', 'B', 'E'] as const) {
      const ev = keep(sim.events, m);
      for (const r of ratings) {
        const rr = replay(ev, CFG[m], { until: r.t - 1, from: start, stepMinutes: 120 });
        err[m].push(Math.abs(rr.now.kss - r.value));
      }
    }
    nRatings += ratings.length;
  }
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  per.push({ A: mean(err.A), B: mean(err.B), E: mean(err.E) });
  if ((i + 1) % 100 === 0) console.log(`pool ${i + 1}/${POOL} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
const dEB = per.map((p) => p.E - p.B);
const dEA = per.map((p) => p.E - p.A);

// ---------------------------------------------------------------- studies
const rng = mulberry32(4242);
const power: Record<string, unknown>[] = [];
for (const n of NS) {
  const tq = tQuantile(0.975, n - 1);
  let nonInf = 0;
  let supEB = 0;
  let supEA = 0;
  for (let s = 0; s < STUDIES; s++) {
    const eb: number[] = [];
    const ea: number[] = [];
    for (let j = 0; j < n; j++) {
      const k = Math.floor(rng() * per.length);
      eb.push(dEB[k]);
      ea.push(dEA[k]);
    }
    const se1 = sd(eb) / Math.sqrt(n);
    const se2 = sd(ea) / Math.sqrt(n);
    if (mean(eb) + tq * se1 < MARGIN) nonInf++; // one-sided 97.5% upper bound below the margin
    if (mean(eb) + tq * se1 < 0) supEB++; // two-sided 95% CI entirely below zero: E better than B
    if (mean(ea) + tq * se2 < 0) supEA++;
  }
  power.push({ n, t_0975: tq, noninferiority_E_vs_B_margin_0_10: nonInf / STUDIES, superiority_E_vs_B: supEB / STUDIES, superiority_E_vs_A: supEA / STUDIES });
}

const summary = {
  design:
    'Pool of virtual people (POPULATION, as the workday scenario), 10 independent workdays each (new seed per day; wake 07:00 after 7.5 h; check-ins 09:30, 12:00, 14:30, 17:00, each followed by a PVT-B 4 min later; webcam from 07:30). Outcome per person: MAE of predicting each observed (noisy, rounded) KSS rating from that day\'s earlier events (replay to t - 1 ms, clipped estimate).',
  note: 'Each day is replayed separately, so anchors and offsets do not carry across days; conservative for BlinkTwin (E).',
  pool_size: POOL,
  ratings_per_person: nRatings / POOL,
  mae_mean: { A_rhythm_model: mean(per.map((p) => p.A)), B_checkins: mean(per.map((p) => p.B)), E_blinktwin: mean(per.map((p) => p.E)) },
  diff_E_minus_B: { mean: mean(dEB), sd: sd(dEB), dz: mean(dEB) / sd(dEB) },
  diff_E_minus_A: { mean: mean(dEA), sd: sd(dEA), dz: mean(dEA) / sd(dEA) },
  studies_per_n: STUDIES,
  margin: MARGIN,
  tests:
    '(i) non-inferiority of E vs B: one-sided 97.5% t upper bound of mean(E - B) < 0.10; (ii) superiority of E vs B and (iii) of E vs A: two-sided 95% t-interval entirely below 0',
  power,
  runtime_s: (Date.now() - t0) / 1000,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'power_summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
