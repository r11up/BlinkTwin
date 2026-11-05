// Simulation study for the paper. Runs the released twin (src/twin, DEFAULT_CONFIG fitted on DROZY) on
// virtual participants with a known ground truth (src/sim/synth.ts) and writes tables to results/.
//
//   node scripts/simulate.ts [nPeople=300] [outDir=../results]
//
// Protocol: wake 07:00 reporting the night's sleep, then 24 h awake (16 h in the 'workday' scenario),
// 50-min task blocks with 10-min breaks, one webcam window per minute from the first task block on (breaks
// included), a reaction test every 2 h and 4 min after each check-in (rate first, then test).
// Check-ins (KSS + TLX) are spread evenly from 08:30 (k = 1: at 10:00).
// Each person's simulator seed does not depend on k (common random numbers): the true trajectory, the
// webcam windows and the 2-hourly reaction tests are identical across k; only the check-ins and the tests
// after them differ. No twin parameter is tuned on simulated people.
// 'Rhythm model only' sees the sleep and context entries (the Three-Process Model plus time on task) but no
// measurements. Every forecast, for every method, projects the protocol's own work rhythm (50-min blocks,
// 10-min breaks) rather than continuous work, so all methods assume the same pattern of time on task.
// Scenarios: 'matched' follows the twin's assumptions; the others break them on purpose.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, POPULATION, simulate, type Person, type PopulationSpec, type TruthPoint } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, forecast, replay, type ChannelId, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const N = Number(process.argv[2] ?? 300);
const OUT = process.argv[3] ?? '../results';
const H = 3_600_000;
const M = 60_000;
const START = Date.UTC(2026, 0, 5, 7); // 07:00 UTC; tz offset 0 throughout
const BASE: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const Z90 = 1.645;
const RHYTHM = { breaksEveryMinutes: 50, breakMinutes: 10 }; // the protocol's work rhythm, used by every forecast

interface Scenario {
  label: string;
  pop: PopulationSpec;
  ks: number[];
  sleepHours?: number; // reported (and actual, unless misreported) sleep last night; default 7.5
  awakeHours?: number; // default 24
  lastCheckInHour?: number; // hours after waking of the last check-in; default 15.5 (22:30)
  forecastFromHour?: number; // hours after waking of the first one-hour forecast; default 5 (12:00)
  forecastToHour?: number; // default 22 (05:00)
}

