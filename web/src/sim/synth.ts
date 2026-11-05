// Virtual participants with a known ground truth. Used by the website's demo mode and by the
// simulation study in the paper (scripts/simulate.ts), so both exercise the same twin code.
// Each person differs in circadian phase, baseline offset, time-on-task sensitivity and, crucially,
// in how their reaction time and eyes respond to sleepiness. That last part is what calibration learns.

import { clampKss, priorKss, TPM_DEFAULTS } from '../twin/tpm.ts';
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

/** Population distribution of person-level parameters. Reaction-time and eye parameters are fitted on DROZY (results/drozy_summary.json). */
export interface PopulationSpec {
  offsetSd: number;
  phaseSdHours: number;
  totMean: number;
  totSd: number;
  fluctuationSd: number;
  fluctuationTauHours: number;
  ratingNoiseSd: number;
  rt: { intercept: [number, number]; slope: [number, number]; noiseSd: number }; // ms at KSS 3, ms per KSS point
  blinkMs: { intercept: [number, number]; slope: [number, number]; noiseSd: number };
  perclos: { intercept: number; slope: [number, number]; noiseSd: number }; // slope per KSS point above 4
  blinkRate: { intercept: [number, number]; loadSlope: number; noiseSd: number };
  workload: { offsetSd: number; ratingNoiseSd: number; fluctuationSd: number };
}

export const POPULATION: PopulationSpec = {
  offsetSd: 1.0,
  phaseSdHours: 1.0,
  totMean: 0.4,
  totSd: 0.2,
  fluctuationSd: 0.5,
  fluctuationTauHours: 1.5,
  ratingNoiseSd: 0.7,
  rt: { intercept: [339.2, 50.6], slope: [18.83, 7.74], noiseSd: 36.1 },
  blinkMs: { intercept: [187.5, 25.9], slope: [11.88, 4.76], noiseSd: 43.1 },
  perclos: { intercept: 0.0299, slope: [0.009, 0.0049], noiseSd: 0.0226 },
  blinkRate: { intercept: [17, 5], loadSlope: -0.12, noiseSd: 3 },
  workload: { offsetSd: 10, ratingNoiseSd: 8, fluctuationSd: 6 },
};

export interface Person {
  id: number;
  offset: number;
  phaseHours: number;
  tot: number;
  rtIntercept: number;
  rtSlope: number;
  blinkMsIntercept: number;
  blinkMsSlope: number;
  perclosSlope: number;
  blinkRateBase: number;
  workloadOffset: number;
}

export function makePerson(id: number, rng: Rng, pop: PopulationSpec = POPULATION): Person {
  return {
    id,
    offset: gauss(rng, 0, pop.offsetSd),
    phaseHours: gauss(rng, 0, pop.phaseSdHours),
    tot: Math.max(0, gauss(rng, pop.totMean, pop.totSd)),
    rtIntercept: gauss(rng, ...pop.rt.intercept),
    rtSlope: Math.max(0, gauss(rng, ...pop.rt.slope)),
    blinkMsIntercept: Math.max(80, gauss(rng, ...pop.blinkMs.intercept)),
    blinkMsSlope: Math.max(0, gauss(rng, ...pop.blinkMs.slope)),
    perclosSlope: Math.max(0, gauss(rng, ...pop.perclos.slope)),
    blinkRateBase: Math.max(5, gauss(rng, ...pop.blinkRate.intercept)),
    workloadOffset: gauss(rng, 0, pop.workload.offsetSd),
  };
}

