// Three-Process Model of alertness (Akerstedt & Folkard, 1997; Akerstedt, Folkard & Portin, 2004;
// breakpoint from Akerstedt et al., 2008; ultradian component and KSS mapping as in Ingre et al., 2014),
// used as BlinkTwin's prior for sleepiness.
//
// Alertness A = S (homeostatic) + C (circadian) + U (ultradian) + W (sleep inertia), mapped to the
// Karolinska Sleepiness Scale: KSS = 10.6 - 0.6 A, clamped to [1, 9].
// S falls exponentially while awake and recovers during sleep: linearly below the breakpoint, then
// exponentially towards the upper asymptote. S is carried across days, so sleep debt accumulates.

export interface TpmParams {
  lowerAsymptote: number; // La: S falls towards this while awake
  upperAsymptote: number; // Ha: S recovers towards this while asleep
  wakeDecay: number; // per hour, fall of S while awake
  sleepRecovery: number; // per hour, exponential recovery of S above the breakpoint
  breakpoint: number; // below this, recovery is linear at the exponential's slope at the breakpoint
  circadianAmplitude: number; // M
  circadianAcrophase: number; // clock hour of peak alertness
  ultradianAmplitude: number;
  ultradianMesor: number;
  ultradianDipHour: number; // the 12-h component's low point (and 12 h later)
  inertiaAmplitude: number; // W at the moment of waking (negative)
  inertiaDecay: number; // per hour
  kssIntercept: number; // KSS = kssIntercept - kssSlope * A
  kssSlope: number;
  habitualSleepHours: number; // assumed for nights before the recorded history
}

export const TPM_DEFAULTS: TpmParams = {
  lowerAsymptote: 2.4,
  upperAsymptote: 14.3,
  wakeDecay: 0.0353,
  sleepRecovery: 0.381,
  breakpoint: 12.2,
  circadianAmplitude: 2.5,
  circadianAcrophase: 16.8,
  ultradianAmplitude: 0.5,
  ultradianMesor: -0.5,
  ultradianDipHour: 13.8,
  inertiaAmplitude: -5.72,
  inertiaDecay: 1.51,
  kssIntercept: 10.6,
  kssSlope: 0.6,
  habitualSleepHours: 7.5,
};

export interface SleepEpisode {
  wake: number; // epoch ms of waking up
  hours: number; // hours slept before `wake`
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function clockHour(t: number, tzOffsetMinutes = new Date(t).getTimezoneOffset()): number {
  const local = t - tzOffsetMinutes * 60_000;
  return ((local / HOUR) % 24 + 24) % 24;
}

export function sAfterWake(s0: number, hours: number, p: TpmParams = TPM_DEFAULTS): number {
  return p.lowerAsymptote + (s0 - p.lowerAsymptote) * Math.exp(-p.wakeDecay * Math.max(0, hours));
}

/** Recovery of S during sleep: linear below the breakpoint, exponential above it. */
export function sAfterSleep(s0: number, hours: number, p: TpmParams = TPM_DEFAULTS): number {
  let s = s0;
  let h = Math.max(0, hours);
  if (s < p.breakpoint) {
    const rate = p.sleepRecovery * (p.upperAsymptote - p.breakpoint);
    const toBreak = (p.breakpoint - s) / rate;
    if (toBreak >= h) return s + rate * h;
    s = p.breakpoint;
    h -= toBreak;
  }
  return p.upperAsymptote - (p.upperAsymptote - s) * Math.exp(-p.sleepRecovery * h);
}

/**
 * S at the moment of waking from the last episode in `episodes` (any order). Nights before the first
 * recorded episode are assumed habitual (habitualSleepHours, waking at the same clock time), starting
 * ten days earlier from a fully rested state, so that a run of short nights builds up sleep debt.
 */
export function sAtLastWake(episodes: SleepEpisode[], p: TpmParams = TPM_DEFAULTS): number {
  const recorded = [...episodes].sort((a, b) => a.wake - b.wake);
  if (!recorded.length) return sAtWake(p.habitualSleepHours, p);
  const first = recorded[0].wake;
  const all: SleepEpisode[] = [];
  for (let d = 10; d >= 1; d--) all.push({ wake: first - d * DAY, hours: p.habitualSleepHours });
  all.push(...recorded);
  let s = p.upperAsymptote;
  let lastWake = all[0].wake;
  for (let i = 1; i < all.length; i++) {
    const onset = all[i].wake - all[i].hours * HOUR;
    s = sAfterWake(s, (onset - lastWake) / HOUR, p);
    s = sAfterSleep(s, Math.min(all[i].hours, (all[i].wake - lastWake) / HOUR), p);
    lastWake = all[i].wake;
  }
  return s;
}

/** S at waking after one night of `sleepHours`, following habitual nights. */
export function sAtWake(sleepHours: number, p: TpmParams = TPM_DEFAULTS): number {
  let s = p.upperAsymptote;
  for (let d = 0; d < 10; d++) s = sAfterSleep(sAfterWake(s, 24 - p.habitualSleepHours, p), p.habitualSleepHours, p);
  return sAfterSleep(sAfterWake(s, 24 - sleepHours, p), sleepHours, p);
}

export interface AlertnessParts {
  S: number;
  C: number;
  U: number;
  W: number;
  A: number;
  kss: number;
}

/**
 * Alertness at time t after waking from `sleep`. `history` holds earlier sleep episodes, used to carry
 * sleep debt across days; without it, earlier nights are assumed habitual.
 */
export function alertness(t: number, sleep: SleepEpisode, p: TpmParams = TPM_DEFAULTS, tzOffsetMinutes?: number, history: SleepEpisode[] = []): AlertnessParts {
  const awakeH = Math.max(0, (t - sleep.wake) / HOUR);
  const s0 = history.length ? sAtLastWake([...history.filter((e) => e.wake < sleep.wake), sleep], p) : sAtWake(sleep.hours, p);
  const S = sAfterWake(s0, awakeH, p);
  const h = clockHour(t, tzOffsetMinutes);
  const C = p.circadianAmplitude * Math.cos((2 * Math.PI * (h - p.circadianAcrophase)) / 24);
  const U = p.ultradianMesor - p.ultradianAmplitude * Math.cos((2 * Math.PI * (h - p.ultradianDipHour)) / 12);
  // a night entered with 0 hours is a night without sleep: no waking up, so no sleep inertia
  const W = sleep.hours > 0 ? p.inertiaAmplitude * Math.exp(-p.inertiaDecay * awakeH) : 0;
  const A = S + C + U + W;
  return { S, C, U, W, A, kss: clampKss(p.kssIntercept - p.kssSlope * A) };
}

export function priorKss(t: number, sleep: SleepEpisode, p: TpmParams = TPM_DEFAULTS, tzOffsetMinutes?: number, history: SleepEpisode[] = []): number {
  return alertness(t, sleep, p, tzOffsetMinutes, history).kss;
}

export function clampKss(x: number): number {
  return Math.min(9, Math.max(1, x));
}
