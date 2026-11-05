// Simulation study for the paper. Runs the shipped twin (src/twin) on virtual participants with a known
// ground truth (src/sim/synth.ts) and writes summary tables to results/.
//
//   node scripts/simulate.ts [nPeople=300] [outDir=../results]
//
// Protocol: wake 07:00 after 7.5 h sleep, then 24 h awake (an extended-wake day that spans alert to very
// sleepy), 50-min task blocks with 10-min breaks, webcam on during tasks, a reaction test every 2 h and
// before each check-in. Check-ins (KSS + TLX) are spread evenly over the first 16 h.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePerson, mulberry32, simulate, type TruthPoint } from '../src/sim/synth.ts';
import { camFeatures, DEFAULT_CONFIG, forecast, pvtFeatures, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const N = Number(process.argv[2] ?? 300);
const N_TRAIN = 200; // separate cohort used only to fit the population mappings
const OUT = process.argv[3] ?? '../results';
const H = 3_600_000;
const M = 60_000;
const START = Date.UTC(2026, 0, 5, 7); // 07:00 UTC; tz offset 0 throughout
// --- population mappings, fitted on a separate training cohort -------------------------------------
// Ordinary least squares of KSS on each feature, pooled over the training cohort; prior SDs of the
// weights come from the spread of per-person fits; noise SD from pooled residuals. This mirrors how the
// website's defaults are fitted on public data.

function ols(X: number[][], y: number[]): { w: number[]; resid: number[] } {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  for (let n = 0; n < X.length; n++) {
    for (let i = 0; i < k; i++) {
      v[i] += X[n][i] * y[n];
      for (let j = 0; j < k; j++) A[i][j] += X[n][i] * X[n][j];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-6;
  // Gauss-Jordan solve
  const M = A.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  const w = M.map((row, i) => row[k] / row[i]);
  return { w, resid: y.map((yy, n) => yy - X[n].reduce((s2, x2, i) => s2 + x2 * w[i], 0)) };
}

function invert(A: number[][]): number[][] {
  const k = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(k));
}

/** OLS weights with their sampling variances (sigma^2 * diag((X'X)^-1)). */
function olsSe(X: number[][], y: number[]): { w: number[]; se2: number[] } {
  const { w, resid } = ols(X, y);
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s2, row) => s2 + row[i] * row[j], 0) + (i === j ? 1e-6 : 0)));
  const inv = invert(XtX);
  const s2 = resid.reduce((a2, r) => a2 + r * r, 0) / Math.max(1, X.length - k);
  return { w, se2: inv.map((row, i) => s2 * row[i]) };
}

/** Between-person SD of each weight, with the per-person estimation noise removed (method of moments). */
function trueSpread(fits: { w: number[]; se2: number[] }[], j: number, floor: number): number {
  const ws = fits.map((f) => f.w[j]);
  const m = ws.reduce((a2, b2) => a2 + b2, 0) / ws.length;
  const total = ws.reduce((a2, b2) => a2 + (b2 - m) ** 2, 0) / Math.max(1, ws.length - 1);
  const noise = fits.reduce((a2, f) => a2 + f.se2[j], 0) / fits.length;
  return Math.sqrt(Math.max(floor ** 2, total - noise));
}

function sdOf(v: number[]) {
  const m = v.reduce((a2, b2) => a2 + b2, 0) / v.length;
  return Math.sqrt(v.reduce((a2, b2) => a2 + (b2 - m) ** 2, 0) / Math.max(1, v.length - 1));
}

