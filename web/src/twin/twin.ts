// BlinkTwin's state-space model. Everything the person does is stored as an event; the twin's state at
// any time is rebuilt by replaying those events, so the website, the tests and the simulation study all
// run exactly the same code.
//
// Sleepiness (KSS units): s(t) = prior(t) + gamma * timeOnTask(t) + d(t)
//   prior: Three-Process Model; d: the person's current offset from it (random walk, Kalman-filtered).
//   Observations: KSS check-ins observe d directly. Each passive signal has a forward measurement model,
//   feature = a + b * (s - 3) + anchor + noise, where the anchor is that person's own baseline for the
//   signal (a random walk in the state). Check-ins set the level; passive signals track change.
// Workload (NASA-TLX units, 0-100): mean-reverting towards the demand of the current context,
//   observed through TLX check-ins.

import { clampKss, priorKss, TPM_DEFAULTS, type SleepEpisode, type TpmParams } from './tpm.ts';

export type ContextId = 'unset' | 'break' | 'reading' | 'focus' | 'meeting' | 'other';

export type TwinEvent =
  | { t: number; type: 'sleep'; wake: number; hours: number }
  | { t: number; type: 'context'; context: ContextId }
  | { t: number; type: 'kss'; value: number }
  | { t: number; type: 'tlx'; value: number; items?: number[] }
  | { t: number; type: 'pvt'; medianRt: number; lapses: number; n: number; falseStarts: number }
  | { t: number; type: 'cam'; perclos: number; blinkRate: number; meanBlinkMs: number; coverage: number; nods?: number; headMovement?: number }
  | { t: number; type: 'alert'; level: 'warning' | 'alarm'; reason: string };

export type Source = 'kss' | 'pvt' | 'cam';
export type ChannelId = 'pvt' | 'blink' | 'perclos';

/** Forward measurement model of one passive signal, in the signal's own units. */
export interface Channel {
  at3: number; // population mean of the feature at KSS 3
  perKss: number; // within-person change per KSS point
  noiseSd: number; // noise of one observation around the person's own line
  inflate: number; // variance inflation for serially correlated observations, (1 + rho) / (1 - rho)
  biasSd: number; // between-person spread of the baseline: prior SD of the anchor
  biasDriftSdPerSqrtHour: number; // slow drift of the anchor (session-to-session change)
  slopeSd: number; // between-person spread of the slope, added to the measurement variance
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
  channels: Record<ChannelId, Channel>;
  minBlinksForDuration: number; // a minute with fewer blinks says nothing about blink duration
  camMinCoverage: number;
  usePassive: boolean; // false = prior + check-ins only (ablation)
  useChannels?: Partial<Record<ChannelId, boolean>>; // switch single passive channels off (ablation)
  useAnchors: boolean; // false = passive signals use the population baseline (ablation)
  workload: {
    demand: Record<ContextId, number>;
    tlxNoiseSd: number;
    stationarySd: number; // spread of workload around the context's demand
    reversionMinutes: number;
  };
}

