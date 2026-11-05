// Simulation study for the paper. Runs the released twin (src/twin, DEFAULT_CONFIG fitted on DROZY) on
// virtual participants with a known ground truth (src/sim/synth.ts) and writes tables to results/.
//
//   node scripts/simulate.ts [nPeople=300] [outDir=../results]
//
// Protocol: wake 07:00 reporting 7.5 h sleep, then 24 h awake, 50-min task blocks with 10-min breaks,
// webcam during tasks, a reaction test every 2 h and right after each check-in (rate first, then test).
// Check-ins (KSS + TLX) are spread evenly over the first 16 h.
// Scenarios: 'matched' follows the twin's assumptions; the others break them on purpose.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, POPULATION, simulate, type Person, type PopulationSpec, type TruthPoint } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, forecast, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const N = Number(process.argv[2] ?? 300);
const OUT = process.argv[3] ?? '../results';
const H = 3_600_000;
const M = 60_000;
const START = Date.UTC(2026, 0, 5, 7); // 07:00 UTC; tz offset 0 throughout
const BASE: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };

const SCENARIOS: Record<string, { label: string; pop: PopulationSpec; ks: number[] }> = {
  matched: { label: "Matches the twin's assumptions", pop: POPULATION, ks: [0, 1, 2, 3, 4, 6, 8] },
  misreport: { label: 'Body clock off by up to 2 h and sleep misreported (SD 1.5 h)', pop: { ...POPULATION, phaseSdHours: 2, sleepMisreportSdHours: 1.5 }, ks: [0, 1, 3, 8] },
  nonlinear: { label: 'Nonlinear signals with heavy-tailed noise', pop: { ...POPULATION, nonlinear: true, heavyTails: true }, ks: [0, 1, 3, 8] },
  ratingbias: { label: 'People rate themselves with a personal bias (SD 0.8) and more noise (SD 1.0)', pop: { ...POPULATION, ratingBiasSd: 0.8, ratingNoiseSd: 1.0 }, ks: [0, 1, 3, 8] },
  autocorr: {
    label: 'Webcam noise far more autocorrelated than assumed (rho 0.7)',
    pop: { ...POPULATION, perclosPct: { ...POPULATION.perclosPct, ar1: 0.7, driftSd: 3 }, blinkMs: { ...POPULATION.blinkMs, ar1: 0.7, driftSd: 45 } },
    ks: [0, 1, 3, 8],
  },
};

type MethodId = 'prior' | 'checkins' | 'noanchor' | 'twin' | 'oracle';
const METHODS: { id: MethodId; label: string }[] = [
  { id: 'prior', label: 'Rhythm model only' },
  { id: 'checkins', label: 'Check-ins only' },
  { id: 'noanchor', label: 'Check-ins + passive, no anchors' },
  { id: 'twin', label: 'BlinkTwin (anchored)' },
  { id: 'oracle', label: 'Oracle: true personal signal parameters' },
];

function cfgFor(m: MethodId, person: Person): TwinConfig {
  if (m === 'checkins') return { ...BASE, usePassive: false };
  if (m === 'noanchor') return { ...BASE, useAnchors: false };
  if (m === 'oracle') {
    const c = BASE.channels;
    // knows each person's own baseline and slope; still has to track the slow drift like the twin
    return {
      ...BASE,
      channels: {
        pvt: { ...c.pvt, at3: person.rt.at3, perKss: person.rt.perKss, slopeSd: 0, biasSd: 1e-3 },
        blink: { ...c.blink, at3: person.blinkMs.at3, perKss: person.blinkMs.perKss, slopeSd: 0, biasSd: 1e-3 },
        perclos: { ...c.perclos, at3: person.perclosPct.at3, perKss: person.perclosPct.perKss, slopeSd: 0, biasSd: 1e-3 },
      },
    };
  }
  return BASE;
}

function keepEvents(events: TwinEvent[], m: MethodId): TwinEvent[] {
  if (m === 'prior') return events.filter((e) => e.type === 'sleep');
  if (m === 'checkins') return events.filter((e) => e.type !== 'pvt' && e.type !== 'cam');
  return events;
}

function checkInTimes(k: number): number[] {
  if (k === 0) return [];
  if (k === 1) return [START + 3 * H];
  return Array.from({ length: k }, (_, i) => START + (1.5 + (i * 14) / (k - 1)) * H);
}

