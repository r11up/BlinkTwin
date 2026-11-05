// Calibration of the forecast window shown with the predicted time of reaching KSS 7.
//
//   node scripts/forecast_window.ts [nPeople=300] [outDir=../results]
//
// The app gives the predicted time of reaching KSS 7 together with the times at which the chance of KSS >= 7
// first reaches 1 in 4 and 3 in 4 (forecast().sleepyWindow). If those chances are right, the true time of
// reaching KSS 7 should fall before the window for about a quarter of people, inside it for about half and
// after it for about a quarter. This script checks that in the 'matched' scenario of scripts/simulate.ts
// (same people, seeds and protocol, k = 3 check-ins), with the forecast made at 17:00 over the rest of the
// 24 h, as in that script. It also reproduces simulate.ts's crossing-time errors (results/sim_summary.json)
// and stops if they differ. Writes results/forecast_window.json (aggregates only).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, POPULATION, simulate } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, forecast, replay, SLEEPY_WINDOW, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const N = Number(process.argv[2] ?? 300);
const OUT = process.argv[3] ?? '../results';
const H = 3_600_000;
const M = 60_000;
const START = Date.UTC(2026, 0, 5, 7); // 07:00 UTC; tz offset 0 throughout, as in simulate.ts
const BASE: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const RHYTHM = { breaksEveryMinutes: 50, breakMinutes: 10 };
const AWAKE = 24;
const K = 3;
const FORECAST_AT = START + 10 * H; // 17:00

type MethodId = 'prior' | 'checkins' | 'twin';
const METHODS: { id: MethodId; label: string; cfg: TwinConfig }[] = [
  { id: 'prior', label: 'Rhythm model only', cfg: BASE },
  { id: 'checkins', label: 'Check-ins only', cfg: { ...BASE, usePassive: false } },
  { id: 'twin', label: 'BlinkTwin (anchored)', cfg: BASE },
];

function keepEvents(events: TwinEvent[], m: MethodId): TwinEvent[] {
  if (m === 'prior') return events.filter((e) => e.type === 'sleep' || e.type === 'context');
  if (m === 'checkins') return events.filter((e) => e.type !== 'pvt' && e.type !== 'cam');
  return events;
}

function checkInTimes(k: number, lastHour = 15.5): number[] {
  if (k === 0) return [];
  if (k === 1) return [START + 3 * H];
  return Array.from({ length: k }, (_, i) => START + (1.5 + (i * (lastHour - 1.5)) / (k - 1)) * H);
}

const protocol = { start: START, sleepHours: 7.5, awakeHours: AWAKE, blockMinutes: 50, breakMinutes: 10, checkIns: checkInTimes(K), pvtEveryHours: 2, pvtAfterCheckIn: true, camera: true, tzOffsetMinutes: 0 };
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });
const people = Array.from({ length: N }, (_, i) => makePerson(i, mulberry32(1000 + i), POPULATION));
const personSeed = (id: number) => 5000 + id * 31; // as in simulate.ts
const sims = people.map((p) => simulate(p, protocol, mulberry32(personSeed(p.id)), POPULATION));

