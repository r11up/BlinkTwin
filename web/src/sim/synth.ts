// Virtual participants with a known ground truth, for the website's demo mode and the simulation study
// (scripts/simulate.ts). Signal parameters come from forward models fitted on DROZY
// (results/drozy_forward.json). Scenario knobs break the twin's assumptions on purpose, so the study can
// show how the twin behaves when the world does not match its model.

import { clampKss, priorKss, TPM_DEFAULTS, type SleepEpisode } from '../twin/tpm.ts';
import type { ContextId, TwinEvent } from '../twin/twin.ts';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: Rng, mean = 0, sd = 1): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Student-t noise with `df` degrees of freedom, scaled to standard deviation `sd` (df > 2). */
export function studentT(rng: Rng, df: number, sd: number): number {
  let chi = 0;
  for (let i = 0; i < df; i++) chi += gauss(rng) ** 2;
  return (gauss(rng) / Math.sqrt(chi / df)) * sd * Math.sqrt((df - 2) / df);
}

export interface SignalSpec {
  at3: number; // population mean at KSS 3
  perKss: [number, number]; // mean and between-person SD of the slope
  biasSd: number; // between-person SD of the baseline
  noiseSd: number; // per observation
  driftSd: number; // slowly varying (Ornstein-Uhlenbeck) deviation, stationary SD
  driftTauHours: number;
  ar1: number; // minute-to-minute autocorrelation of the noise
}

export interface PopulationSpec {
  offsetSd: number;
  phaseSdHours: number;
  totMean: number;
  totSd: number;
  fluctuationSd: number;
  fluctuationTauHours: number;
  ratingNoiseSd: number;
  ratingBiasSd: number; // person-specific rating style: ratings = truth + bias + noise
  sleepMisreportSdHours: number; // reported sleep differs from actual sleep
  nonlinear: boolean; // signals respond more steeply at high sleepiness
  heavyTails: boolean; // t(3) noise instead of Gaussian
  rt: SignalSpec;
  blinkMs: SignalSpec;
  perclosPct: SignalSpec;
  workload: { offsetSd: number; ratingNoiseSd: number; fluctuationSd: number };
}

// Baseline scenario: DROZY forward models (results/drozy_forward.json) and the between-person KSS SD of the
// Three-Process Model in field data (0.84; Ingre et al., 2014).
export const POPULATION: PopulationSpec = {
  offsetSd: 0.84,
  phaseSdHours: 1.0,
  totMean: 0.4,
  totSd: 0.2,
  fluctuationSd: 0.5,
  fluctuationTauHours: 1.5,
  ratingNoiseSd: 0.7,
  ratingBiasSd: 0,
  sleepMisreportSdHours: 0,
  nonlinear: false,
  heavyTails: false,
  rt: { at3: 339.2, perKss: [18.85, 8], biasSd: 48.7, noiseSd: 36.4, driftSd: 0, driftTauHours: 4, ar1: 0 },
  blinkMs: { at3: 189.7, perKss: [11.1, 7], biasSd: 22.9, noiseSd: 24.6, driftSd: 30, driftTauHours: 4, ar1: 0.02 },
  perclosPct: { at3: 3.24, perKss: [0.62, 0.3], biasSd: 2.38, noiseSd: 2.4, driftSd: 1.8, driftTauHours: 4, ar1: 0.32 },
  workload: { offsetSd: 10, ratingNoiseSd: 8, fluctuationSd: 6 },
};

export interface Person {
  id: number;
  offset: number;
  phaseHours: number;
  tot: number;
  ratingBias: number;
  sleepMisreportHours: number;
  rt: { at3: number; perKss: number };
  blinkMs: { at3: number; perKss: number };
  perclosPct: { at3: number; perKss: number };
  workloadOffset: number;
}

const drawSignal = (rng: Rng, s: SignalSpec) => ({ at3: s.at3 + gauss(rng, 0, s.biasSd), perKss: Math.max(0, gauss(rng, s.perKss[0], s.perKss[1])) });

