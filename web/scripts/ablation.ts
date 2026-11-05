// Channel ablation for the simulation study: which passive signal carries BlinkTwin's small gain?
//
//   node scripts/ablation.ts [nPeople=300] [outDir=../results]
//
// Same protocol, seeds and evaluation as the 'matched' scenario of scripts/simulate.ts (common random numbers:
// the truth, webcam minutes and 2-hourly reaction tests do not depend on k). BlinkTwin is run with only the
// reaction test, only the webcam (blink duration and PERCLOS), and both channels, at k = 0, 1, 3, 8, and
// compared with check-ins only and with the full model. The 'both' rows must reproduce the BlinkTwin rows of
// results/sim_mae.csv exactly; the script checks this and stops if they differ.
// Writes results/sim_ablation.csv and results/sim_ablation.json (aggregates only).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, POPULATION, simulate, type TruthPoint } from '../src/sim/synth.ts';
import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const N = Number(process.argv[2] ?? 300);
const OUT = process.argv[3] ?? '../results';
const H = 3_600_000;
const M = 60_000;
const START = Date.UTC(2026, 0, 5, 7); // 07:00 UTC; tz offset 0 throughout, as in simulate.ts
const BASE: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const Z90 = 1.645;
const KS = [0, 1, 3, 8];
const AWAKE = 24;

type MethodId = 'checkins' | 'pvt_only' | 'webcam_only' | 'both';
const METHODS: { id: MethodId; label: string; cfg: TwinConfig }[] = [
  { id: 'checkins', label: 'Check-ins only', cfg: { ...BASE, usePassive: false } },
  { id: 'pvt_only', label: 'BlinkTwin, reaction test only', cfg: { ...BASE, useChannels: { blink: false, perclos: false } } },
  { id: 'webcam_only', label: 'BlinkTwin, webcam only (blink duration, PERCLOS)', cfg: { ...BASE, useChannels: { pvt: false } } },
  { id: 'both', label: 'BlinkTwin, both channels', cfg: BASE },
];

function checkInTimes(k: number, lastHour = 15.5): number[] {
  if (k === 0) return [];
  if (k === 1) return [START + 3 * H];
  return Array.from({ length: k }, (_, i) => START + (1.5 + (i * (lastHour - 1.5)) / (k - 1)) * H);
}

function protocolFor(k: number) {
  return { start: START, sleepHours: 7.5, awakeHours: AWAKE, blockMinutes: 50, breakMinutes: 10, checkIns: checkInTimes(k), pvtEveryHours: 2, pvtAfterCheckIn: true, camera: true, tzOffsetMinutes: 0 };
}

