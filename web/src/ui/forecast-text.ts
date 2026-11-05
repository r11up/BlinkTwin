import { fmtClock } from './charts.ts';

/**
 * The Now card's forecast sentence. The predicted time of reaching KSS 7 comes with the times at which the
 * chance of KSS 7 or more reaches 1 in 4 and 3 in 4 (forecast().sleepyWindow), so that a single clock time
 * is not read as exact.
 */
export function forecastText(kssNow: number, sleepyAt: number | null, w: { from: number | null; to: number | null }, now: number): string {
  if (kssNow >= 7) return `You are at <b>KSS 7 or above</b> (sleepy) now.`;
  const from = w.from !== null && w.from > now ? w.from : null; // a time already past adds nothing
  if (sleepyAt === null) {
    return from !== null
      ? `KSS 7 (sleepy) is not expected in the next 8 hours; the chance reaches 1 in 4 at ${fmtClock(from)}.`
      : `KSS 7 (sleepy) is not expected in the next 8 hours.`;
  }
  const chances = [from !== null ? `a 1 in 4 chance by ${fmtClock(from)}` : '', w.to !== null ? `3 in 4 by ${fmtClock(w.to)}` : ''].filter(Boolean);
  return `At this rate you will reach <b>KSS 7</b> (sleepy) around <b>${fmtClock(sleepyAt)}</b>${chances.length ? `: ${chances.join(', ')}` : ''}.`;
}