// Forward models fitted on DROZY (14 adults, 36 tests under increasing sleep deprivation; within-person
// slopes with subject fixed effects): analysis/drozy_forward.py -> results/drozy_forward.json. Slope SDs are the
// raw spread of per-person slopes (three sessions each), a conservative upper bound: with three points per
// person the spread due to estimation noise cannot be separated reliably.
export const DEFAULT_CONFIG: TwinConfig = {
  tpm: TPM_DEFAULTS,
  defaultWakeHour: 7,
  defaultSleepHours: 7.5,
  totPerHour: 0.4,
  breakResetMinutes: 10,
  kssNoiseSd: 0.75,
  offsetPriorSd: 1.2,
  offsetDriftSdPerSqrtHour: 0.3,
  channels: {
    pvt: { at3: 339.2, perKss: 18.85, noiseSd: 36.4, inflate: 1, biasSd: 48.7, biasDriftSdPerSqrtHour: 2, slopeSd: 7.9 },
    blink: { at3: 189.7, perKss: 11.1, noiseSd: 24.6, inflate: 1.04, biasSd: 22.9, biasDriftSdPerSqrtHour: 15, slopeSd: 14.3 },
    perclos: { at3: 3.24, perKss: 0.62, noiseSd: 2.4, inflate: 1.93, biasSd: 2.38, biasDriftSdPerSqrtHour: 0.83, slopeSd: 0.47 },
  },
  minBlinksForDuration: 3,
  camMinCoverage: 0.6,
  usePassive: true,
  useAnchors: true,
  workload: {
    demand: { unset: 40, break: 15, reading: 40, focus: 65, meeting: 50, other: 40 },
    tlxNoiseSd: 8,
    stationarySd: 18,
    reversionMinutes: 20,
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
  /** Each passive signal's anchor: how far this person's baseline sits from the population, in the signal's units. */
  anchors: Record<ChannelId, { mean: number; sd: number }>;
  sleep: SleepEpisode;
  sleeps: SleepEpisode[]; // all recorded sleep episodes, oldest first (sleep debt carries across days)
  taskStart: number | null;
  context: ContextId;
  checkIns: number;
}

const HOUR = 3_600_000;
const MIN = 60_000;

const CH: ChannelId[] = ['pvt', 'blink', 'perclos'];

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
  const sleeps: SleepEpisode[] = [];
  let context: ContextId = 'unset';
  let taskStart: number | null = null;
  let breakStart: number | null = null;
  let frozenTot = 0;
  // state x = [offset d, anchor of reaction time, anchor of blink duration, anchor of PERCLOS]
  const n = 1 + CH.length;
  const x = new Array(n).fill(0);
  const P = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i !== j ? 0 : i === 0 ? cfg.offsetPriorSd ** 2 : cfg.useAnchors ? cfg.channels[CH[i - 1]].biasSd ** 2 : 0)),
  );
  let w = cfg.workload.demand.unset;
  let wVar = 20 ** 2;
  const tlxByContext: Record<string, number[]> = {};
  const contributions: Record<Source, number> = { kss: 0, pvt: 0, cam: 0 };
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
    P[0][0] += cfg.offsetDriftSdPerSqrtHour ** 2 * dtH;
    if (cfg.useAnchors) CH.forEach((c, i) => (P[i + 1][i + 1] += cfg.channels[c].biasDriftSdPerSqrtHour ** 2 * dtH));
    const alpha = Math.exp((-dtH * 60) / cfg.workload.reversionMinutes);
    const mu = demand(context);
    w = mu + (w - mu) * alpha;
    // Ornstein-Uhlenbeck around the context demand: stationary variance = stationarySd^2
    wVar = wVar * alpha * alpha + cfg.workload.stationarySd ** 2 * (1 - alpha * alpha);
    clock = to;
  };
  const prior = (t: number) => priorKss(t, sleep, cfg.tpm, cfg.tzOffsetMinutes, sleeps);
  /** Kalman update with observation y = h . x + c + noise(r). Credits the change in d to `source`. */
  const update = (y: number, h: number[], c: number, r: number, source: Source) => {
    const ph = P.map((row) => row.reduce((acc, v, j) => acc + v * h[j], 0));
    const sVar = h.reduce((acc, v, i) => acc + v * ph[i], 0) + r;
    const k = ph.map((v) => v / sVar);
    const innov = y - c - h.reduce((acc, v, i) => acc + v * x[i], 0);
    for (let i = 0; i < n; i++) x[i] += k[i] * innov;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) P[i][j] -= k[i] * ph[j];
    contributions[source] += k[0] * innov;
  };
  /** Passive reading of channel `c`: feature = at3 + perKss * (prior + tot + d - 3) + anchor + noise. */
  const observe = (c: ChannelId, value: number, t: number, source: Source) => {
    if (cfg.useChannels?.[c] === false) return;
    const ch = cfg.channels[c];
    const base = prior(t) + tot(t) * cfg.totPerHour;
    const h = new Array(n).fill(0);
    h[0] = ch.perKss;
    h[1 + CH.indexOf(c)] = 1;
    const sHat = base + x[0];
    // without anchors, person-to-person baseline differences can only be treated as extra noise
    const r = ch.noiseSd ** 2 * ch.inflate + (ch.slopeSd * (sHat - 3)) ** 2 + (cfg.useAnchors ? 0 : ch.biasSd ** 2);
    update(value, h, ch.at3 + ch.perKss * (base - 3), r, source);
  };
  const snap = (t: number): Snapshot => {
    const p = prior(t);
    const tt = tot(t) * cfg.totPerHour;
    return {
      t,
      prior: p,
      tot: tt,
      offset: x[0],
      offsetSd: Math.sqrt(P[0][0]),
      kss: clampKss(p + tt + x[0]),
      kssSd: Math.sqrt(P[0][0]),
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
      case 'sleep': {
        // a newer entry for the same night replaces the older one
        const i = sleeps.findIndex((x2) => Math.abs(x2.wake - e.wake) < 6 * HOUR);
        if (i >= 0) sleeps.splice(i, 1);
        sleeps.push({ wake: e.wake, hours: e.hours });
        sleeps.sort((a, b) => a.wake - b.wake);
        sleep = sleeps.filter((x2) => x2.wake <= e.t + 1).at(-1) ?? sleeps[sleeps.length - 1];
        break;
      }
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
        const h = new Array(n).fill(0);
        h[0] = 1;
        update(e.value, h, base, cfg.kssNoiseSd ** 2, 'kss');
        break;
      }
      case 'tlx': {
        (tlxByContext[context] ??= []).push(e.value);
        const r = cfg.workload.tlxNoiseSd ** 2;
        const g = wVar / (wVar + r);
        w += g * (e.value - w);
        wVar *= 1 - g;
        break;
      }
      case 'pvt': {
        if (cfg.usePassive && Number.isFinite(e.medianRt) && e.n > 0) observe('pvt', e.medianRt, e.t, 'pvt');
        break;
      }
      case 'cam': {
        if (!cfg.usePassive || e.coverage < cfg.camMinCoverage) break;
        observe('perclos', e.perclos * 100, e.t, 'cam');
        if (e.blinkRate >= cfg.minBlinksForDuration && e.meanBlinkMs > 0) observe('blink', e.meanBlinkMs, e.t, 'cam');
        break;
      }
    }
  }
  emitUntil(opts.until);

  return {
    snapshots,
    now: snap(opts.until),
    contributions,
    anchors: Object.fromEntries(CH.map((c, i) => [c, { mean: x[i + 1], sd: Math.sqrt(P[i + 1][i + 1]) }])) as Record<ChannelId, { mean: number; sd: number }>,
    sleep,
    sleeps,
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
    const mean = clampKss(priorKss(t, sleep, cfg.tpm, cfg.tzOffsetMinutes, afterSleep ? [...r.sleeps, sleep] : r.sleeps) + totH * cfg.totPerHour + r.now.offset);
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