export interface Protocol {
  start: number; // epoch ms, the morning of day 1 (person wakes here)
  sleepHours: number;
  awakeHours: number; // 16 for a normal day, 24 for a night of sleep deprivation
  blockMinutes: number; // task block length
  breakMinutes: number;
  checkIns: number[]; // epoch ms of KSS (+ TLX) check-ins
  pvtEveryHours: number; // 0 = only before check-ins
  pvtBeforeCheckIn: boolean;
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

/** Simulates one protocol for one person: returns the events BlinkTwin would see and the hidden truth. */
export function simulate(person: Person, protocol: Protocol, rng: Rng, pop: PopulationSpec = POPULATION) {
  const p = protocol;
  const sleep = { wake: p.start, hours: p.sleepHours };
  const end = p.start + p.awakeHours * H;
  const events: TwinEvent[] = [{ t: p.start, type: 'sleep', wake: p.start, hours: p.sleepHours }];
  const truth: TruthPoint[] = [];

  // context schedule
  const schedule: { t: number; ctx: ContextId }[] = [];
  let t = p.start + 30 * M;
  let k = 0;
  while (t < end) {
    const task = TASKS[k++ % TASKS.length];
    schedule.push({ t, ctx: task });
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
  const step = M;
  const aR = Math.exp(-1 / 60 / pop.fluctuationTauHours);
  const aW = Math.exp(-1 / 20);
  const truthAt = new Map<number, TruthPoint>();
  for (let time = p.start; time <= end; time += step) {
    const ctx = ctxAt(time);
    if (ctx !== lastCtx) {
      if (ctx !== 'break' && ctx !== 'unset' && (lastCtx === 'break' || lastCtx === 'unset')) taskStart = time;
      lastCtx = ctx;
    }
    const totH = ctx === 'break' || ctx === 'unset' || taskStart === null ? 0 : (time - taskStart) / H;
    fluct = fluct * aR + gauss(rng, 0, pop.fluctuationSd * Math.sqrt(1 - aR * aR));
    wFluct = wFluct * aW + gauss(rng, 0, pop.workload.fluctuationSd * Math.sqrt(1 - aW * aW));
    const shifted = time - person.phaseHours * H;
    const kss = clampKss(priorKss(shifted, { wake: sleep.wake - person.phaseHours * H, hours: sleep.hours }, TPM_DEFAULTS, p.tzOffsetMinutes) + person.offset + person.tot * totH + fluct);
    const workload = Math.min(100, Math.max(0, DEMAND[ctx] + person.workloadOffset + wFluct));
    const tp = { t: time, kss, workload };
    truth.push(tp);
    truthAt.set(time, tp);

    if (p.camera && ctx !== 'unset' && (time - p.start) % M === 0 && time > p.start) {
      const blinkMs = Math.max(60, person.blinkMsIntercept + person.blinkMsSlope * (kss - 3) + gauss(rng, 0, pop.blinkMs.noiseSd));
      const perclos = Math.min(0.5, Math.max(0, pop.perclos.intercept + person.perclosSlope * Math.max(0, kss - 4) + gauss(rng, 0, pop.perclos.noiseSd)));
      const blinkRate = Math.max(2, person.blinkRateBase + pop.blinkRate.loadSlope * (workload - 50) + gauss(rng, 0, pop.blinkRate.noiseSd));
      events.push({ t: time, type: 'cam', perclos, blinkRate, meanBlinkMs: blinkMs, coverage: 0.9 });
    }
  }
  const nearest = (time: number) => truthAt.get(p.start + Math.round((time - p.start) / M) * M) ?? truth[truth.length - 1];
  const pvtAt = (time: number) => {
    const s = nearest(time).kss;
    const medianRt = Math.max(180, person.rtIntercept + person.rtSlope * (s - 3) + gauss(rng, 0, pop.rt.noiseSd));
    const lapses = Math.max(0, Math.round((medianRt - 280) / 20 + gauss(rng, 0, 1)));
    events.push({ t: time, type: 'pvt', medianRt, lapses, n: 45, falseStarts: Math.max(0, Math.round(gauss(rng, 0.5, 1))) });
  };
  if (p.pvtEveryHours > 0) for (let time = p.start + p.pvtEveryHours * H; time < end; time += p.pvtEveryHours * H) pvtAt(time);
  for (const c of p.checkIns) {
    if (p.pvtBeforeCheckIn) pvtAt(c - 4 * M);
    const tr = nearest(c);
    events.push({ t: c, type: 'kss', value: Math.min(9, Math.max(1, Math.round(tr.kss + gauss(rng, 0, pop.ratingNoiseSd)))) });
    events.push({ t: c + 30_000, type: 'tlx', value: Math.min(100, Math.max(0, tr.workload + gauss(rng, 0, pop.workload.ratingNoiseSd))) });
  }
  events.sort((a, b) => a.t - b.t);
  return { events, truth, sleep };
}
