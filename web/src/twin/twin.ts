// BlinkTwin's state-space model. Everything the person does is stored as an event; the twin's state at
// any time is rebuilt by replaying those events, so the website, the tests and the simulation study all
// run exactly the same code.
//
// Sleepiness (KSS units): s(t) = prior(t) + gamma * timeOnTask(t) + d(t)
//   prior: Three-Process Model; d: the person's current offset from it (random walk, Kalman-filtered).
//   Observations of d: KSS check-ins directly; reaction time and eye closure through per-person
//   Bayesian regressions that map each feature onto that person's KSS ratings.
// Workload (NASA-TLX units, 0-100): mean-reverting towards the demand of the current context,
//   observed through TLX check-ins and (weakly) blink rate.

import { blrInit, blrPredict, blrUpdate, type Blr } from './blr.ts';
import { clampKss, priorKss, TPM_DEFAULTS, type SleepEpisode, type TpmParams } from './tpm.ts';

export type ContextId = 'unset' | 'break' | 'reading' | 'focus' | 'meeting' | 'other';

export type TwinEvent =
  | { t: number; type: 'sleep'; wake: number; hours: number }
  | { t: number; type: 'context'; context: ContextId }
  | { t: number; type: 'kss'; value: number }
  | { t: number; type: 'tlx'; value: number; items?: number[] }
  | { t: number; type: 'pvt'; medianRt: number; lapses: number; n: number; falseStarts: number }
  | { t: number; type: 'cam'; perclos: number; blinkRate: number; meanBlinkMs: number; coverage: number };

export type Source = 'kss' | 'pvt' | 'cam';

export interface RegressionPrior {
  mean: number[];
  priorSd: number[];
  noiseSd: number;
}

export interface TwinConfig {
  tpm: TpmParams;
  tzOffsetMinutes?: number; // fixed offset for tests and simulations; browser local time if omitted
  defaultWakeHour: number;
  defaultSleepHours: number;
  totPerHour: number; // gamma: KSS points per hour of continuous task
  breakResetMinutes: number;
  kssNoiseSd: number;
  offsetPriorSd: number;
  offsetDriftSdPerSqrtHour: number;
  pvt: RegressionPrior; // KSS ~ a + b * (medianRt - 300) / 100
  cam: RegressionPrior; // KSS ~ a + b1 * perclos% + b2 * (meanBlinkMs - 150) / 100
  camRInflate: number; // camera windows are autocorrelated, so each counts for less
  camMinCoverage: number;
  pairWindowMinutes: { pvt: number; cam: number };
  usePassive: boolean; // false = prior + check-ins only (ablation)
  personalise: boolean; // false = population regressions are never updated (ablation)
  workload: {
    demand: Record<ContextId, number>;
    tlxNoiseSd: number;
    stationarySd: number; // spread of workload around the context's demand
    reversionMinutes: number;
    blink: RegressionPrior; // TLX ~ a + b * (blinkRate - 15)
  };
}

export const DEFAULT_CONFIG: TwinConfig = {
  tpm: TPM_DEFAULTS,
  defaultWakeHour: 7,
  defaultSleepHours: 7.5,
  totPerHour: 0.4,
  breakResetMinutes: 10,
  kssNoiseSd: 0.75,
  offsetPriorSd: 1.2,
  offsetDriftSdPerSqrtHour: 0.3,
  pvt: { mean: [4.5, 1.5], priorSd: [1.2, 0.8], noiseSd: 1.5 },
  cam: { mean: [4.0, 0.25, 1.0], priorSd: [1.2, 0.15, 0.8], noiseSd: 1.7 },
  camRInflate: 4,
  camMinCoverage: 0.6,
  pairWindowMinutes: { pvt: 30, cam: 5 },
  usePassive: true,
  personalise: true,
  workload: {
    demand: { unset: 40, break: 15, reading: 40, focus: 65, meeting: 50, other: 40 },
    tlxNoiseSd: 8,
    stationarySd: 18,
    reversionMinutes: 20,
    blink: { mean: [50, -1.0], priorSd: [15, 1.0], noiseSd: 18 },
  },
};

export interface Snapshot {
  t: number;
  prior: number;
  tot: number;
  offset: number;
  offsetSd: number;
  kss: number;
  kssSd: number;
  workload: number;
  workloadSd: number;
  context: ContextId;
}

export interface TwinResult {
  snapshots: Snapshot[];
  now: Snapshot;
  contributions: Record<Source, number>;
  calibration: { pvt: Blr; cam: Blr; blink: Blr };
  sleep: SleepEpisode;
  taskStart: number | null;
  context: ContextId;
  checkIns: number;
}

const HOUR = 3_600_000;
const MIN = 60_000;

export function pvtFeatures(medianRt: number): number[] {
  return [1, (medianRt - 300) / 100];
}

export function camFeatures(perclos: number, meanBlinkMs: number): number[] {
  return [1, perclos * 100, (meanBlinkMs - 150) / 100];
}

export function blinkFeatures(blinkRate: number): number[] {
  return [1, blinkRate - 15];
}

