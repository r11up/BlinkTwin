// Three-Process Model of alertness (Akerstedt & Folkard), used as BlinkTwin's prior for sleepiness.
// Alertness A = S (homeostatic) + C (circadian) + W (sleep inertia), mapped to the Karolinska
// Sleepiness Scale (KSS, 1-9). Constants follow the published parameterisation as we understand it;
// check them against Akerstedt et al. (2004), Aviat Space Environ Med 75(3 Suppl):A75-83, before citing.

export interface TpmParams {
  lowerAsymptote: number; // La: S falls towards this while awake
  upperAsymptote: number; // Ha: S recovers towards this while asleep
  wakeDecay: number; // per hour, fall of S while awake
  sleepRecovery: number; // per hour, recovery of S while asleep
  circadianAmplitude: number; // M
  circadianAcrophase: number; // clock hour of peak alertness
  inertiaAmplitude: number; // W at the moment of waking (negative)
  inertiaDecay: number; // per hour
  kssIntercept: number; // KSS = kssIntercept - kssSlope * A
  kssSlope: number;
}

export const TPM_DEFAULTS: TpmParams = {
  lowerAsymptote: 2.4,
  upperAsymptote: 14.3,
  wakeDecay: 0.0353,
  sleepRecovery: 0.381,
  circadianAmplitude: 2.5,
  circadianAcrophase: 16.8,
  inertiaAmplitude: -5.72,
  inertiaDecay: 1.51,
  kssIntercept: 10.6,
  kssSlope: 0.6,
};

export interface SleepEpisode {
  wake: number; // epoch ms of waking up
  hours: number; // hours slept before `wake`
}

const HOUR = 3_600_000;

export function clockHour(t: number, tzOffsetMinutes = new Date(t).getTimezoneOffset()): number {
  const local = t - tzOffsetMinutes * 60_000;
  return ((local / HOUR) % 24 + 24) % 24;
}

/** Homeostatic S at the moment of waking, assuming the previous wake period filled the rest of a 24 h day. */
export function sAtWake(sleepHours: number, p: TpmParams = TPM_DEFAULTS): number {
  const priorWake = Math.max(0, 24 - sleepHours);
  const sBed = p.lowerAsymptote + (p.upperAsymptote - p.lowerAsymptote) * Math.exp(-p.wakeDecay * priorWake);
  return p.upperAsymptote - (p.upperAsymptote - sBed) * Math.exp(-p.sleepRecovery * sleepHours);
}

export interface AlertnessParts {
  S: number;
  C: number;
  W: number;
  A: number;
  kss: number;
}

export function alertness(t: number, sleep: SleepEpisode, p: TpmParams = TPM_DEFAULTS, tzOffsetMinutes?: number): AlertnessParts {
  const awakeH = Math.max(0, (t - sleep.wake) / HOUR);
  const s0 = sAtWake(sleep.hours, p);
  const S = p.lowerAsymptote + (s0 - p.lowerAsymptote) * Math.exp(-p.wakeDecay * awakeH);
  const h = clockHour(t, tzOffsetMinutes);
  const C = p.circadianAmplitude * Math.cos((2 * Math.PI * (h - p.circadianAcrophase)) / 24);
  const W = p.inertiaAmplitude * Math.exp(-p.inertiaDecay * awakeH);
  const A = S + C + W;
  return { S, C, W, A, kss: clampKss(p.kssIntercept - p.kssSlope * A) };
}

export function priorKss(t: number, sleep: SleepEpisode, p: TpmParams = TPM_DEFAULTS, tzOffsetMinutes?: number): number {
  return alertness(t, sleep, p, tzOffsetMinutes).kss;
}

export function clampKss(x: number): number {
  return Math.min(9, Math.max(1, x));
}
