// Track record: how well has the twin predicted this person's own ratings so far?
//
// For every KSS check-in in the log, the twin is replayed on the events strictly before it (so the rating it
// is scored against has not been seen) and its estimate is compared with the rating. This is the same
// leave-future-out comparison the validation study uses as its primary outcome, run on the person's own
// data. The prior alone (Three-Process Model with the recorded sleep, no personal data) is scored the same
// way, so the person can see whether learning from them has helped.
//
// A rating is a noisy integer, so the interval it is checked against is the predictive interval for a
// RATING: the twin's uncertainty about the latent state plus the rating noise, sqrt(offsetSd^2 + sK^2),
// widened by half a scale step for rounding.

import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../twin/twin.ts';

export interface TrackRow {
  t: number;
  rating: number;
  predicted: number; // twin estimate just before the rating (latent KSS, clipped to 1-9)
  priorOnly: number; // Three-Process Model alone at the same moment, with the same sleep history
  error: number; // |rating - predicted|
  priorError: number;
  ratingSd: number; // predictive SD for a rating: sqrt(offsetSd^2 + kssNoiseSd^2)
  inside90: boolean; // |rating - predicted| <= 1.645 * ratingSd + 0.5
}

export interface TrackSummary {
  n: number;
  maeTwin: number | null;
  maePrior: number | null;
  bias: number | null; // mean (predicted - rating): positive = the twin expected you to feel sleepier
  coverage90: number | null; // share of ratings inside the 90% predictive interval
  verdict: string;
}

export interface TrackRecord {
  rows: TrackRow[];
  summary: TrackSummary;
}

// Below this many check-ins the summary does not judge; with a handful of noisy integer ratings any
// difference between the twin and the prior is mostly chance. Ad hoc.
export const TRACK_MIN_FOR_VERDICT = 5;
// Differences smaller than this (KSS points of MAE) are described as "about equal". Ad hoc.
export const TRACK_EQUAL_MARGIN = 0.1;

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const f2 = (x: number) => x.toFixed(2);

/**
 * Scores the twin's prediction before each check-in. One replay per check-in (each replay is linear in the
 * number of events), with a coarse snapshot grid because only the final state is needed. `maxCheckIns`
 * keeps the cost bounded for long logs by scoring only the most recent check-ins.
 */
export function trackRecord(events: TwinEvent[], cfg: TwinConfig = DEFAULT_CONFIG, opts: { maxCheckIns?: number } = {}): TrackRecord {
  const checkIns = events
    .filter((e): e is Extract<TwinEvent, { type: 'kss' }> => e.type === 'kss')
    .sort((a, b) => a.t - b.t)
    .slice(-(opts.maxCheckIns ?? 200));
  const rows: TrackRow[] = [];
  for (const c of checkIns) {
    const r = replay(events, cfg, { until: c.t - 1, stepMinutes: 24 * 60 });
    const predicted = r.now.kss;
    // the snapshot's prior is the clipped Three-Process Model value with the same sleep history; it is what
    // a replay of the sleep events alone would give (no offset, no time on task)
    const priorOnly = r.now.prior;
    const ratingSd = Math.sqrt(r.now.offsetSd ** 2 + cfg.kssNoiseSd ** 2);
    const error = Math.abs(c.value - predicted);
    rows.push({
      t: c.t,
      rating: c.value,
      predicted,
      priorOnly,
      error,
      priorError: Math.abs(c.value - priorOnly),
      ratingSd,
      inside90: error <= 1.645 * ratingSd + 0.5,
    });
  }
  return { rows, summary: summarise(rows) };
}

function summarise(rows: TrackRow[]): TrackSummary {
  const n = rows.length;
  const maeTwin = mean(rows.map((r) => r.error));
  const maePrior = mean(rows.map((r) => r.priorError));
  const bias = mean(rows.map((r) => r.predicted - r.rating));
  const coverage90 = mean(rows.map((r) => (r.inside90 ? 1 : 0)));
  return { n, maeTwin, maePrior, bias, coverage90, verdict: verdict(n, maeTwin, maePrior, coverage90) };
}

function verdict(n: number, maeTwin: number | null, maePrior: number | null, coverage: number | null): string {
  if (n === 0) return 'No check-ins yet. After each check-in, BlinkTwin compares the prediction it made just before with your rating.';
  if (n < TRACK_MIN_FOR_VERDICT || maeTwin === null || maePrior === null || coverage === null) {
    return `So far ${n} check-in${n === 1 ? '' : 's'}: too few to judge how well the twin predicts you. It needs at least ${TRACK_MIN_FOR_VERDICT}.`;
  }
  const inside = Math.round(coverage * n);
  let text = `So far, over ${n} check-ins, the twin's prediction made just before each rating was off by ${f2(maeTwin)} KSS points on average, against ${f2(maePrior)} for the body-clock model alone. ${inside} of ${n} ratings fell inside its 90% range.`;
  if (maeTwin < maePrior - TRACK_EQUAL_MARGIN) text += ' Learning from your check-ins has helped so far.';
  else if (maeTwin > maePrior + TRACK_EQUAL_MARGIN) text += ' So far the body-clock model alone has done better than the twin.';
  else text += ' So far the two have done about equally well.';
  if (n >= 10 && coverage < 0.75) text += ' Its ranges have been too narrow for you.';
  if (n < 20) text += ` This is a small sample (${n} ratings), so treat it as a first impression.`;
  return text;
}