function protocolFor(k: number) {
  return { start: START, sleepHours: 7.5, awakeHours: 24, blockMinutes: 50, breakMinutes: 10, checkIns: checkInTimes(k), pvtEveryHours: 2, pvtAfterCheckIn: true, camera: true, tzOffsetMinutes: 0 };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

function bootCi(v: number[], seed: number, B = 2000): [number, number] {
  const rng = mulberry32(seed);
  const ms: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(rng() * v.length)];
    ms.push(s / v.length);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}

function auroc(scores: number[], labels: boolean[]): number {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let sumPos = 0;
  let nPos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (i + 1 + j) / 2;
    for (let q = i; q < j; q++) {
      if (idx[q][1]) {
        sumPos += avg;
        nPos++;
      }
    }
    i = j;
  }
  const nNeg = idx.length - nPos;
  return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : NaN;
}

interface PersonResult {
  mae: number;
  night: number;
  coverage: number;
  brier: number[];
  pForecast: number[];
  yForecast: boolean[];
  crossErrMin: number | null;
}

function evaluate(events: TwinEvent[], truth: TruthPoint[], cfg: TwinConfig, withForecast: boolean): PersonResult {
  const r = replay(events, cfg, { until: START + 24 * H, from: START, stepMinutes: 10 });
  const byT = new Map(truth.map((p) => [p.t, p]));
  const errs: number[] = [];
  const night: number[] = [];
  let covered = 0;
  for (const s of r.snapshots) {
    if (s.t < START + 30 * M) continue;
    const tr = byT.get(s.t);
    if (!tr) continue;
    const e = Math.abs(s.kss - tr.kss);
    errs.push(e);
    if (s.t >= START + 16 * H) night.push(e);
    if (e <= 1.645 * Math.max(s.kssSd, 1e-6)) covered++;
  }
  const out: PersonResult = { mae: mean(errs), night: mean(night), coverage: covered / errs.length, brier: [], pForecast: [], yForecast: [], crossErrMin: null };
  if (!withForecast) return out;
  for (let h = 5; h <= 22; h++) {
    const t0 = START + h * H;
    const rr = replay(events, cfg, { until: t0, from: START, stepMinutes: 60 });
    const f = forecast(rr, cfg, { hours: 1, stepMinutes: 60 });
    const tr = byT.get(t0 + H);
    if (!tr) continue;
    const p = f.points[f.points.length - 1].pSleepy;
    const y = tr.kss >= 7;
    out.pForecast.push(p);
    out.yForecast.push(y);
    out.brier.push((p - (y ? 1 : 0)) ** 2);
  }
  // time of reaching KSS 7, forecast at 17:00 (10 h after waking) over the next 12 h
  const t0 = START + 10 * H;
  const f = forecast(replay(events, cfg, { until: t0, from: START, stepMinutes: 60 }), cfg, { hours: 12, stepMinutes: 10 });
  const trueCross = truth.find((p) => p.t >= t0 && p.kss >= 7)?.t ?? null;
  if (f.sleepyAt !== null && trueCross !== null) out.crossErrMin = Math.abs(f.sleepyAt - trueCross) / M;
  return out;
}

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const maeRows: Record<string, string | number>[] = [];
const fcRows: Record<string, string | number>[] = [];
const comparisons: Record<string, unknown>[] = [];