function fitPopulation(): Pick<TwinConfig, 'pvt' | 'cam'> {
  const pvtX: number[][] = [];
  const pvtY: number[] = [];
  const camX: number[][] = [];
  const camY: number[] = [];
  const perPvt: { w: number[]; se2: number[] }[] = [];
  const perCam: { w: number[]; se2: number[] }[] = [];
  for (let i = 0; i < N_TRAIN; i++) {
    const person = makePerson(100_000 + i, mulberry32(900_000 + i));
    const times = Array.from({ length: 9 }, (_, j) => START + (2 + j * 2.5) * H);
    const sim = simulate(person, { ...protocolFor(0), checkIns: times }, mulberry32(700_000 + i));
    const kss = sim.events.filter((e): e is Extract<TwinEvent, { type: 'kss' }> => e.type === 'kss');
    const px: number[][] = [];
    const py: number[] = [];
    const cx: number[][] = [];
    const cy: number[] = [];
    for (const r of kss) {
      const pv = sim.events.find((e): e is Extract<TwinEvent, { type: 'pvt' }> => e.type === 'pvt' && Math.abs(e.t - (r.t - 4 * M)) < 1000);
      if (pv) {
        px.push(pvtFeatures(pv.medianRt));
        py.push(r.value);
      }
      const cams = sim.events.filter((e): e is Extract<TwinEvent, { type: 'cam' }> => e.type === 'cam' && e.t <= r.t && e.t > r.t - 15 * M);
      if (cams.length) {
        const pc = cams.reduce((s2, c) => s2 + c.perclos, 0) / cams.length;
        const bm = cams.reduce((s2, c) => s2 + c.meanBlinkMs, 0) / cams.length;
        cx.push(camFeatures(pc, bm));
        cy.push(r.value);
      }
    }
    pvtX.push(...px);
    pvtY.push(...py);
    camX.push(...cx);
    camY.push(...cy);
    if (px.length >= 5) perPvt.push(olsSe(px, py));
    if (cx.length >= 6) perCam.push(olsSe(cx, cy));
  }
  const p = ols(pvtX, pvtY);
  const c = ols(camX, camY);
  return {
    pvt: { mean: p.w, priorSd: p.w.map((w, j) => trueSpread(perPvt, j, 0.05 * Math.abs(w) + 0.02)), noiseSd: sdOf(p.resid) },
    cam: { mean: c.w, priorSd: c.w.map((w, j) => trueSpread(perCam, j, 0.05 * Math.abs(w) + 0.02)), noiseSd: sdOf(c.resid) },
  };
}

const POP = fitPopulation();
const UNTUNED: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0, ...POP };

// Camera weight: each one-minute window is autocorrelated with the next, so it must count for less than
// an independent observation. Chosen on a separate tuning cohort, never on the test participants.
const sens: Record<string, string | number>[] = [];
function tuneCamera(): number {
  const tuners = Array.from({ length: 120 }, (_, i) => makePerson(200_000 + i, mulberry32(300_000 + i)));
  let best = { inflate: 4, mae: Infinity };
  for (const inflate of [1, 4, 10, 20, 40, 80, 160, 320, 640, 1280, 1e9]) {
    const maes = tuners.map((p) => {
      const sim = simulate(p, protocolFor(3), mulberry32(400_000 + p.id));
      return evaluate(sim.events, sim.truth, { ...UNTUNED, camRInflate: inflate }).mae;
    });
    const m = maes.reduce((a2, b2) => a2 + b2, 0) / maes.length;
    sens.push({ camRInflate: inflate, k: 3, mae: m, cohort: 'tuning' });
    console.log(`tuning camRInflate=${inflate}  MAE ${m.toFixed(3)}`);
    if (m < best.mae) best = { inflate, mae: m };
  }
  return best.inflate;
}
const CAM_INFLATE = tuneCamera();
const BASE: TwinConfig = { ...UNTUNED, camRInflate: CAM_INFLATE };
console.log('camera weight chosen on tuning cohort: camRInflate =', CAM_INFLATE);
console.log('population mappings fitted on training cohort:', JSON.stringify(POP));
const KS = [0, 1, 2, 3, 4, 6, 8];

interface Method {
  id: string;
  label: string;
  cfg: TwinConfig;
  passive: boolean; // keep PVT and camera events
  checkIns: boolean; // keep KSS/TLX events
}

const NO_ANCHOR = { biasPriorSd: 1e-4, biasDriftSdPerSqrtHour: 0 };
const METHODS: Method[] = [
  { id: 'prior', label: 'Rhythm model only', cfg: BASE, passive: false, checkIns: false },
  { id: 'checkins', label: 'Check-ins only', cfg: { ...BASE, usePassive: false }, passive: false, checkIns: true },
  { id: 'passive', label: 'Passive signals only (population mapping)', cfg: { ...BASE, ...NO_ANCHOR, personalise: false }, passive: true, checkIns: false },
  { id: 'noanchor', label: 'Check-ins + passive, no anchoring', cfg: { ...BASE, ...NO_ANCHOR, personalise: false }, passive: true, checkIns: true },
  { id: 'anchor', label: 'BlinkTwin: check-ins anchor passive signals', cfg: { ...BASE, personalise: false }, passive: true, checkIns: true },
  { id: 'slopes', label: 'BlinkTwin + personal slopes', cfg: { ...BASE, personalise: true }, passive: true, checkIns: true },
];