export function makePerson(id: number, rng: Rng, pop: PopulationSpec = POPULATION): Person {
  return {
    id,
    offset: gauss(rng, 0, pop.offsetSd),
    phaseHours: gauss(rng, 0, pop.phaseSdHours),
    tot: Math.max(0, gauss(rng, pop.totMean, pop.totSd)),
    ratingBias: gauss(rng, 0, pop.ratingBiasSd),
    sleepMisreportHours: gauss(rng, 0, pop.sleepMisreportSdHours),
    rt: drawSignal(rng, pop.rt),
    blinkMs: drawSignal(rng, pop.blinkMs),
    perclosPct: drawSignal(rng, pop.perclosPct),
    workloadOffset: gauss(rng, 0, pop.workload.offsetSd),
  };
}

export interface Protocol {
  start: number; // epoch ms, the morning of day 1 (person wakes here)
  sleepHours: number; // reported sleep last night
  awakeHours: number;
  blockMinutes: number;
  breakMinutes: number;
  checkIns: number[]; // epoch ms of KSS (+ TLX) check-ins
  pvtEveryHours: number; // 0 = only after check-ins
  pvtAfterCheckIn: boolean; // rate first, then test (so the rating is not coloured by test feedback)
  camera: boolean;
  tzOffsetMinutes: number;
}

export interface TruthPoint {
  t: number;
  kss: number;
  workload: number;
}

const H = 3_600_000;
const M = 60_000;
const DEMAND: Record<ContextId, number> = { unset: 40, break: 15, reading: 40, focus: 65, meeting: 50, other: 40 };
const TASKS: ContextId[] = ['focus', 'reading', 'meeting', 'focus'];

/** Signal value for sleepiness s, before noise. Nonlinear scenario: steeper response above KSS 6. */
function respond(sig: { at3: number; perKss: number }, s: number, nonlinear: boolean): number {
  if (!nonlinear) return sig.at3 + sig.perKss * (s - 3);
  return sig.at3 + sig.perKss * 0.6 * (s - 3) + sig.perKss * 0.5 * Math.max(0, s - 6) ** 2;
}

