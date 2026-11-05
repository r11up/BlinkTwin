// Power of the pre-specified validation study (paper, validation protocol), by simulating its primary
// outcome and its analysis: the error of predicting each observed KSS rating (noisy and rounded, as people
// enter it) from ALL earlier events, across days (leave-future-out replay of the whole log).
//
//   node scripts/power.ts [poolSize=1000] [outDir=../results]
//
// Virtual people: POPULATION (the 'workday' scenario of the simulation study). Each person is followed for 10
// working days that form ONE continuous event log: a sleep entry each morning (wake 07:00 after 7.5 h), the
// same person parameters every day and a new seed per day; check-ins at 09:30, 12:00, 14:30 and 17:00, each
// followed by a 3-min reaction test 4 min later; webcam from 07:30. Predictions come from a single replay per
// person and method: check-ins sit on the replay's 5-min grid, and replay() emits the snapshot at a time
// BEFORE applying the events at that time, so the snapshot at a check-in uses only earlier events (checked,
// for the first people, against a replay of the events strictly before the check-in).
// Methods: A rhythm model alone (Three-Process Model plus time on task, from the sleep and context entries),
// B check-ins only, E BlinkTwin, C consider-covariance (passive signals with anchors carried in the covariance,
// not estimated), and E with a mean-reverting offset (tau 24 h and 72 h).
// Studies of n people are drawn with replacement from the pool (5000 per n). The earlier design, in which each
// day was replayed on its own, is kept as a sensitivity block.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, POPULATION, simulate } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const POOL = Number(process.argv[2] ?? 1000);
const OUT = process.argv[3] ?? '../results';
const DAYS = 10;
const H = 3_600_000;
const DAY0 = Date.UTC(2026, 0, 5, 7); // 07:00 UTC, tz offset 0
const BASE: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
type Method = 'A' | 'B' | 'E' | 'C' | 'E24' | 'E72';
const METHODS: Method[] = ['A', 'B', 'E', 'C', 'E24', 'E72'];
const LABELS: Record<Method, string> = {
  A: 'rhythm model alone',
  B: 'check-ins only',
  E: 'BlinkTwin',
  C: 'consider-covariance (anchors not estimated)',
  E24: 'BlinkTwin, mean-reverting offset (tau 24 h)',
  E72: 'BlinkTwin, mean-reverting offset (tau 72 h)',
};
const CFG: Record<Method, TwinConfig> = {
  A: BASE,
  B: { ...BASE, usePassive: false },
  E: BASE,
  C: { ...BASE, anchorMode: 'consider' },
  E24: { ...BASE, offsetReversionHours: 24 },
  E72: { ...BASE, offsetReversionHours: 72 },
};
const NS = [20, 40, 60, 80, 100, 150];
const STUDIES = 5000;
const MARGINS = [0.03, 0.05, 0.1];
const CHECKIN_HOURS = [2.5, 5, 7.5, 10]; // after 07:00: 09:30, 12:00, 14:30, 17:00