function keepEvents(events: TwinEvent[], m: MethodId): TwinEvent[] {
  return m === 'checkins' ? events.filter((e) => e.type !== 'pvt' && e.type !== 'cam') : events;
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

interface PersonResult {
  mae: number;
  coverage: number;
  width: number;
}

/** Same latent-KSS evaluation as simulate.ts (10-min grid from 07:30 to the end of the 24 h). */
function evaluate(events: TwinEvent[], truth: TruthPoint[], cfg: TwinConfig): PersonResult {
  const r = replay(events, cfg, { until: START + AWAKE * H, from: START, stepMinutes: 10 });
  const byT = new Map(truth.map((p) => [p.t, p]));
  const errs: number[] = [];
  const widths: number[] = [];
  let covered = 0;
  for (const s of r.snapshots) {
    if (s.t < START + 30 * M) continue;
    const tr = byT.get(s.t);
    if (!tr) continue;
    const e = Math.abs(s.kss - tr.kss);
    errs.push(e);
    widths.push(2 * Z90 * s.kssSd);
    if (e <= Z90 * Math.max(s.kssSd, 1e-6)) covered++;
  }
  return { mae: mean(errs), coverage: covered / errs.length, width: mean(widths) };
}

const t0 = Date.now();
mkdirSync(OUT, { recursive: true });
const people = Array.from({ length: N }, (_, i) => makePerson(i, mulberry32(1000 + i), POPULATION));
const personSeed = (id: number) => 5000 + id * 31; // as in simulate.ts
const per: Record<string, PersonResult[]> = {};
const rows: Record<string, string | number>[] = [];
const comparisons: Record<string, string | number>[] = [];

for (const k of KS) {
  const sims = people.map((p) => simulate(p, protocolFor(k), mulberry32(personSeed(p.id)), POPULATION));
  for (const m of METHODS) {
    if (m.id === 'checkins' && k === 0) continue;
    const res = people.map((_, i) => evaluate(keepEvents(sims[i].events, m.id), sims[i].truth, m.cfg));
    per[`${m.id}_k${k}`] = res;
    const maes = res.map((r) => r.mae);
    const ci = bootCi(maes, 11 + k); // same seed as simulate.ts, so the 'both' rows match its intervals
    rows.push({ method: m.id, label: m.label, k, mae: mean(maes), mae_lo: ci[0], mae_hi: ci[1], coverage90: mean(res.map((r) => r.coverage)), width90: mean(res.map((r) => r.width)) });
  }
  const pair = (a: string, b: string) => {
    if (!per[a] || !per[b]) return;
    const d = per[a].map((r, i) => r.mae - per[b][i].mae);
    const ci = bootCi(d, 99);
    comparisons.push({ a, b, mean_diff: mean(d), ci_lo: ci[0], ci_hi: ci[1], share_a_better: mean(d.map((v) => (v < 0 ? 1 : 0))) });
  };
  for (const m of ['pvt_only', 'webcam_only', 'both']) pair(`${m}_k${k}`, `checkins_k${k}`);
  for (const m of ['pvt_only', 'webcam_only']) pair(`${m}_k${k}`, `both_k${k}`);
  console.log(`k=${k} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// the full model must reproduce the BlinkTwin rows of the main simulation exactly
const simMae = join(OUT, 'sim_mae.csv');
const reproduction: Record<string, unknown>[] = [];
if (existsSync(simMae)) {
  const [head, ...lines] = readFileSync(simMae, 'utf8').trim().split('\n');
  const cols = head.split(',');
  const recs = lines.map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]+)/g) ?? [];
    return Object.fromEntries(cells.map((c, i) => [cols[i], c.replace(/^"|"$/g, '')]));
  });
  for (const k of KS) {
    const ref = recs.find((r) => r.scenario === 'matched' && r.method === 'twin' && Number(r.k) === k);
    const mine = rows.find((r) => r.method === 'both' && r.k === k);
    if (!ref || !mine) continue;
    const diff = Math.abs(Number(ref.mae) - Number(mine.mae));
    reproduction.push({ k, sim_mae_csv: Number(ref.mae), ablation_both: mine.mae, abs_diff: diff });
    if (diff > 1e-12) {
      console.error(`'both' at k=${k} does not reproduce sim_mae.csv (${mine.mae} vs ${ref.mae}); stopping`);
      process.exit(1);
    }
  }
}

const cell = (v: string | number) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v));
writeFileSync(join(OUT, 'sim_ablation.csv'), [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(cell).join(','))].join('\n') + '\n');
writeFileSync(
  join(OUT, 'sim_ablation.json'),
  JSON.stringify(
    {
      scenario: "matched (as in scripts/simulate.ts), 300 virtual people, 24 h awake, common random numbers",
      methods: Object.fromEntries(METHODS.map((m) => [m.id, m.label])),
      rows,
      comparisons,
      reproduces_sim_mae_csv: reproduction,
      runtime_s: (Date.now() - t0) / 1000,
    },
    null,
    1,
  ),
);
const f3 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : '-');
for (const r of rows) console.log(`${String(r.method).padEnd(12)} k=${r.k}  MAE ${f3(r.mae)} [${f3(r.mae_lo)}, ${f3(r.mae_hi)}]  cov90 ${f3(r.coverage90)}  width ${f3(r.width90)}`);
for (const c of comparisons) console.log(`${String(c.a).padEnd(14)} - ${String(c.b).padEnd(12)} ${f3(c.mean_diff)} [${f3(c.ci_lo)}, ${f3(c.ci_hi)}] better ${f3(c.share_a_better)}`);
for (const r of reproduction) console.log(`reproduction k=${r.k}: |diff| = ${r.abs_diff}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
