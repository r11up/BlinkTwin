// When should the app ask for a check-in?
//
// Check-ins carry most of the information about how sleepy a person feels (simulation and DROZY replay in
// the paper), but every prompt costs attention, so the app should ask when a rating is worth the most. This
// policy asks when the twin's knowledge of the person is weakest or a decision is near: at the start of the
// day, when the uncertainty has grown, when sleepiness is forecast to reach KSS 7 soon, when the objective
// reaction-time reading disagrees with the estimate, or after a long stretch of work without a rating.
// It never asks more than once per throttle window, and not within a short time after a check-in.
//
// All thresholds are ad hoc defaults chosen to keep prompts to a few per day; none has been validated.

import type { TwinResult } from '../twin/twin.ts';

export type SuggestReason = 'first-today' | 'uncertain' | 'sleepy-soon' | 'signals-disagree' | 'long-gap';

export interface Suggestion {
  reason: SuggestReason;
  priority: number; // 1 = most important
  message: string;
}

export interface SuggestInput {
  now: number;
  result: TwinResult; // replay up to now
  sleepyAt?: number | null; // forecast().sleepyAt, the predicted time of reaching KSS 7
  lastCheckInAt: number | null;
  lastSuggestedAt: number | null;
  objectiveGap?: number | null; // divergence().latest.gap: objective reading minus estimate, KSS points
}

export const SUGGEST_RULES = {
  throttleMinutes: 45, // never suggest more often than this
  quietAfterCheckInMinutes: 30, // nothing to gain right after a rating
  afterWakeMinutes: 30, // during the first half hour, ratings mostly measure sleep inertia
  uncertainSd: 0.9, // offset SD in KSS: the 90% range is wider than about +-1.5 points
  sleepyWithinHours: 2,
  disagreeKss: 1.5,
  longGapHours: 3,
};

const M = 60_000;
const H = 3_600_000;

/** Returns the most important reason to ask for a check-in now, or null. */
export function suggestCheckIn(input: SuggestInput, rules = SUGGEST_RULES): Suggestion | null {
  const { now, result } = input;
  if (input.lastSuggestedAt !== null && now - input.lastSuggestedAt < rules.throttleMinutes * M) return null;
  if (input.lastCheckInAt !== null && now - input.lastCheckInAt < rules.quietAfterCheckInMinutes * M) return null;

  const wake = result.sleep.wake;
  const sinceWake = now - wake;
  const ratedSinceWake = input.lastCheckInAt !== null && input.lastCheckInAt >= wake;
  const working = result.context !== 'break' && result.context !== 'unset';
  const candidates: Suggestion[] = [];

  if (!ratedSinceWake && sinceWake >= rules.afterWakeMinutes * M) {
    candidates.push({ reason: 'first-today', priority: 1, message: 'No check-in yet today. One rating sets your level for the day.' });
  }
  if (result.now.offsetSd > rules.uncertainSd) {
    candidates.push({
      reason: 'uncertain',
      priority: 2,
      message: `The twin is unsure about you right now (90% range about ±${(1.645 * result.now.offsetSd).toFixed(1)} KSS). A check-in would narrow it.`,
    });
  }
  if (input.sleepyAt && input.sleepyAt > now && input.sleepyAt - now <= rules.sleepyWithinHours * H && result.now.kss < 7) {
    candidates.push({ reason: 'sleepy-soon', priority: 3, message: 'You are forecast to reach KSS 7 (sleepy) within two hours. A check-in now tells the twin whether that is on track.' });
  }
  if (input.objectiveGap !== null && input.objectiveGap !== undefined && Math.abs(input.objectiveGap) >= rules.disagreeKss) {
    candidates.push({ reason: 'signals-disagree', priority: 4, message: 'Your last reaction test disagrees with the twin’s estimate. How do you feel?' });
  }
  if (working && input.lastCheckInAt !== null && now - input.lastCheckInAt > rules.longGapHours * H) {
    candidates.push({ reason: 'long-gap', priority: 5, message: `No check-in for more than ${rules.longGapHours} hours of work.` });
  }
  return candidates.sort((a, b) => a.priority - b.priority)[0] ?? null;
}