function checkInTimes(k: number): number[] {
  if (k === 0) return [];
  return Array.from({ length: k }, (_, i) => START + (1.5 + (i * 14) / Math.max(1, k - 1 || 1)) * H).map((t, i, a) => (k === 1 ? START + 3 * H : t));
}

function filterEvents(events: TwinEvent[], m: Method): TwinEvent[] {
  return events.filter((e) => {
    if (e.type === 'pvt' || e.type === 'cam') return m.passive;
    if (e.type === 'kss' || e.type === 'tlx') return m.checkIns;
    return true;
  });
}

function mean(v: number[]) {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function bootCi(v: number[], rng: () => number, B = 1000): [number, number] {
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
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function evaluate(events: TwinEvent[], truth: TruthPoint[], cfg: TwinConfig) {
  const r = replay(events, cfg, { until: START + 24 * H, from: START, stepMinutes: 10 });
  const byT = new Map(truth.map((p) => [p.t, p]));
  const errs: number[] = [];
  const nightErrs: number[] = [];
  let covered = 0;
  for (const s of r.snapshots) {
    if (s.t < START + 30 * M) continue;
    const tr = byT.get(s.t);
    if (!tr) continue;
    const e = Math.abs(s.kss - tr.kss);
    errs.push(e);
    if (s.t >= START + 16 * H) nightErrs.push(e);
    if (e <= 1.645 * Math.max(s.kssSd, 1e-6)) covered++;
  }
  return { mae: mean(errs), nightMae: mean(nightErrs), coverage: covered / errs.length };
}

function forecastEval(events: TwinEvent[], truth: TruthPoint[], cfg: TwinConfig) {
  const byT = new Map(truth.map((p) => [p.t, p]));
  const out: { p: number; y: boolean; crossErrMin: number | null }[] = [];
  for (let h = 5; h <= 22; h++) {
    const t0 = START + h * H;
    const r = replay(events, cfg, { until: t0, from: START, stepMinutes: 30 });
    const f = forecast(r, cfg, { hours: 1, stepMinutes: 60 });
    const target = f.points[f.points.length - 1];
    const tr = byT.get(t0 + H);
    if (!tr) continue;
    out.push({ p: target.pSleepy, y: tr.kss >= 7, crossErrMin: null });
  }
  return out;
}

function trueCrossing(truth: TruthPoint[]): number | null {
  const p = truth.find((x) => x.kss >= 7 && x.t > START + 2 * H);
  return p ? p.t : null;
}

mkdirSync(OUT, { recursive: true });
const rows: Record<string, string | number>[] = [];
const perPerson: Record<string, number[]> = {};
const rng = mulberry32(2026);

const people = Array.from({ length: N }, (_, i) => makePerson(i, mulberry32(1000 + i)));
const sims = new Map<number, ReturnType<typeof simulate>>();
for (const k of KS) {
  for (const p of people) {
    const sim = simulate(p, protocolFor(k), mulberry32(5000 + p.id * 31 + k));
    sims.set(p.id * 100 + k, sim);
  }
}

function protocolFor(k: number) {
  return {
    start: START,
    sleepHours: 7.5,
    awakeHours: 24,
    blockMinutes: 50,
    breakMinutes: 10,
    checkIns: checkInTimes(k),
    pvtEveryHours: 2,
    pvtBeforeCheckIn: true,
    camera: true,
    tzOffsetMinutes: 0,
  };
}

const t0 = Date.now();
for (const m of METHODS) {
  for (const k of KS) {
    if ((m.id === 'prior' || m.id === 'passive') && k > 0) continue;
    if (m.id !== 'prior' && m.id !== 'passive' && m.id !== 'anchor' && k === 0) continue;
    const maes: number[] = [];
    const nights: number[] = [];
    const covs: number[] = [];
    for (const p of people) {
      const sim = sims.get(p.id * 100 + k) as ReturnType<typeof simulate>;
      const ev = evaluate(filterEvents(sim.events, m), sim.truth, m.cfg);
      maes.push(ev.mae);
      nights.push(ev.nightMae);
      covs.push(ev.coverage);
    }
    perPerson[`${m.id}_k${k}`] = maes;
    const ci = bootCi(maes, rng);
    rows.push({ method: m.id, label: m.label, k, mae: mean(maes), mae_lo: ci[0], mae_hi: ci[1], night_mae: mean(nights), coverage90: mean(covs) });
    console.log(`${m.id.padEnd(11)} k=${k}  MAE ${mean(maes).toFixed(3)} [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]  night ${mean(nights).toFixed(3)}  cov90 ${mean(covs).toFixed(3)}`);
  }
}

// Forecast of KSS >= 7 one hour ahead, k = 4
const fc: Record<string, string | number>[] = [];
for (const m of METHODS.filter((x) => ['prior', 'checkins', 'noanchor', 'anchor', 'slopes'].includes(x.id))) {
  const ps: number[] = [];
  const ys: boolean[] = [];
  for (const p of people) {
    const sim = sims.get(p.id * 100 + 4) as ReturnType<typeof simulate>;
    for (const o of forecastEval(filterEvents(sim.events, m), sim.truth, m.cfg)) {
      ps.push(o.p);
      ys.push(o.y);
    }
  }
  const brier = mean(ps.map((p, i) => (p - (ys[i] ? 1 : 0)) ** 2));
  const base = mean(ys.map((y) => (y ? 1 : 0)));
  fc.push({ method: m.id, label: m.label, n: ps.length, prevalence: base, brier, brier_climatology: base * (1 - base), auroc: auroc(ps, ys) });
  console.log(`forecast ${m.id.padEnd(11)} Brier ${brier.toFixed(3)} (climatology ${(base * (1 - base)).toFixed(3)})  AUROC ${auroc(ps, ys).toFixed(3)}`);
}

// Paired comparison: full vs prior and vs no personal calibration at k = 4
const paired = (a: string, b: string) => {
  const x = perPerson[a];
  const y = perPerson[b];
  const d = x.map((v, i) => v - y[i]);
  const ci = bootCi(d, rng);
  return { a, b, mean_diff: mean(d), ci, share_a_better: mean(d.map((v) => (v < 0 ? 1 : 0))) };
};
const comparisons = [
  paired('anchor_k3', 'prior_k0'),
  paired('checkins_k3', 'prior_k0'),
  paired('noanchor_k1', 'checkins_k1'),
  paired('anchor_k1', 'checkins_k1'),
  paired('anchor_k1', 'noanchor_k1'),
  paired('anchor_k3', 'checkins_k3'),
  paired('anchor_k8', 'checkins_k8'),
  paired('slopes_k8', 'anchor_k8'),
  paired('anchor_k0', 'prior_k0'),
  paired('passive_k0', 'prior_k0'),
];

const cell = (v: string | number) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v));
const toCsv = (rs: Record<string, string | number>[]) => [Object.keys(rs[0]).join(','), ...rs.map((r) => Object.values(r).map(cell).join(','))].join('\n');
writeFileSync(join(OUT, 'sim_mae.csv'), toCsv(rows));
writeFileSync(join(OUT, 'sim_camera_weight.csv'), toCsv(sens));
writeFileSync(join(OUT, 'sim_forecast.csv'), toCsv(fc));
writeFileSync(
  join(OUT, 'sim_summary.json'),
  JSON.stringify({ n_people: N, n_train: N_TRAIN, population_mappings: POP, protocol: 'wake 07:00 after 7.5 h sleep, 24 h awake; PVT every 2 h and before each check-in; webcam during 50-min task blocks', config: { camRInflate: BASE.camRInflate, totPerHour: BASE.totPerHour, kssNoiseSd: BASE.kssNoiseSd }, mae: rows, camera_weight: sens, forecast: fc, comparisons, runtime_s: (Date.now() - t0) / 1000 }, null, 2),
);
console.log(JSON.stringify(comparisons, null, 1));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