const keep = (events: TwinEvent[], m: Method) =>
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
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
type Per = Record<Method, number>;
const per: Per[] = [];
const perDayReset: { A: number; B: number; E: number }[] = [];
let nRatings = 0;
let maxGridCheck = 0;
for (let i = 0; i < POOL; i++) {
  const person = makePerson(i, mulberry32(1000 + i), POPULATION);
  const days = Array.from({ length: DAYS }, (_, d) => {
    const start = DAY0 + d * 24 * H;
    const checkIns = CHECKIN_HOURS.map((h) => start + h * H);
    return simulate(
      person,
      { start, sleepHours: 7.5, awakeHours: 16, blockMinutes: 50, breakMinutes: 10, checkIns, pvtEveryHours: 0, pvtAfterCheckIn: true, camera: true, tzOffsetMinutes: 0 },
      mulberry32(900_000 + i * 101 + d),
      POPULATION,
    );
  });
  const events = days.flatMap((d) => d.events);
  const ratings = events.filter((e): e is Extract<TwinEvent, { type: 'kss' }> => e.type === 'kss');
  nRatings += ratings.length;
  const until = DAY0 + (DAYS - 1) * 24 * H + 17 * H;
  const row = {} as Per;
  for (const m of METHODS) {
    const ev = keep(events, m);
    const r = replay(ev, CFG[m], { until, from: DAY0, stepMinutes: 5 });
    const at = new Map(r.snapshots.map((sn) => [sn.t, sn.kss]));
    const errs = ratings.map((rt) => {
      const pred = at.get(rt.t);
      if (pred === undefined) throw new Error(`no snapshot at check-in ${new Date(rt.t).toISOString()}`);
      return Math.abs(pred - rt.value);
    });
    if (i < 3 && (m === 'E' || m === 'C' || m === 'E24')) {
      // the snapshot at a check-in must equal a replay, to the same time, of the events strictly before it
      // (comparing with replay(until: t - 1) instead would differ by the 1-ms boundary of the break rule)
      for (const rt of [ratings[0], ratings[13], ratings[39]]) {
        const ref = replay(ev.filter((e) => e.t < rt.t), CFG[m], { until: rt.t, from: DAY0, stepMinutes: 5 }).now.kss;
        maxGridCheck = Math.max(maxGridCheck, Math.abs(ref - (at.get(rt.t) as number)));
      }
    }
    row[m] = mean(errs);
  }
  per.push(row);
  // sensitivity: the earlier design, each day replayed on its own (anchors and offsets do not carry over)
  const err = { A: [] as number[], B: [] as number[], E: [] as number[] };
  days.forEach((sim, d) => {
    const start = DAY0 + d * 24 * H;
    const dayRatings = sim.events.filter((e): e is Extract<TwinEvent, { type: 'kss' }> => e.type === 'kss');
    for (const m of ['A', 'B', 'E'] as const) {
      const ev = keep(sim.events, m);
      for (const rt of dayRatings) err[m].push(Math.abs(replay(ev, CFG[m], { until: rt.t - 1, from: start, stepMinutes: 120 }).now.kss - rt.value));
    }
  });
  perDayReset.push({ A: mean(err.A), B: mean(err.B), E: mean(err.E) });
  if ((i + 1) % 100 === 0) console.error(`pool ${i + 1}/${POOL} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
if (maxGridCheck > 1e-9) throw new Error(`grid snapshot differs from replay(until: t - 1) by ${maxGridCheck}`);

const diff = (a: Method, b: Method) => per.map((p) => p[a] - p[b]);
const stats = (v: number[]) => ({ mean: mean(v), sd: sd(v), se: sd(v) / Math.sqrt(v.length), dz: mean(v) / sd(v) });
const benefit = mean(diff('A', 'B')); // how much check-ins improve on the rhythm model

// ---------------------------------------------------------------- studies
const rng = mulberry32(4242);
const dEB = diff('E', 'B');
const dEA = diff('E', 'A');
const power: Record<string, unknown>[] = [];
for (const n of NS) {
  const tq = tQuantile(0.975, n - 1);
  const ni = MARGINS.map(() => 0);
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
    const upEB = mean(eb) + (tq * sd(eb)) / Math.sqrt(n);
    const upEA = mean(ea) + (tq * sd(ea)) / Math.sqrt(n);
    MARGINS.forEach((mg, q) => {
      if (upEB < mg) ni[q]++; // one-sided 97.5% upper bound below the margin
    });
    if (upEB < 0) supEB++; // two-sided 95% interval entirely below zero
    if (upEA < 0) supEA++;
  }
  power.push({
    n,
    t_0975: tq,
    ...Object.fromEntries(MARGINS.map((mg, q) => [`noninferiority_E_vs_B_margin_${mg.toFixed(2).replace('.', '_')}`, ni[q] / STUDIES])),
    superiority_E_vs_A: supEA / STUDIES,
    superiority_E_vs_B: supEB / STUDIES,
  });
}

const resetMean = (k: 'A' | 'B' | 'E') => mean(perDayReset.map((p) => p[k]));
const resetDiff = (a: 'A' | 'B' | 'E', b: 'A' | 'B' | 'E') => stats(perDayReset.map((p) => p[a] - p[b]));
const summary = {
  design:
    'Pool of virtual people (POPULATION, as the workday scenario). Each person: 10 workdays as ONE continuous event log (sleep entry each morning, wake 07:00 after 7.5 h; same person parameters, new seed per day; check-ins 09:30, 12:00, 14:30, 17:00, each followed by a PVT-B 4 min later; webcam from 07:30). Outcome per person: MAE of predicting each observed (noisy, rounded) KSS rating from all earlier events across days (single replay per person and method; snapshot at the check-in time, which uses only earlier events).',
  methods: LABELS,
  pool_size: POOL,
  ratings_per_person: nRatings / POOL,
  grid_check_max_abs_difference: maxGridCheck,
  mae_mean: Object.fromEntries(METHODS.map((m) => [m, mean(per.map((p) => p[m]))])),
  checkin_benefit_A_minus_B: stats(diff('A', 'B')),
  diff_E_minus_B: stats(dEB),
  diff_E_minus_A: stats(dEA),
  diff_C_minus_B: stats(diff('C', 'B')),
  diff_E_minus_C: stats(diff('E', 'C')),
  diff_E24_minus_B: stats(diff('E24', 'B')),
  diff_E72_minus_B: stats(diff('E72', 'B')),
  diff_E24_minus_E: stats(diff('E24', 'E')),
  diff_E72_minus_E: stats(diff('E72', 'E')),
  margins: MARGINS.map((mg) => ({ margin: mg, share_of_checkin_benefit_that_may_be_lost: mg / benefit })),
  studies_per_n: STUDIES,
  tests:
    'non-inferiority of E vs B: one-sided 97.5% t upper bound of mean(E - B) below the margin; superiority of E vs A and of E vs B: two-sided 95% t-interval entirely below 0',
  power,
  sensitivity_each_day_replayed_separately: {
    note: 'Earlier design: each day replayed on its own (replay to t - 1 ms from that morning, 2-h grid), so anchors and offsets do not carry across days.',
    mae_mean: { A: resetMean('A'), B: resetMean('B'), E: resetMean('E') },
    diff_E_minus_B: resetDiff('E', 'B'),
    diff_E_minus_A: resetDiff('E', 'A'),
  },
  runtime_s: (Date.now() - t0) / 1000,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'power_summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