const rows: Record<string, string | number | null>[] = [];
for (const m of METHODS) {
  let before = 0;
  let inside = 0;
  let after = 0;
  let noTrueCrossing = 0;
  let windowWithoutCrossing = 0; // the window opened although the person never reached KSS 7 in the horizon
  const widthsMin: number[] = [];
  const crossErr: number[] = [];
  for (const { events, truth } of sims) {
    const r = replay(keepEvents(events, m.id), m.cfg, { until: FORECAST_AT, from: START, stepMinutes: 60 });
    const f = forecast(r, m.cfg, { hours: Math.min(12, AWAKE - 10), stepMinutes: 10, scenario: RHYTHM });
    const trueCross = truth.find((p) => p.t >= FORECAST_AT && p.kss >= 7)?.t ?? null;
    if (f.sleepyAt !== null && trueCross !== null) crossErr.push(Math.abs(f.sleepyAt - trueCross) / M);
    const { from, to } = f.sleepyWindow;
    if (from !== null && to !== null) widthsMin.push((to - from) / M);
    if (trueCross === null) {
      noTrueCrossing++;
      if (from !== null) windowWithoutCrossing++;
      continue;
    }
    // a window end that is not reached within the horizon lies beyond it
    if (from === null || trueCross < from) before++;
    else if (to === null || trueCross <= to) inside++;
    else after++;
  }
  const crossed = before + inside + after;
  rows.push({
    method: m.id,
    label: m.label,
    people: N,
    reached_kss7_in_horizon: crossed,
    before_window: before / crossed,
    inside_window: inside / crossed,
    after_window: after / crossed,
    median_window_width_min: median(widthsMin),
    windows_with_both_ends: widthsMin.length,
    no_crossing_in_horizon: noTrueCrossing,
    window_opened_without_crossing: windowWithoutCrossing,
    crossing_mae_min: mean(crossErr),
    crossing_n: crossErr.length,
  });
}

// the crossing-time errors must match the main simulation (same people and forecasts)
const summaryPath = join(OUT, 'sim_summary.json');
const reproduction: Record<string, number>[] = [];
if (existsSync(summaryPath)) {
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as { forecast: { scenario: string; method: string; crossing_mae_min: number; crossing_n: number }[] };
  for (const row of rows) {
    const ref = summary.forecast.find((f) => f.scenario === 'matched' && f.method === row.method);
    if (!ref) continue;
    const diff = Math.abs(ref.crossing_mae_min - (row.crossing_mae_min as number));
    reproduction.push({ method_index: METHODS.findIndex((m) => m.id === row.method), sim_summary: ref.crossing_mae_min, here: row.crossing_mae_min as number, abs_diff: diff });
    if (diff > 1e-9 || ref.crossing_n !== row.crossing_n) {
      console.error(`${row.method}: crossing error ${row.crossing_mae_min} (n ${row.crossing_n}) does not reproduce sim_summary.json (${ref.crossing_mae_min}, n ${ref.crossing_n}); stopping`);
      process.exit(1);
    }
  }
}

writeFileSync(
  join(OUT, 'forecast_window.json'),
  JSON.stringify(
    {
      design: `matched scenario of scripts/simulate.ts, ${N} virtual people, k = ${K} check-ins, forecast at 17:00 over the next 12 h with the 50/10 work rhythm; window = first times at which P(KSS >= 7) reaches ${SLEEPY_WINDOW[0]} and ${SLEEPY_WINDOW[1]}; a window end not reached within the horizon counts as beyond it`,
      nominal: { before_window: SLEEPY_WINDOW[0], inside_window: SLEEPY_WINDOW[1] - SLEEPY_WINDOW[0], after_window: 1 - SLEEPY_WINDOW[1] },
      rows,
      reproduces_sim_summary: reproduction.length === rows.length,
      runtime_s: (Date.now() - t0) / 1000,
    },
    null,
    1,
  ) + '\n',
);
const pct = (x: unknown) => (typeof x === 'number' ? `${(100 * x).toFixed(0)}%` : '-');
for (const r of rows)
  console.log(
    `${String(r.method).padEnd(9)} reached ${r.reached_kss7_in_horizon}: before ${pct(r.before_window)}, inside ${pct(r.inside_window)}, after ${pct(r.after_window)}; median width ${Number(r.median_window_width_min).toFixed(0)} min (n ${r.windows_with_both_ends}); no crossing ${r.no_crossing_in_horizon} (window opened ${r.window_opened_without_crossing}); crossing MAE ${Number(r.crossing_mae_min).toFixed(1)} min (n ${r.crossing_n})`,
  );
console.log(`reproduces sim_summary.json: ${reproduction.length === rows.length}; done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