const SCENARIOS: Record<string, Scenario> = {
  matched: { label: "Matches the twin's assumptions", pop: POPULATION, ks: [0, 1, 2, 3, 4, 6, 8] },
  misreport: { label: 'Body clock off by up to 2 h and sleep misreported (SD 1.5 h)', pop: { ...POPULATION, phaseSdHours: 2, sleepMisreportSdHours: 1.5 }, ks: [0, 1, 3, 8] },
  nonlinear: { label: 'Nonlinear signals with heavy-tailed noise', pop: { ...POPULATION, nonlinear: true, heavyTails: true }, ks: [0, 1, 3, 8] },
  ratingbias: { label: 'People rate themselves with a personal bias (SD 0.8) and more noise (SD 1.0)', pop: { ...POPULATION, ratingBiasSd: 0.8, ratingNoiseSd: 1.0 }, ks: [0, 1, 3, 8] },
  autocorr: {
    label: 'Webcam noise far more autocorrelated than assumed (rho 0.7)',
    pop: { ...POPULATION, perclosPct: { ...POPULATION.perclosPct, ar1: 0.7, driftSd: 3 }, blinkMs: { ...POPULATION.blinkMs, ar1: 0.7, driftSd: 45 } },
    ks: [0, 1, 3, 8],
  },
  trait: {
    label: 'Person-specific Three-Process Model: homeostatic decay x exp(N(0, 0.3)), circadian amplitude x exp(N(0, 0.2))',
    pop: { ...POPULATION, traitWakeDecayLogSd: 0.3, traitAmplitudeLogSd: 0.2 },
    ks: [0, 1, 3, 8],
  },
  debt: {
    label: 'Unrecorded sleep debt: 5 h on each of the last 5 nights; the twin is told only about last night',
    pop: { ...POPULATION, debtNights: 5, debtHours: 5 },
    ks: [0, 1, 3, 8],
    sleepHours: 5,
  },
  workday: {
    label: 'Ordinary 16-h day (07:00 to 23:00), check-ins 08:30 to 21:30',
    pop: POPULATION,
    ks: [0, 1, 3, 8],
    awakeHours: 16,
    lastCheckInHour: 14.5,
    forecastFromHour: 2,
    forecastToHour: 15,
  },
  dissociation: {
    label: 'Ratings level off: above KSS 5 only half of any further rise is reported; passive signals follow the true state',
    pop: { ...POPULATION, ratingKnee: 5, ratingCompression: 0.5 },
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
const CHANNELS: ChannelId[] = ['pvt', 'blink', 'perclos'];

function cfgFor(m: MethodId, person: Person, base: TwinConfig = BASE): TwinConfig {
  if (m === 'checkins') return { ...base, usePassive: false };
  if (m === 'noanchor') return { ...base, useAnchors: false };
  if (m === 'oracle') {
    const c = base.channels;
    // knows each person's own baseline and slope; still has to track the slow drift like the twin
    return {
      ...base,
      channels: {
        pvt: { ...c.pvt, at3: person.rt.at3, perKss: person.rt.perKss, slopeSd: 0, biasSd: 1e-3 },
        blink: { ...c.blink, at3: person.blinkMs.at3, perKss: person.blinkMs.perKss, slopeSd: 0, biasSd: 1e-3 },
        perclos: { ...c.perclos, at3: person.perclosPct.at3, perKss: person.perclosPct.perKss, slopeSd: 0, biasSd: 1e-3 },
      },
    };
  }
  return base;
}

function keepEvents(events: TwinEvent[], m: MethodId): TwinEvent[] {
  if (m === 'prior') return events.filter((e) => e.type === 'sleep' || e.type === 'context');
  if (m === 'checkins') return events.filter((e) => e.type !== 'pvt' && e.type !== 'cam');
  return events;
}

function checkInTimes(k: number, lastHour: number): number[] {
  if (k === 0) return [];
  if (k === 1) return [START + 3 * H];
  return Array.from({ length: k }, (_, i) => START + (1.5 + (i * (lastHour - 1.5)) / (k - 1)) * H);
}

function protocolFor(sc: Scenario, k: number) {
  return {
    start: START,
    sleepHours: sc.sleepHours ?? 7.5,
    awakeHours: sc.awakeHours ?? 24,
    blockMinutes: 50,
    breakMinutes: 10,
    checkIns: checkInTimes(k, sc.lastCheckInHour ?? 15.5),
    pvtEveryHours: 2,
    pvtAfterCheckIn: true,
    camera: true,
    tzOffsetMinutes: 0,
  };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const meanOrNaN = (v: number[]) => (v.length ? mean(v) : NaN);
const quantile = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

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

/** Person-level bootstrap CI of AUROC(a) - AUROC(b), forecasts pooled within each resample. */
function aurocDiffCi(a: PersonResult[], b: PersonResult[], seed: number, B = 2000): [number, number] {
  const rng = mulberry32(seed);
  const ds: number[] = [];
  const n = a.length;
  for (let r = 0; r < B; r++) {
    const pa: number[] = [];
    const pb: number[] = [];
    const ya: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      pa.push(...a[j].pForecast);
      pb.push(...b[j].pForecast);
      ya.push(...a[j].yForecast);
    }
    const d = auroc(pa, ya) - auroc(pb, ya);
    if (Number.isFinite(d)) ds.push(d);
  }
  ds.sort((x, y) => x - y);
  return [ds[Math.floor(0.025 * ds.length)], ds[Math.floor(0.975 * ds.length)]];
}

interface PersonResult {
  mae: number;
  night: number;
  coverage: number;
  width: number;
  brier: number[];
  pForecast: number[];
  yForecast: boolean[];
  crossErrMin: number | null;
}

function evaluate(events: TwinEvent[], truth: TruthPoint[], cfg: TwinConfig, sc: Scenario, withForecast: boolean): PersonResult {
  const awake = sc.awakeHours ?? 24;
  const r = replay(events, cfg, { until: START + awake * H, from: START, stepMinutes: 10 });
  const byT = new Map(truth.map((p) => [p.t, p]));
  const errs: number[] = [];
  const night: number[] = [];
  const widths: number[] = [];
  let covered = 0;
  for (const s of r.snapshots) {
    if (s.t < START + 30 * M) continue;
    const tr = byT.get(s.t);
    if (!tr) continue;
    const e = Math.abs(s.kss - tr.kss);
    errs.push(e);
    widths.push(2 * Z90 * s.kssSd);
    if (awake > 16 && s.t >= START + 16 * H) night.push(e);
    if (e <= Z90 * Math.max(s.kssSd, 1e-6)) covered++;
  }
  const out: PersonResult = { mae: mean(errs), night: meanOrNaN(night), coverage: covered / errs.length, width: mean(widths), brier: [], pForecast: [], yForecast: [], crossErrMin: null };
  if (!withForecast) return out;
  for (let h = sc.forecastFromHour ?? 5; h <= (sc.forecastToHour ?? 22); h++) {
    const t0 = START + h * H;
    const rr = replay(events, cfg, { until: t0, from: START, stepMinutes: 60 });
    const f = forecast(rr, cfg, { hours: 1, stepMinutes: 60, scenario: RHYTHM });
    const tr = byT.get(t0 + H);
    if (!tr) continue;
    const p = f.points[f.points.length - 1].pSleepy;
    const y = tr.kss >= 7;
    out.pForecast.push(p);
    out.yForecast.push(y);
    out.brier.push((p - (y ? 1 : 0)) ** 2);
  }
  // time of reaching KSS 7, forecast at 17:00 (10 h after waking) over the rest of the protocol (up to 12 h)
  const t0 = START + 10 * H;
  const f = forecast(replay(events, cfg, { until: t0, from: START, stepMinutes: 60 }), cfg, { hours: Math.min(12, awake - 10), stepMinutes: 10, scenario: RHYTHM });
  const trueCross = truth.find((p) => p.t >= t0 && p.kss >= 7)?.t ?? null;
  if (f.sleepyAt !== null && trueCross !== null) out.crossErrMin = Math.abs(f.sleepyAt - trueCross) / M;
  return out;
}

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const maeRows: Record<string, string | number>[] = [];
const fcRows: Record<string, string | number>[] = [];
const relRows: Record<string, string | number>[] = [];
const comparisons: Record<string, unknown>[] = [];
const crnCheck: Record<string, unknown> = {};

const personSeed = (id: number) => 5000 + id * 31; // independent of k: common random numbers

for (const [sid, sc] of Object.entries(SCENARIOS)) {
  const people = Array.from({ length: N }, (_, i) => makePerson(i, mulberry32(1000 + i), sc.pop));
  const per: Record<string, PersonResult[]> = {};
  let truthRef: TruthPoint[][] | null = null;
  let maxTruthDiff = 0;
  for (const k of sc.ks) {
    const sims = people.map((p) => simulate(p, protocolFor(sc, k), mulberry32(personSeed(p.id)), sc.pop));
    // common random numbers: the truth must be identical across k
    if (!truthRef) truthRef = sims.map((s) => s.truth);
    else
      sims.forEach((s, i) => s.truth.forEach((tp, j) => (maxTruthDiff = Math.max(maxTruthDiff, Math.abs(tp.kss - (truthRef as TruthPoint[][])[i][j].kss)))));
    for (const m of METHODS) {
      if (m.id === 'prior' && k > 0) continue;
      if (m.id !== 'prior' && m.id !== 'twin' && m.id !== 'oracle' && k === 0) continue;
      const withForecast = k === 3 || (k === 0 && m.id === 'prior');
      const res = people.map((p, i) => evaluate(keepEvents(sims[i].events, m.id), sims[i].truth, cfgFor(m.id, p), sc, withForecast));
      per[`${m.id}_k${k}`] = res;
      const maes = res.map((r) => r.mae);
      const ci = bootCi(maes, 11 + k);
      const ref = per[`checkins_k${k}`];
      const win = ref && m.id !== 'checkins' ? mean(res.map((r, i) => (r.mae < ref[i].mae ? 1 : 0))) : NaN;
      const nights = res.map((r) => r.night).filter((x) => Number.isFinite(x));
      maeRows.push({
        scenario: sid,
        method: m.id,
        label: m.label,
        k,
        mae: mean(maes),
        mae_lo: ci[0],
        mae_hi: ci[1],
        night_mae: meanOrNaN(nights),
        coverage90: mean(res.map((r) => r.coverage)),
        width90: mean(res.map((r) => r.width)),
        win_vs_checkins: win,
      });
      if (withForecast) {
        const ps = res.flatMap((r) => r.pForecast);
        const ys = res.flatMap((r) => r.yForecast);
        const cross = res.map((r) => r.crossErrMin).filter((x): x is number => x !== null);
        const brierPer = res.map((r) => mean(r.brier));
        const base = mean(ys.map((y) => (y ? 1 : 0)));
        const refRes = per[`checkins_k${k}`];
        const refB = refRes?.map((r) => mean(r.brier));
        const d = refB && m.id !== 'checkins' ? brierPer.map((b, i) => b - refB[i]) : null;
        const dci = d ? bootCi(d, 77) : [NaN, NaN];
        const auc = auroc(ps, ys);
        const aucRef = refRes && m.id !== 'checkins' ? auroc(refRes.flatMap((r) => r.pForecast), refRes.flatMap((r) => r.yForecast)) : NaN;
        const aci = refRes && m.id !== 'checkins' ? aurocDiffCi(res, refRes, 177) : [NaN, NaN];
        const priorB = per.prior_k0 ? mean(per.prior_k0.map((r) => mean(r.brier))) : NaN;
        fcRows.push({
          scenario: sid,
          method: m.id,
          label: m.label,
          k,
          n_forecasts: ps.length,
          base_rate: base,
          brier: mean(brierPer),
          brier_climatology: base * (1 - base),
          brier_skill_vs_prior: 1 - mean(brierPer) / priorB,
          auroc: auc,
          brier_diff_vs_checkins: d ? mean(d) : NaN,
          brier_diff_lo: dci[0],
          brier_diff_hi: dci[1],
          auroc_diff_vs_checkins: auc - aucRef,
          auroc_diff_lo: aci[0],
          auroc_diff_hi: aci[1],
          crossing_mae_min: meanOrNaN(cross),
          crossing_n: cross.length,
        });
        if (sid === 'matched' && (m.id === 'prior' || m.id === 'checkins' || m.id === 'twin')) {
          for (let b = 0; b < 10; b++) {
            const lo = b / 10;
            const hi = (b + 1) / 10;
            const sel = ps.map((p, i) => [p, ys[i]] as const).filter(([p]) => p >= lo && (b === 9 ? p <= hi : p < hi));
            relRows.push({
              scenario: sid,
              method: m.id,
              k,
              bin: b,
              lo,
              hi,
              mean_forecast: sel.length ? mean(sel.map(([p]) => p)) : NaN,
              observed: sel.length ? mean(sel.map(([, y]) => (y ? 1 : 0))) : NaN,
              n: sel.length,
            });
          }
        }
      }
    }
  }
  crnCheck[sid] = { max_abs_truth_difference_across_k: maxTruthDiff };
  const pair = (a: string, b: string) => {
    if (!per[a] || !per[b]) return;
    const d = per[a].map((r, i) => r.mae - per[b][i].mae);
    const nightPairs = per[a].map((r, i) => r.night - per[b][i].night).filter((x) => Number.isFinite(x));
    comparisons.push({
      scenario: sid,
      a,
      b,
      mean_diff: mean(d),
      ci: bootCi(d, 99),
      share_a_better: mean(d.map((v) => (v < 0 ? 1 : 0))),
      share_a_worse_by_0_1: mean(d.map((v) => (v > 0.1 ? 1 : 0))),
      p05: quantile(d, 0.05),
      p50: quantile(d, 0.5),
      p95: quantile(d, 0.95),
      night_mean_diff: nightPairs.length ? mean(nightPairs) : null,
      night_ci: nightPairs.length ? bootCi(nightPairs, 98) : null,
    });
  };
  for (const k of sc.ks.filter((x) => x > 0)) {
    pair(`twin_k${k}`, `checkins_k${k}`);
    pair(`noanchor_k${k}`, `checkins_k${k}`);
    pair(`twin_k${k}`, `noanchor_k${k}`);
    pair(`oracle_k${k}`, `twin_k${k}`);
  }
  pair('twin_k0', 'prior_k0');
  pair('twin_k3', 'prior_k0');
  pair('checkins_k3', 'prior_k0');
  if (sid === 'dissociation') {
    // the twin without check-ins reads the passive signals only: an objective estimate not tied to the ratings
    pair('twin_k0', 'checkins_k3');
    pair('twin_k0', 'twin_k3');
  }
  console.log(`scenario ${sid} done (${((Date.now() - t0) / 1000).toFixed(0)} s); max truth difference across k ${maxTruthDiff}`);
}

// Sensitivity of the matched scenario (k = 3) to the twin's hand-set hyperparameters, one at a time.
const scale = (cfg: TwinConfig, field: 'biasDriftSdPerSqrtHour' | 'slopeSd', f: number): TwinConfig => ({
  ...cfg,
  channels: Object.fromEntries(CHANNELS.map((c) => [c, { ...cfg.channels[c], [field]: cfg.channels[c][field] * f }])) as TwinConfig['channels'],
});
const SENS: { param: string; value: number; cfg: TwinConfig }[] = [
  ...[0.84, 1.2, 1.6].map((v) => ({ param: 'offsetPriorSd', value: v, cfg: { ...BASE, offsetPriorSd: v } })),
  ...[0.15, 0.3, 0.6].map((v) => ({ param: 'offsetDriftSdPerSqrtHour', value: v, cfg: { ...BASE, offsetDriftSdPerSqrtHour: v } })),
  ...[0, 0.4, 0.8].map((v) => ({ param: 'totPerHour', value: v, cfg: { ...BASE, totPerHour: v } })),
  ...[0.5, 0.75, 1.0].map((v) => ({ param: 'kssNoiseSd', value: v, cfg: { ...BASE, kssNoiseSd: v } })),
  ...[0.5, 1, 2].map((v) => ({ param: 'anchorDrift_x', value: v, cfg: scale(BASE, 'biasDriftSdPerSqrtHour', v) })),
  ...[0, 1, 2].map((v) => ({ param: 'slopeSd_x', value: v, cfg: scale(BASE, 'slopeSd', v) })),
];
const sensRows: Record<string, string | number>[] = [];
{
  const sc = SCENARIOS.matched;
  const people = Array.from({ length: N }, (_, i) => makePerson(i, mulberry32(1000 + i), sc.pop));
  const sims = people.map((p) => simulate(p, protocolFor(sc, 3), mulberry32(personSeed(p.id)), sc.pop));
  for (const s of SENS) {
    for (const m of ['checkins', 'twin'] as MethodId[]) {
      const res = people.map((p, i) => evaluate(keepEvents(sims[i].events, m), sims[i].truth, cfgFor(m, p, s.cfg), sc, false));
      const maes = res.map((r) => r.mae);
      const ci = bootCi(maes, 13);
      sensRows.push({ param: s.param, value: s.value, method: m, mae: mean(maes), mae_lo: ci[0], mae_hi: ci[1], coverage90: mean(res.map((r) => r.coverage)), width90: mean(res.map((r) => r.width)) });
    }
  }
  console.log(`sensitivity done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const cell = (v: string | number) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v));
const toCsv = (rs: Record<string, string | number>[]) => [Object.keys(rs[0]).join(','), ...rs.map((r) => Object.values(r).map(cell).join(','))].join('\n');
writeFileSync(join(OUT, 'sim_mae.csv'), toCsv(maeRows) + '\n');
writeFileSync(join(OUT, 'sim_forecast.csv'), toCsv(fcRows) + '\n');
writeFileSync(join(OUT, 'sim_reliability.csv'), toCsv(relRows) + '\n');
writeFileSync(join(OUT, 'sim_sensitivity.csv'), toCsv(sensRows) + '\n');
writeFileSync(
  join(OUT, 'sim_summary.json'),
  JSON.stringify(
    {
      n_people_per_scenario: N,
      protocol:
        'wake 07:00 reporting last night (7.5 h; 5 h in debt), 24 h awake (16 h in workday); 50-min task blocks and 10-min breaks; one webcam window per minute from 07:30 (breaks included); PVT every 2 h and 4 min after each check-in; check-ins evenly from 08:30 to 22:30 (workday 21:30), k = 1 at 10:00; MAE every 10 min from 07:30; night = 23:00 to 07:00',
      methods: 'prior = Three-Process Model + time on task (sleep and context entries, no measurements); checkins = prior + KSS check-ins; noanchor = all events without anchor states; twin = released BlinkTwin; oracle = twin given each person\'s true signal baselines and slopes',
      forecast_design: 'one-hour P(KSS >= 7) every hour (12:00 to 05:00; workday 09:00 to 22:00) with k = 3; time of reaching KSS 7 forecast at 17:00; every forecast projects the protocol work rhythm (50-min blocks, 10-min breaks)',
      common_random_numbers: 'person seed independent of k; truth, webcam and 2-hourly PVTs identical across k',
      crn_check: crnCheck,
      twin: 'released defaults (DEFAULT_CONFIG, forward models fitted on DROZY); no parameter tuned on simulated people',
      bootstrap: '2000 person-level resamples, percentile intervals',
      scenarios: Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.label])),
      mae: maeRows,
      forecast: fcRows,
      comparisons,
      sensitivity: sensRows,
      runtime_s: (Date.now() - t0) / 1000,
    },
    null,
    1,
  ),
);
const f3 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : '-');
for (const r of maeRows)
  console.log(
    `${String(r.scenario).padEnd(12)} ${String(r.method).padEnd(9)} k=${r.k}  MAE ${f3(r.mae)} [${f3(r.mae_lo)}, ${f3(r.mae_hi)}]  night ${f3(r.night_mae)}  cov90 ${f3(r.coverage90)}  width ${f3(r.width90)}  win ${f3(r.win_vs_checkins)}`,
  );
for (const r of fcRows)
  console.log(
    `forecast ${String(r.scenario).padEnd(12)} ${String(r.method).padEnd(9)} n=${r.n_forecasts} base ${f3(r.base_rate)} Brier ${f3(r.brier)} BSS ${f3(r.brier_skill_vs_prior)} diff ${f3(r.brier_diff_vs_checkins)} [${f3(r.brier_diff_lo)}, ${f3(r.brier_diff_hi)}] AUROC ${f3(r.auroc)} dAUROC ${f3(r.auroc_diff_vs_checkins)} [${f3(r.auroc_diff_lo)}, ${f3(r.auroc_diff_hi)}] cross ${f3(r.crossing_mae_min)} min (n=${r.crossing_n})`,
  );
for (const c of comparisons) {
  const ci = c.ci as number[];
  console.log(
    `compare ${String(c.scenario).padEnd(12)} ${String(c.a).padEnd(11)} - ${String(c.b).padEnd(11)} ${f3(c.mean_diff)} [${f3(ci[0])}, ${f3(ci[1])}] better ${f3(c.share_a_better)} worse>0.1 ${f3(c.share_a_worse_by_0_1)} p05 ${f3(c.p05)} p50 ${f3(c.p50)} p95 ${f3(c.p95)} night ${f3(c.night_mean_diff)}`,
  );
}
for (const r of sensRows) console.log(`sensitivity ${String(r.param).padEnd(26)} ${String(r.value).padEnd(5)} ${String(r.method).padEnd(9)} MAE ${f3(r.mae)} [${f3(r.mae_lo)}, ${f3(r.mae_hi)}] cov90 ${f3(r.coverage90)} width ${f3(r.width90)}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
