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
  | { t: number; type: 'pvt'; medianRt: number; lapses: number; n: number; falseStarts: number; durationS?: number }
  | { t: number; type: 'cam'; perclos: number; blinkRate: number; meanBlinkMs: number; coverage: number; nods?: number; headMovement?: number; peakClosure?: number | null }
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
  // The reaction-time noise was estimated from full-length tests; a shorter test (the app's 1-minute
  // version) is noisier, so it is shown to the person but not used. Events without durationS are full tests.
  pvtMinSeconds: number;
  // PERCLOS counts frames with normalised closure >= 0.8. On some cameras the eyeBlink score of a full blink
  // never gets there (DROZY near-infrared video: median blink peak about 0.6, PERCLOS below 0.5% in all 36
  // tests), so PERCLOS stays flat whatever the person's state and would wrongly tell the twin "no change".
  // The decision is made per camera, not per minute: the twin remembers the most recent known peak (a minute
  // with fewer than 3 blinks has peakClosure null) and uses a minute's PERCLOS only if that last known peak
  // reaches this value; while no peak is known yet, PERCLOS is not used. Minutes WITHOUT the peakClosure key
  // (older events, DROZY replay, simulation) are used as before.
  perclosMinPeakClosure: number;
  camMinCoverage: number;
  // Missing nights. Off (the research default): the prior treats the whole time between two recorded wake
  // times as awake, and keeps using the last recorded night however old, which is right for protocols with
  // genuine all-nighters (DROZY, the simulation). On (the app): a gap of more than 30 h between recorded wake
  // times gets habitual nights, waking at the default hour; if the last recorded wake is more than 30 h old,
  // today's default night is used, with habitual nights in between. A real night without sleep is entered
  // as a sleep event with 0 hours.
  fillMissingNights?: boolean;
  usePassive: boolean; // false = prior + check-ins only (ablation)
  useChannels?: Partial<Record<ChannelId, boolean>>; // switch single passive channels off (ablation)
  useAnchors: boolean; // false = passive signals use the population baseline (ablation); same as anchorMode 'none'
  // How the per-signal anchors are handled:
  // - 'estimate' (default): anchors are filter states, learned from the data (BlinkTwin);
  // - 'consider': a consider-covariance (Schmidt-Kalman) filter: the anchors' uncertainty is carried in the
  //   covariance and enters every gain, but the anchors themselves are never estimated (their gain rows are
  //   zero, and the covariance is updated with the Joseph form so that it stays consistent). This is the fair
  //   comparator for "fusion without learning the anchors": it knows the bias is persistent;
  // - 'none': no anchors; the between-person spread of baselines is treated as independent noise per reading.
  anchorMode?: 'estimate' | 'consider' | 'none';
  // Undefined (default): the offset is a random walk with offsetDriftSdPerSqrtHour. Set: the offset is an
  // Ornstein-Uhlenbeck process that reverts to 0 with this time constant (hours) and stationary SD
  // offsetPriorSd (drift variance q = 2 sigma^2 / tau per hour), so an offset learned today fades over days.
  offsetReversionHours?: number;
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
//
// How the channel constants follow from results/drozy_forward.json:
// - at3, perKss, biasSd: the forward fits (reaction time from session means; blink duration and PERCLOS
//   from one-minute windows, perKss 11.1 ms and 0.62 percentage points).
// - noiseSd of the reaction test: the session-level residual SD (36.4 ms); one test is one observation.
// - noiseSd of blink duration and PERCLOS: the part of the one-minute residual that is not shared within a
//   session, sqrt(minute residual SD^2 - session residual SD^2): sqrt(50.15^2 - 43.71^2) = 24.6 ms and
//   sqrt(3.358^2 - 2.346^2) = 2.40 percentage points.
// - biasDriftSdPerSqrtHour of blink duration and PERCLOS: the session residual SD spread over the roughly
//   8 h between DROZY sessions, 43.71 / sqrt(8) = 15 ms and 2.346 / sqrt(8) = 0.83 points per sqrt(h): the
//   session-to-session wander of a person's baseline becomes slow drift of the anchor.
// - inflate: (1 + rho) / (1 - rho) from the lag-1 autocorrelation of one-minute windows (PERCLOS rho 0.318
//   gives 1.93; blink duration rho 0.018 gives 1.04); 1 for the reaction test (one test per session).
// - biasDriftSdPerSqrtHour of the reaction test (2 ms per sqrt(h)) is an assumption: with one test per
//   session DROZY cannot separate drift from test noise.
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
  pvtMinSeconds: 180,
  perclosMinPeakClosure: 0.85,
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
  sleep: SleepEpisode; // the night the prior uses at the end of the replay (an assumed one when filled)
  sleeps: SleepEpisode[]; // all recorded sleep episodes, oldest first (sleep debt carries across days)
  priorHistory: SleepEpisode[]; // the sleep history the prior uses: the recorded nights plus any filled ones
  sleepAssumption: { usesDefault: boolean; filledNights: number }; // with fillMissingNights: today's night is assumed / nights filled
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