function defaultSleep(t: number, cfg: TwinConfig): SleepEpisode {
  const tz = cfg.tzOffsetMinutes ?? new Date(t).getTimezoneOffset();
  const local = t - tz * MIN;
  const dayStart = local - (((local % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR));
  let wake = dayStart + cfg.defaultWakeHour * HOUR + tz * MIN;
  if (wake > t) wake -= 24 * HOUR;
  return { wake, hours: cfg.defaultSleepHours };
}

function taskHours(t: number, ctx: ContextId, taskStart: number | null): number {
  if (ctx === 'break' || ctx === 'unset' || taskStart === null) return 0;
  return Math.max(0, (t - taskStart) / HOUR);
}

/** Replays events up to `until` and returns the twin's trajectory on a regular grid plus its final state. */
export function replay(
  events: TwinEvent[],
  cfg: TwinConfig = DEFAULT_CONFIG,
  opts: { until: number; from?: number; stepMinutes?: number },
): TwinResult {
  const sorted = [...events].filter((e) => e.t <= opts.until).sort((a, b) => a.t - b.t);
  const start = opts.from ?? (sorted.length ? sorted[0].t : opts.until);
  const step = (opts.stepMinutes ?? 5) * MIN;

  let sleep = defaultSleep(start, cfg);
  let context: ContextId = 'unset';
  let taskStart: number | null = null;
  let breakStart: number | null = null;
  let frozenTot = 0;
  let d = 0;
  let dVar = cfg.offsetPriorSd ** 2;
  let w = cfg.workload.demand.unset;
  let wVar = 20 ** 2;
  const tlxByContext: Record<string, number[]> = {};
  let pvtModel = blrInit(cfg.pvt.mean, cfg.pvt.priorSd, cfg.pvt.noiseSd);
  let camModel = blrInit(cfg.cam.mean, cfg.cam.priorSd, cfg.cam.noiseSd);
  let blinkModel = blrInit(cfg.workload.blink.mean, cfg.workload.blink.priorSd, cfg.workload.blink.noiseSd);
  const contributions: Record<Source, number> = { kss: 0, pvt: 0, cam: 0 };
  let lastPvt: Extract<TwinEvent, { type: 'pvt' }> | null = null;
  let lastCam: Extract<TwinEvent, { type: 'cam' }> | null = null;
  let checkIns = 0;
  let clock = start;
  const snapshots: Snapshot[] = [];

  const demand = (ctx: ContextId) => {
    const seen = tlxByContext[ctx] ?? [];
    const base = cfg.workload.demand[ctx];
    return (base * 2 + seen.reduce((s, v) => s + v, 0)) / (2 + seen.length);
  };
  const tot = (t: number) => {
    if (context === 'break' && breakStart !== null) {
      return t - breakStart >= cfg.breakResetMinutes * MIN ? 0 : frozenTot;
    }
    return taskHours(t, context, taskStart);
  };
  const advance = (to: number) => {
    const dtH = Math.max(0, (to - clock) / HOUR);
    if (dtH === 0) return;
    dVar += cfg.offsetDriftSdPerSqrtHour ** 2 * dtH;
    const alpha = Math.exp((-dtH * 60) / cfg.workload.reversionMinutes);
    const mu = demand(context);
    w = mu + (w - mu) * alpha;
    // Ornstein-Uhlenbeck around the context demand: stationary variance = stationarySd^2
    wVar = wVar * alpha * alpha + cfg.workload.stationarySd ** 2 * (1 - alpha * alpha);
    clock = to;
  };
  const prior = (t: number) => priorKss(t, sleep, cfg.tpm, cfg.tzOffsetMinutes);
  const updateOffset = (z: number, r: number, source: Source) => {
    const gain = dVar / (dVar + r);
    const delta = gain * (z - d);
    d += delta;
    dVar *= 1 - gain;
    contributions[source] += delta;
  };
  const snap = (t: number): Snapshot => {
    const p = prior(t);
    const tt = tot(t) * cfg.totPerHour;
    return {
      t,
      prior: p,
      tot: tt,
      offset: d,
      offsetSd: Math.sqrt(dVar),
      kss: clampKss(p + tt + d),
      kssSd: Math.sqrt(dVar),
      workload: Math.min(100, Math.max(0, w)),
      workloadSd: Math.sqrt(wVar),
      context,
    };
  };
  const emitUntil = (to: number) => {
    let next = snapshots.length ? snapshots[snapshots.length - 1].t + step : start;
    while (next <= to) {
      advance(next);
      snapshots.push(snap(next));
      next += step;
    }
    advance(to);
  };

  for (const e of sorted) {
    emitUntil(e.t);
    switch (e.type) {
      case 'sleep':
        sleep = { wake: e.wake, hours: e.hours };
        break;
      case 'context': {
        if (e.context === context) break;
        if (e.context === 'break') {
          frozenTot = tot(e.t);
          breakStart = e.t;
        } else if (context === 'break') {
          const longBreak = breakStart !== null && e.t - breakStart >= cfg.breakResetMinutes * MIN;
          taskStart = longBreak || taskStart === null ? e.t : taskStart;
          breakStart = null;
        } else if (taskStart === null) {
          taskStart = e.t;
        }
        context = e.context;
        break;
      }
      case 'kss': {
        checkIns++;
        const base = prior(e.t) + tot(e.t) * cfg.totPerHour;
        updateOffset(e.value - base, cfg.kssNoiseSd ** 2, 'kss');
        if (cfg.personalise) {
          if (lastPvt && e.t - lastPvt.t <= cfg.pairWindowMinutes.pvt * MIN) {
            pvtModel = blrUpdate(pvtModel, pvtFeatures(lastPvt.medianRt), e.value);
          }
          if (lastCam && e.t - lastCam.t <= cfg.pairWindowMinutes.cam * MIN && lastCam.coverage >= cfg.camMinCoverage) {
            camModel = blrUpdate(camModel, camFeatures(lastCam.perclos, lastCam.meanBlinkMs), e.value);
          }
        }
        break;
      }
      case 'tlx': {
        (tlxByContext[context] ??= []).push(e.value);
        const r = cfg.workload.tlxNoiseSd ** 2;
        const g = wVar / (wVar + r);
        w += g * (e.value - w);
        wVar *= 1 - g;
        if (cfg.personalise && lastCam && e.t - lastCam.t <= cfg.pairWindowMinutes.cam * MIN) {
          blinkModel = blrUpdate(blinkModel, blinkFeatures(lastCam.blinkRate), e.value);
        }
        break;
      }
      case 'pvt': {
        lastPvt = e;
        if (!cfg.usePassive) break;
        const pred = blrPredict(pvtModel, pvtFeatures(e.medianRt));
        const base = prior(e.t) + tot(e.t) * cfg.totPerHour;
        updateOffset(pred.mean - base, pred.variance, 'pvt');
        break;
      }
      case 'cam': {
        lastCam = e;
        if (!cfg.usePassive || e.coverage < cfg.camMinCoverage) break;
        const pred = blrPredict(camModel, camFeatures(e.perclos, e.meanBlinkMs));
        const base = prior(e.t) + tot(e.t) * cfg.totPerHour;
        updateOffset(pred.mean - base, pred.variance * cfg.camRInflate, 'cam');
        const wl = blrPredict(blinkModel, blinkFeatures(e.blinkRate));
        const r = wl.variance * cfg.camRInflate;
        const g = wVar / (wVar + r);
        w += g * (wl.mean - w);
        wVar *= 1 - g;
        break;
      }
    }
  }
  emitUntil(opts.until);

  return {
    snapshots,
    now: snap(opts.until),
    contributions,
    calibration: { pvt: pvtModel, cam: camModel, blink: blinkModel },
    sleep,
    taskStart,
    context,
    checkIns,
  };
}

export interface ForecastPoint {
  t: number;
  kss: number;
  kssSd: number;
  pSleepy: number; // probability that latent KSS >= 7
  asleep: boolean;
}

export interface Scenario {
  breakNow?: boolean;
  sleepAt?: number; // epoch ms
  sleepHours?: number;
}

/** Projects the twin forward. The offset is carried forward with growing uncertainty. */
export function forecast(
  r: TwinResult,
  cfg: TwinConfig = DEFAULT_CONFIG,
  opts: { hours?: number; stepMinutes?: number; scenario?: Scenario } = {},
): { points: ForecastPoint[]; sleepyAt: number | null } {
  const step = (opts.stepMinutes ?? 10) * MIN;
  const end = r.now.t + (opts.hours ?? 12) * HOUR;
  const sc = opts.scenario ?? {};
  const points: ForecastPoint[] = [];
  let sleepyAt: number | null = null;
  const inTask = r.context !== 'break' && r.context !== 'unset' && !sc.breakNow;
  const tot0 = sc.breakNow ? 0 : r.now.tot / Math.max(cfg.totPerHour, 1e-9);
  for (let t = r.now.t; t <= end; t += step) {
    const sleeping = sc.sleepAt !== undefined && t >= sc.sleepAt && t < sc.sleepAt + (sc.sleepHours ?? 7.5) * HOUR;
    const sleep =
      sc.sleepAt !== undefined && t >= sc.sleepAt + (sc.sleepHours ?? 7.5) * HOUR
        ? { wake: sc.sleepAt + (sc.sleepHours ?? 7.5) * HOUR, hours: sc.sleepHours ?? 7.5 }
        : r.sleep;
    const dtH = (t - r.now.t) / HOUR;
    const afterSleep = sleep !== r.sleep;
    const totH = afterSleep ? 0 : inTask ? tot0 + dtH : sc.breakNow ? 0 : tot0;
    const mean = clampKss(priorKss(t, sleep, cfg.tpm, cfg.tzOffsetMinutes) + totH * cfg.totPerHour + r.now.offset);
    const sd = Math.sqrt(r.now.offsetSd ** 2 + cfg.offsetDriftSdPerSqrtHour ** 2 * dtH);
    const pSleepy = 1 - normalCdf((7 - mean) / sd);
    points.push({ t, kss: mean, kssSd: sd, pSleepy, asleep: sleeping });
    if (!sleeping && sleepyAt === null && mean >= 7) sleepyAt = t;
  }
  return { points, sleepyAt };
}

export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}
