// Objective versus subjective: do this person's reaction times agree with how sleepy they say they feel?
//
// The twin anchors every passive signal to the person's own ratings: a reaction test that reads slower than
// the ratings suggest is explained mostly by the reaction-time anchor, not by the sleepiness estimate. That
// is right for an estimate of how sleepy you FEEL, but it would hide the warning sign that matters most for
// safety. Under chronic sleep restriction, PVT lapses keep rising while sleepiness ratings level off (Van
// Dongen et al., 2003), and subjective and objective vulnerability to sleep loss are unrelated across people
// (Leproult et al., 2003). In the twin that pattern shows up as a GROWING reaction-time anchor: ratings stay
// flat while reactions slow. So this module reads the anchor's trend and the latest test on the population
// scale, and says so in plain words, rather than leaving it buried in the filter.
//
// Two numbers are reported, because they answer different questions:
// - the latest test on the population scale (objective reading) minus the twin's estimate just before the
//   test: "today, do your reactions match your rating?" A person who is always a slow responder reads high
//   here every time (a trait, not a state), so on its own this is weak evidence;
// - the change in the reaction-time anchor over the last 24 h and 7 days, in KSS-equivalents (anchor /
//   slope): "are your reactions drifting away from your ratings?" This removes the person's constant level.

import { clampKss } from '../twin/tpm.ts';
import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../twin/twin.ts';

export type DivergenceVerdict = 'not-enough-data' | 'agree' | 'slower' | 'faster';

export interface Divergence {
  verdict: DivergenceVerdict;
  message: string;
  fullTests: number; // reaction tests long enough to be used by the twin
  checkIns: number;
  latest: {
    t: number;
    medianRt: number;
    objectiveKss: number; // the test read through the population forward model alone
    estimateBefore: number; // the twin's estimate just before the test (not yet moved by it)
    gap: number; // objectiveKss - estimateBefore
  } | null;
  anchorKss: number | null; // current reaction-time anchor in KSS-equivalents (+ = slower than the population)
  trend24h: number | null; // change of anchorKss over the last 24 h (null if the anchor was not learned then)
  trend7d: number | null;
}

// Ad hoc defaults; none has been validated.
export const DIVERGENCE_RULES = {
  minFullTests: 2,
  minCheckIns: 1,
  gapKss: 1.5, // latest test vs estimate, in KSS points
  growthKss: 1.0, // growth of the anchor, in KSS-equivalents
};

const H = 3_600_000;

/** A reaction test read on the population scale, not adjusted to the person: 3 + (RT - a) / b, clipped. */
export function objectiveKss(medianRt: number, cfg: TwinConfig = DEFAULT_CONFIG): number {
  const ch = cfg.channels.pvt;
  return clampKss(3 + (medianRt - ch.at3) / ch.perKss);
}

type Pvt = Extract<TwinEvent, { type: 'pvt' }>;

const isFullTest = (e: TwinEvent, cfg: TwinConfig): e is Pvt =>
  e.type === 'pvt' && Number.isFinite(e.medianRt) && e.n > 0 && (e.durationS === undefined || e.durationS >= cfg.pvtMinSeconds);

/** Reaction-time anchor at time t in KSS-equivalents, or null if no full test and check-in had been seen. */
function anchorAt(events: TwinEvent[], t: number, cfg: TwinConfig): number | null {
  const before = events.filter((e) => e.t <= t);
  if (!before.some((e) => isFullTest(e, cfg)) || !before.some((e) => e.type === 'kss')) return null;
  const r = replay(events, cfg, { until: t, stepMinutes: 24 * 60 });
  return r.anchors.pvt.mean / cfg.channels.pvt.perKss;
}

const f1 = (x: number) => x.toFixed(1);

export function divergence(events: TwinEvent[], now: number, cfg: TwinConfig = DEFAULT_CONFIG, rules = DIVERGENCE_RULES): Divergence {
  const past = events.filter((e) => e.t <= now);
  const tests = past.filter((e): e is Pvt => isFullTest(e, cfg)).sort((a, b) => a.t - b.t);
  const checkIns = past.filter((e) => e.type === 'kss').length;
  const last = tests.at(-1);
  let latest: Divergence['latest'] = null;
  if (last) {
    const before = replay(past, cfg, { until: last.t - 1, stepMinutes: 24 * 60 });
    const obj = objectiveKss(last.medianRt, cfg);
    latest = { t: last.t, medianRt: last.medianRt, objectiveKss: obj, estimateBefore: before.now.kss, gap: obj - before.now.kss };
  }
  const anchorNow = anchorAt(past, now, cfg);
  const a24 = anchorAt(past, now - 24 * H, cfg);
  const a7 = anchorAt(past, now - 7 * 24 * H, cfg);
  const trend24h = anchorNow !== null && a24 !== null ? anchorNow - a24 : null;
  const trend7d = anchorNow !== null && a7 !== null ? anchorNow - a7 : null;
  const base = { fullTests: tests.length, checkIns, latest, anchorKss: anchorNow, trend24h, trend7d };

  if (tests.length < rules.minFullTests || checkIns < rules.minCheckIns) {
    return {
      ...base,
      verdict: 'not-enough-data',
      message: `Not enough data yet to compare your reaction times with your ratings: it needs at least ${rules.minFullTests} full 3-minute reaction tests and ${rules.minCheckIns} check-in (so far ${tests.length} and ${checkIns}).`,
    };
  }
  // growth over the longest window available: a drift that builds over days is the pattern to catch
  const growth = trend7d ?? trend24h;
  const window = trend7d !== null ? 'the last 7 days' : 'the last 24 hours';
  if (growth !== null && growth >= rules.growthKss) {
    return {
      ...base,
      verdict: 'slower',
      message: `Your reaction times are slower than your ratings suggest, by about ${f1(growth)} KSS points more than at the start of ${window}. People often under-rate how impaired they are after several short nights; take this seriously.`,
    };
  }
  if (latest && latest.gap >= rules.gapKss) {
    return {
      ...base,
      verdict: 'slower',
      message: `Your last reaction test reads about ${f1(latest.gap)} KSS points sleepier than your own estimate. If your reactions are usually this slow, this may just be how you respond; if not, you may be more impaired than you feel.`,
    };
  }
  if (latest && latest.gap <= -rules.gapKss) {
    return {
      ...base,
      verdict: 'faster',
      message: `Your last reaction test reads about ${f1(-latest.gap)} KSS points more alert than your own estimate: your reactions are quicker than your ratings suggest.`,
    };
  }
  return { ...base, verdict: 'agree', message: 'Your reaction times agree with your ratings (within the usual noise).' };
}