for (const [sid, sc] of Object.entries(SCENARIOS)) {
  const people = Array.from({ length: N }, (_, i) => makePerson(i, mulberry32(1000 + i), sc.pop));
  const per: Record<string, PersonResult[]> = {};
  for (const k of sc.ks) {
    const sims = people.map((p) => simulate(p, protocolFor(k), mulberry32(5000 + p.id * 31 + k), sc.pop));
    for (const m of METHODS) {
      if (m.id === 'prior' && k > 0) continue;
      if (m.id !== 'prior' && m.id !== 'twin' && m.id !== 'oracle' && k === 0) continue;
      const withForecast = k === 3 || (k === 0 && m.id === 'prior');
      const res = people.map((p, i) => evaluate(keepEvents(sims[i].events, m.id), sims[i].truth, cfgFor(m.id, p), withForecast));
      per[`${m.id}_k${k}`] = res;
      const maes = res.map((r) => r.mae);
      const ci = bootCi(maes, 11 + k);
      const ref = per[`checkins_k${k}`];
      const win = ref && m.id !== 'checkins' ? mean(res.map((r, i) => (r.mae < ref[i].mae ? 1 : 0))) : NaN;
      maeRows.push({ scenario: sid, method: m.id, label: m.label, k, mae: mean(maes), mae_lo: ci[0], mae_hi: ci[1], night_mae: mean(res.map((r) => r.night)), coverage90: mean(res.map((r) => r.coverage)), win_vs_checkins: win });
      if (withForecast) {
        const ps = res.flatMap((r) => r.pForecast);
        const ys = res.flatMap((r) => r.yForecast);
        const cross = res.map((r) => r.crossErrMin).filter((x): x is number => x !== null);
        const brierPer = res.map((r) => mean(r.brier));
        const base = mean(ys.map((y) => (y ? 1 : 0)));
        const refB = per[`checkins_k${k}`]?.map((r) => mean(r.brier));
        const d = refB && m.id !== 'checkins' ? brierPer.map((b, i) => b - refB[i]) : null;
        const dci = d ? bootCi(d, 77) : [NaN, NaN];
        fcRows.push({
          scenario: sid,
          method: m.id,
          label: m.label,
          k,
          brier: mean(brierPer),
          brier_climatology: base * (1 - base),
          auroc: auroc(ps, ys),
          brier_diff_vs_checkins: d ? mean(d) : NaN,
          brier_diff_lo: dci[0],
          brier_diff_hi: dci[1],
          crossing_mae_min: mean(cross),
          crossing_n: cross.length,
        });
      }
    }
  }
  const pair = (a: string, b: string) => {
    if (!per[a] || !per[b]) return;
    const d = per[a].map((r, i) => r.mae - per[b][i].mae);
    comparisons.push({ scenario: sid, a, b, mean_diff: mean(d), ci: bootCi(d, 99), share_a_better: mean(d.map((v) => (v < 0 ? 1 : 0))) });
  };
  for (const k of sc.ks.filter((x) => x > 0)) {
    pair(`twin_k${k}`, `checkins_k${k}`);
    pair(`noanchor_k${k}`, `checkins_k${k}`);
    pair(`twin_k${k}`, `noanchor_k${k}`);
    pair(`oracle_k${k}`, `twin_k${k}`);
  }
  pair('twin_k0', 'prior_k0');
  pair('twin_k3', 'prior_k0');
  console.log(`scenario ${sid} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const cell = (v: string | number) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v));
const toCsv = (rs: Record<string, string | number>[]) => [Object.keys(rs[0]).join(','), ...rs.map((r) => Object.values(r).map(cell).join(','))].join('\n');
writeFileSync(join(OUT, 'sim_mae.csv'), toCsv(maeRows));
writeFileSync(join(OUT, 'sim_forecast.csv'), toCsv(fcRows));
writeFileSync(
  join(OUT, 'sim_summary.json'),
  JSON.stringify(
    {
      n_people_per_scenario: N,
      protocol: 'wake 07:00 reporting 7.5 h sleep, 24 h awake; PVT every 2 h and right after each check-in; webcam during 50-min task blocks; check-ins spread over the first 16 h',
      twin: 'released defaults (DEFAULT_CONFIG, forward models fitted on DROZY); no parameter tuned on simulated people',
      scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.label])),
      mae: maeRows,
      forecast: fcRows,
      comparisons,
      runtime_s: (Date.now() - t0) / 1000,
    },
    null,
    1,
  ),
);
const f3 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : '-');
for (const r of maeRows) console.log(`${String(r.scenario).padEnd(10)} ${String(r.method).padEnd(9)} k=${r.k}  MAE ${f3(r.mae)} [${f3(r.mae_lo)}, ${f3(r.mae_hi)}]  night ${f3(r.night_mae)}  cov90 ${f3(r.coverage90)}  win ${f3(r.win_vs_checkins)}`);
for (const r of fcRows) console.log(`forecast ${String(r.scenario).padEnd(10)} ${String(r.method).padEnd(9)} Brier ${f3(r.brier)} diff ${f3(r.brier_diff_vs_checkins)} [${f3(r.brier_diff_lo)}, ${f3(r.brier_diff_hi)}] AUROC ${f3(r.auroc)} cross ${Math.round(r.crossing_mae_min as number)} min (n=${r.crossing_n})`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