const FILL_GAP_HOURS = 30;

/** Default wake times strictly inside (a + 12 h, b - 12 h): the nights to fill between two wake times. */
function habitualWakes(a: number, b: number, cfg: TwinConfig): number[] {
  const out: number[] = [];
  for (let w = defaultSleep(b - 12 * HOUR, cfg).wake; w > a + 12 * HOUR; w -= 24 * HOUR) if (w < b - 12 * HOUR) out.unshift(w);
  return out;
}

/**
 * The night and sleep history the prior uses at time t when missing nights are filled (fillMissingNights):
 * gaps of more than 30 h between recorded wake times get habitual nights, and if the last recorded wake is
 * more than 30 h before t (or nothing is recorded), today's default night is used.
 */
export function filledSleep(recordedSorted: SleepEpisode[], t: number, cfg: TwinConfig): { episode: SleepEpisode; history: SleepEpisode[]; usesDefault: boolean; filledNights: number } {
  const recorded = recordedSorted.filter((s) => s.wake <= t);
  const last = recorded.at(-1);
  const usesDefault = !last || t - last.wake > FILL_GAP_HOURS * HOUR;
  const episode = usesDefault ? defaultSleep(t, cfg) : (last as SleepEpisode);
  const history: SleepEpisode[] = [];
  let filledNights = 0;
  const habitual = cfg.tpm.habitualSleepHours;
  recorded.forEach((s, i) => {
    history.push(s);
    const next = i + 1 < recorded.length ? recorded[i + 1].wake : usesDefault ? episode.wake : null;
    if (next !== null && next - s.wake > FILL_GAP_HOURS * HOUR) {
      for (const w of habitualWakes(s.wake, next, cfg)) {
        history.push({ wake: w, hours: habitual });
        filledNights++;
      }
    }
  });
  if (usesDefault && recorded.length) history.push(episode);
  return { episode, history, usesDefault, filledNights };
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
  const mode = cfg.anchorMode ?? (cfg.useAnchors ? 'estimate' : 'none');
  const anchored = mode !== 'none';
  const n = 1 + CH.length;
  const x = new Array(n).fill(0);
  const P = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i !== j ? 0 : i === 0 ? cfg.offsetPriorSd ** 2 : anchored ? cfg.channels[CH[i - 1]].biasSd ** 2 : 0)),
  );
  let lastPeak: number | null = null; // most recent known median blink peak of this camera
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
    if (cfg.offsetReversionHours !== undefined && cfg.offsetReversionHours > 0) {
      // Ornstein-Uhlenbeck offset: x0 <- a x0, P <- F P F' + Q with F = diag(a, 1, ...), stationary SD offsetPriorSd
      const a = Math.exp(-dtH / cfg.offsetReversionHours);
      x[0] *= a;
      for (let j = 1; j < n; j++) {
        P[0][j] *= a;
        P[j][0] *= a;
      }
      P[0][0] = a * a * P[0][0] + cfg.offsetPriorSd ** 2 * (1 - a * a);
      (Object.keys(contributions) as Source[]).forEach((k) => (contributions[k] *= a));
    } else {
      P[0][0] += cfg.offsetDriftSdPerSqrtHour ** 2 * dtH;
    }
    if (anchored) CH.forEach((c, i) => (P[i + 1][i + 1] += cfg.channels[c].biasDriftSdPerSqrtHour ** 2 * dtH));
    const alpha = Math.exp((-dtH * 60) / cfg.workload.reversionMinutes);
    const mu = demand(context);
    w = mu + (w - mu) * alpha;
    // Ornstein-Uhlenbeck around the context demand: stationary variance = stationarySd^2
    wVar = wVar * alpha * alpha + cfg.workload.stationarySd ** 2 * (1 - alpha * alpha);
    clock = to;
  };
  // with fillMissingNights the night in use depends on t; cached because prior() is called for every update
  let fillCache: { key: string; v: ReturnType<typeof filledSleep> } | null = null;
  let sleepVersion = 0; // bumped on every sleep entry, so a corrected night invalidates the cache
  const priorInputs = (t: number): { episode: SleepEpisode; history: SleepEpisode[] } => {
    if (!cfg.fillMissingNights) return { episode: sleep, history: sleeps };
    const nRecorded = sleeps.filter((s) => s.wake <= t).length;
    const def = defaultSleep(t, cfg).wake;
    const key = `${sleepVersion}:${nRecorded}:${def}:${nRecorded ? t - sleeps[nRecorded - 1].wake > FILL_GAP_HOURS * HOUR : 1}`;
    if (fillCache?.key !== key) fillCache = { key, v: filledSleep(sleeps, t, cfg) };
    return fillCache.v;
  };
  const prior = (t: number) => {
    const { episode, history } = priorInputs(t);
    return priorKss(t, episode, cfg.tpm, cfg.tzOffsetMinutes, history);
  };
  /** Kalman update with observation y = h . x + c + noise(r). Credits the change in d to `source`. */
  const update = (y: number, h: number[], c: number, r: number, source: Source) => {
    const ph = P.map((row) => row.reduce((acc, v, j) => acc + v * h[j], 0));
    const sVar = h.reduce((acc, v, i) => acc + v * ph[i], 0) + r;
    const k = ph.map((v) => v / sVar);
    const innov = y - c - h.reduce((acc, v, i) => acc + v * x[i], 0);
    if (mode === 'consider') {
      // consider states: the anchors keep their (zero) mean; only the offset is updated, and the covariance
      // follows the Joseph form P = A P A' + k r k' with A = I - k h', which is valid for any gain
      for (let i = 1; i < n; i++) k[i] = 0;
      x[0] += k[0] * innov;
      const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - k[i] * h[j]));
      const AP = A.map((row) => Array.from({ length: n }, (_, j) => row.reduce((acc, v, m) => acc + v * P[m][j], 0)));
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) P[i][j] = AP[i].reduce((acc, v, m) => acc + v * A[j][m], 0) + k[i] * r * k[j];
      contributions[source] += k[0] * innov;
      return;
    }
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
    const r = ch.noiseSd ** 2 * ch.inflate + (ch.slopeSd * (sHat - 3)) ** 2 + (anchored ? 0 : ch.biasSd ** 2);
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
        sleepVersion++;
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
          // after a long break time on task starts again; after a short one it continues from where it was
          // frozen, so the break's own minutes are not counted as task time
          taskStart = longBreak || taskStart === null ? e.t : e.t - frozenTot * HOUR;
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
        const fullLength = e.durationS === undefined || e.durationS >= cfg.pvtMinSeconds;
        if (cfg.usePassive && fullLength && Number.isFinite(e.medianRt) && e.n > 0) observe('pvt', e.medianRt, e.t, 'pvt');
        break;
      }
      case 'cam': {
        if (typeof e.peakClosure === 'number') lastPeak = e.peakClosure;
        if (!cfg.usePassive || e.coverage < cfg.camMinCoverage) break;
        // without the key: older events, DROZY replay, simulation (used as before); with it: the camera's
        // last known blink peak decides, and an unknown peak means PERCLOS is not used
        const perclosOk = e.peakClosure === undefined || (lastPeak !== null && lastPeak >= cfg.perclosMinPeakClosure);
        if (perclosOk) observe('perclos', e.perclos * 100, e.t, 'cam');
        if (e.blinkRate >= cfg.minBlinksForDuration && e.meanBlinkMs > 0) observe('blink', e.meanBlinkMs, e.t, 'cam');
        break;
      }
    }
  }
  emitUntil(opts.until);
  const fillEnd = cfg.fillMissingNights ? filledSleep(sleeps, opts.until, cfg) : null;

  return {
    snapshots,
    now: snap(opts.until),
    contributions,
    anchors: Object.fromEntries(CH.map((c, i) => [c, { mean: x[i + 1], sd: Math.sqrt(P[i + 1][i + 1]) }])) as Record<ChannelId, { mean: number; sd: number }>,
    sleep: fillEnd ? fillEnd.episode : sleep,
    sleeps,
    priorHistory: fillEnd ? fillEnd.history : sleeps,
    sleepAssumption: fillEnd ? { usesDefault: fillEnd.usesDefault, filledNights: fillEnd.filledNights } : { usesDefault: sleeps.length === 0, filledNights: 0 },
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
  // A work rhythm for the projection: blocks of breaksEveryMinutes of work separated by breaks of
  // breakMinutes (default: the reset length). Without it, a person who is working now is assumed to keep
  // working without a break for the whole horizon, and breakNow keeps time on task at zero throughout.
  breaksEveryMinutes?: number;
  breakMinutes?: number;
  breakNowMinutes?: number; // with breaksEveryMinutes and breakNow: length of the break taken now
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
  const rhythm = sc.breaksEveryMinutes !== undefined && sc.breaksEveryMinutes > 0;
  const W = (sc.breaksEveryMinutes ?? 0) / 60;
  const B = (sc.breakMinutes ?? cfg.breakResetMinutes) / 60;
  const R = cfg.breakResetMinutes / 60;
  const totNow = r.now.tot / Math.max(cfg.totPerHour, 1e-9);
  /** Hours on task dtH hours from now under a work rhythm, with the twin's own break rule. */
  const scheduledTot = (dtH: number): number => {
    if (r.context === 'unset') return 0;
    let t = 0;
    let T = totNow;
    if (inTask) {
      const first = Math.max(0, W - T); // finish the current block
      if (dtH < first) return T + dtH;
      t = first;
      T += first;
    }
    // a break now (or the current break, whose start is not known here, taken to start now), then the rhythm
    let brk = sc.breakNow ? (sc.breakNowMinutes ?? B * 60) / 60 : B;
    for (;;) {
      if (dtH < t + brk) return brk >= R && dtH - t >= R ? 0 : T;
      t += brk;
      if (brk >= R) T = 0;
      if (dtH < t + W) return T + (dtH - t);
      t += W;
      T += W;
      brk = B;
    }
  };
  for (let t = r.now.t; t <= end; t += step) {
    const sleeping = sc.sleepAt !== undefined && t >= sc.sleepAt && t < sc.sleepAt + (sc.sleepHours ?? 7.5) * HOUR;
    const sleep =
      sc.sleepAt !== undefined && t >= sc.sleepAt + (sc.sleepHours ?? 7.5) * HOUR
        ? { wake: sc.sleepAt + (sc.sleepHours ?? 7.5) * HOUR, hours: sc.sleepHours ?? 7.5 }
        : r.sleep;
    const dtH = (t - r.now.t) / HOUR;
    const afterSleep = sleep !== r.sleep;
    const totH = afterSleep ? 0 : rhythm ? scheduledTot(dtH) : inTask ? tot0 + dtH : sc.breakNow ? 0 : tot0;
    const history = r.priorHistory ?? r.sleeps;
    const mean = clampKss(priorKss(t, sleep, cfg.tpm, cfg.tzOffsetMinutes, afterSleep ? [...history, sleep] : history) + totH * cfg.totPerHour + offsetAhead(r.now.offset, dtH, cfg));
    const sd = Math.sqrt(offsetVarAhead(r.now.offsetSd ** 2, dtH, cfg));
    const pSleepy = 1 - normalCdf((7 - mean) / sd);
    points.push({ t, kss: mean, kssSd: sd, pSleepy, asleep: sleeping });
    if (!sleeping && sleepyAt === null && mean >= 7) sleepyAt = t;
  }
  return { points, sleepyAt };
}

/** The offset's mean dtH hours ahead: held constant for a random walk, decaying for a mean-reverting offset. */
export function offsetAhead(offset: number, dtH: number, cfg: TwinConfig = DEFAULT_CONFIG): number {
  return cfg.offsetReversionHours !== undefined && cfg.offsetReversionHours > 0 ? offset * Math.exp(-dtH / cfg.offsetReversionHours) : offset;
}

/** The offset's variance dtH hours ahead, starting from variance v. */
export function offsetVarAhead(v: number, dtH: number, cfg: TwinConfig = DEFAULT_CONFIG): number {
  if (cfg.offsetReversionHours !== undefined && cfg.offsetReversionHours > 0) {
    const a2 = Math.exp((-2 * dtH) / cfg.offsetReversionHours);
    return v * a2 + cfg.offsetPriorSd ** 2 * (1 - a2);
  }
  return v + cfg.offsetDriftSdPerSqrtHour ** 2 * dtH;
}

export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}