/** Simulates one protocol for one person: returns the events BlinkTwin would see and the hidden truth. */
export function simulate(person: Person, protocol: Protocol, rng: Rng, pop: PopulationSpec = POPULATION) {
  const p = protocol;
  const actualSleep: SleepEpisode = { wake: p.start, hours: Math.max(2, p.sleepHours + person.sleepMisreportHours) };
  const end = p.start + p.awakeHours * H;
  const events: TwinEvent[] = [{ t: p.start, type: 'sleep', wake: p.start, hours: p.sleepHours }];
  const truth: TruthPoint[] = [];
  const noise = (sd: number) => (pop.heavyTails ? studentT(rng, 3, sd) : gauss(rng, 0, sd));

  const schedule: { t: number; ctx: ContextId }[] = [];
  let t = p.start + 30 * M;
  let k = 0;
  while (t < end) {
    schedule.push({ t, ctx: TASKS[k++ % TASKS.length] });
    schedule.push({ t: t + p.blockMinutes * M, ctx: 'break' });
    t += (p.blockMinutes + p.breakMinutes) * M;
  }
  for (const s of schedule) events.push({ t: s.t, type: 'context', context: s.ctx });
  const ctxAt = (time: number) => {
    let c: ContextId = 'unset';
    for (const s of schedule) if (s.t <= time) c = s.ctx;
    return c;
  };

  let taskStart: number | null = null;
  let lastCtx: ContextId = 'unset';
  let fluct = 0;
  let wFluct = 0;
  const ou = { blink: gauss(rng, 0, pop.blinkMs.driftSd), perclos: gauss(rng, 0, pop.perclosPct.driftSd) };
  const ar = { blink: 0, perclos: 0 };
  const aR = Math.exp(-1 / 60 / pop.fluctuationTauHours);
  const aW = Math.exp(-1 / 20);
  const aB = Math.exp(-1 / 60 / pop.blinkMs.driftTauHours);
  const aP = Math.exp(-1 / 60 / pop.perclosPct.driftTauHours);
  const truthAt = new Map<number, TruthPoint>();
  for (let time = p.start; time <= end; time += M) {
    const ctx = ctxAt(time);
    if (ctx !== lastCtx) {
      if (ctx !== 'break' && ctx !== 'unset' && (lastCtx === 'break' || lastCtx === 'unset')) taskStart = time;
      lastCtx = ctx;
    }
    const totH = ctx === 'break' || ctx === 'unset' || taskStart === null ? 0 : (time - taskStart) / H;
    fluct = fluct * aR + gauss(rng, 0, pop.fluctuationSd * Math.sqrt(1 - aR * aR));
    wFluct = wFluct * aW + gauss(rng, 0, pop.workload.fluctuationSd * Math.sqrt(1 - aW * aW));
    const shifted = time - person.phaseHours * H;
    const kss = clampKss(priorKss(shifted, { wake: actualSleep.wake - person.phaseHours * H, hours: actualSleep.hours }, TPM_DEFAULTS, p.tzOffsetMinutes) + person.offset + person.tot * totH + fluct);
    const workload = Math.min(100, Math.max(0, DEMAND[ctx] + person.workloadOffset + wFluct));
    const tp = { t: time, kss, workload };
    truth.push(tp);
    truthAt.set(time, tp);
    ou.blink = ou.blink * aB + gauss(rng, 0, pop.blinkMs.driftSd * Math.sqrt(1 - aB * aB));
    ou.perclos = ou.perclos * aP + gauss(rng, 0, pop.perclosPct.driftSd * Math.sqrt(1 - aP * aP));
    ar.blink = pop.blinkMs.ar1 * ar.blink + noise(pop.blinkMs.noiseSd) * Math.sqrt(1 - pop.blinkMs.ar1 ** 2);
    ar.perclos = pop.perclosPct.ar1 * ar.perclos + noise(pop.perclosPct.noiseSd) * Math.sqrt(1 - pop.perclosPct.ar1 ** 2);
    if (p.camera && ctx !== 'unset' && time > p.start) {
      const meanBlinkMs = Math.max(60, respond(person.blinkMs, kss, pop.nonlinear) + ou.blink + ar.blink);
      const perclos = Math.min(0.6, Math.max(0, (respond(person.perclosPct, kss, pop.nonlinear) + ou.perclos + ar.perclos) / 100));
      const blinkRate = Math.max(0, Math.round(gauss(rng, 18, 6)));
      events.push({ t: time, type: 'cam', perclos, blinkRate, meanBlinkMs: blinkRate >= 3 ? meanBlinkMs : 0, coverage: 0.9 });
    }
  }
  const nearest = (time: number) => truthAt.get(p.start + Math.round((time - p.start) / M) * M) ?? truth[truth.length - 1];
  const pvtAt = (time: number) => {
    const s = nearest(time).kss;
    const medianRt = Math.max(180, respond(person.rt, s, pop.nonlinear) + noise(pop.rt.noiseSd));
    const lapses = Math.max(0, Math.round((medianRt - 280) / 20 + gauss(rng, 0, 1)));
    events.push({ t: time, type: 'pvt', medianRt, lapses, n: 45, falseStarts: Math.max(0, Math.round(gauss(rng, 0.5, 1))) });
  };
  if (p.pvtEveryHours > 0) for (let time = p.start + p.pvtEveryHours * H; time < end; time += p.pvtEveryHours * H) pvtAt(time);
  for (const c of p.checkIns) {
    const tr = nearest(c);
    const rating = Math.min(9, Math.max(1, Math.round(tr.kss + person.ratingBias + gauss(rng, 0, pop.ratingNoiseSd))));
    events.push({ t: c, type: 'kss', value: rating });
    events.push({ t: c + 30_000, type: 'tlx', value: Math.min(100, Math.max(0, tr.workload + gauss(rng, 0, pop.workload.ratingNoiseSd))) });
    if (p.pvtAfterCheckIn) pvtAt(c + 4 * M);
  }
  events.sort((a, b) => a.t - b.t);
  return { events, truth, sleep: actualSleep };
}
