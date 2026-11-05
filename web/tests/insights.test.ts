import { describe, expect, it } from 'vitest';
import { divergence, DIVERGENCE_RULES, objectiveKss } from '../src/insights/divergence.ts';
import { sleepStatus } from '../src/insights/sleep.ts';
import { suggestCheckIn, SUGGEST_RULES } from '../src/insights/suggest.ts';
import { trackRecord, TRACK_MIN_FOR_VERDICT } from '../src/insights/trackrecord.ts';
import { alertness, priorKss, TPM_DEFAULTS, type SleepEpisode } from '../src/twin/tpm.ts';
import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const H = 3_600_000;
const M = 60_000;
const DAY = 24 * H;
const START = Date.UTC(2026, 0, 5, 7); // 07:00 UTC
const cfg: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const pvt = cfg.channels.pvt;

const sleepEv = (wake: number, hours = 8): TwinEvent => ({ t: wake, type: 'sleep', wake, hours });
const priorAt = (t: number, sleeps: SleepEpisode[]) => priorKss(t, sleeps[sleeps.length - 1], TPM_DEFAULTS, 0, sleeps);
const rtFor = (kss: number, extra = 0) => pvt.at3 + pvt.perKss * (kss - 3) + extra;
const test = (t: number, medianRt: number, durationS?: number): TwinEvent => ({ t, type: 'pvt', medianRt, lapses: 0, n: 40, falseStarts: 0, durationS });

/** A person who rates exactly the prior, with a full reaction test 5 min after each rating. */
function day(d: number, opts: { ratingShift?: number; rtExtra?: (d: number) => number; hours?: number[] } = {}) {
  const wake = START + d * DAY;
  const sleeps = Array.from({ length: d + 1 }, (_, i) => ({ wake: START + i * DAY, hours: 8 }));
  const ev: TwinEvent[] = [sleepEv(wake)];
  for (const h of opts.hours ?? [3, 8]) {
    const t = wake + h * H;
    const p = priorAt(t, sleeps);
    ev.push({ t, type: 'kss', value: p + (opts.ratingShift ?? 0) });
    ev.push(test(t + 5 * M, rtFor(p, opts.rtExtra?.(d) ?? 0)));
  }
  return ev;
}

describe('track record', () => {
  it('scores near zero error and full coverage for a person who rates exactly the prior', () => {
    const sleeps = [{ wake: START, hours: 8 }];
    const events: TwinEvent[] = [sleepEv(START)];
    for (const h of [2, 4, 6, 8, 10, 12]) events.push({ t: START + h * H, type: 'kss', value: priorAt(START + h * H, sleeps) });
    const tr = trackRecord(events, { ...cfg, usePassive: false });
    expect(tr.summary.n).toBe(6);
    expect(tr.summary.maeTwin).toBeLessThan(0.01);
    expect(tr.summary.maePrior).toBeLessThan(0.01);
    expect(tr.summary.coverage90).toBe(1);
    expect(tr.summary.verdict).toContain('So far, over 6 check-ins');
    expect(tr.summary.verdict).toContain('about equally well');
  });

  it('predicts each rating only from events before it', () => {
    const sleeps = [{ wake: START, hours: 8 }];
    const events: TwinEvent[] = [sleepEv(START), { t: START + 3 * H, type: 'kss', value: 9 }];
    const tr = trackRecord(events, cfg);
    // the first rating cannot have been seen: the prediction is the prior
    expect(tr.rows[0].predicted).toBeCloseTo(priorAt(START + 3 * H, sleeps), 2);
    expect(tr.rows[0].error).toBeGreaterThan(4);
  });

  it('shows that learning helped when the person sits consistently above the prior', () => {
    const sleeps = [{ wake: START, hours: 8 }];
    const events: TwinEvent[] = [sleepEv(START)];
    for (const h of [2, 3, 4, 5, 6, 7, 8, 9]) events.push({ t: START + h * H, type: 'kss', value: Math.min(9, priorAt(START + h * H, sleeps) + 2) });
    const s = trackRecord(events, { ...cfg, usePassive: false }).summary;
    expect(s.maeTwin as number).toBeLessThan((s.maePrior as number) - 0.5);
    expect(s.bias as number).toBeLessThan(0);
    expect(s.verdict).toContain('has helped');
    expect(s.verdict).toContain('small sample');
  });

  it('does not judge with too few check-ins, and explains an empty log', () => {
    expect(trackRecord([sleepEv(START)], cfg).summary.verdict).toContain('No check-ins yet');
    const few: TwinEvent[] = [sleepEv(START), { t: START + 2 * H, type: 'kss', value: 3 }, { t: START + 4 * H, type: 'kss', value: 4 }];
    const s = trackRecord(few, cfg).summary;
    expect(s.n).toBe(2);
    expect(s.verdict).toContain(`at least ${TRACK_MIN_FOR_VERDICT}`);
  });

  it('uses a rating-level interval that includes rating noise and rounding', () => {
    const tr = trackRecord([sleepEv(START), { t: START + 2 * H, type: 'kss', value: 5 }], cfg);
    const row = tr.rows[0];
    expect(row.ratingSd).toBeCloseTo(Math.sqrt(cfg.offsetPriorSd ** 2 + 2 * cfg.offsetDriftSdPerSqrtHour ** 2 + cfg.kssNoiseSd ** 2), 3);
    expect(row.inside90).toBe(row.error <= 1.645 * row.ratingSd + 0.5);
  });

  it('limits the number of scored check-ins', () => {
    const events: TwinEvent[] = [sleepEv(START)];
    for (let i = 1; i <= 12; i++) events.push({ t: START + i * H, type: 'kss', value: 4 });
    expect(trackRecord(events, cfg, { maxCheckIns: 5 }).rows).toHaveLength(5);
  });
});

describe('check-in suggestion', () => {
  const at = (events: TwinEvent[], t: number) => replay(events, cfg, { until: t, stepMinutes: 60 });
  const base = [sleepEv(START)];

  it('asks for the first check-in of the day, but not during the first half hour after waking', () => {
    const s = suggestCheckIn({ now: START + 2 * H, result: at(base, START + 2 * H), lastCheckInAt: null, lastSuggestedAt: null });
    expect(s?.reason).toBe('first-today');
    expect(s?.priority).toBe(1);
    expect(suggestCheckIn({ now: START + 10 * M, result: at(base, START + 10 * M), lastCheckInAt: null, lastSuggestedAt: null })?.reason).not.toBe('first-today');
  });

  it('counts a check-in from yesterday as not today', () => {
    const ev = [sleepEv(START - DAY), { t: START - 10 * H, type: 'kss', value: 4 } as TwinEvent, sleepEv(START)];
    const s = suggestCheckIn({ now: START + 2 * H, result: at(ev, START + 2 * H), lastCheckInAt: START - 10 * H, lastSuggestedAt: null });
    expect(s?.reason).toBe('first-today');
  });

  it('throttles suggestions and stays quiet right after a check-in', () => {
    const now = START + 2 * H;
    const r = at(base, now);
    expect(suggestCheckIn({ now, result: r, lastCheckInAt: null, lastSuggestedAt: now - 10 * M })).toBeNull();
    expect(suggestCheckIn({ now, result: r, lastCheckInAt: null, lastSuggestedAt: now - (SUGGEST_RULES.throttleMinutes + 1) * M })).not.toBeNull();
    const ev = [...base, { t: now - 10 * M, type: 'kss', value: 4 } as TwinEvent];
    expect(suggestCheckIn({ now, result: at(ev, now), lastCheckInAt: now - 10 * M, lastSuggestedAt: null })).toBeNull();
  });

  it('asks when uncertainty has grown since the last check-in', () => {
    const ev = [...base, { t: START + H, type: 'kss', value: 4 } as TwinEvent];
    const now = START + 7 * H;
    const r = at(ev, now);
    expect(r.now.offsetSd).toBeGreaterThan(SUGGEST_RULES.uncertainSd);
    expect(suggestCheckIn({ now, result: r, lastCheckInAt: START + H, lastSuggestedAt: null })?.reason).toBe('uncertain');
  });

  it('asks when KSS 7 is forecast within two hours, and when signals disagree', () => {
    const ev = [...base, { t: START + 4 * H, type: 'kss', value: 4 } as TwinEvent];
    const now = START + 5 * H;
    const r = at(ev, now);
    expect(r.now.offsetSd).toBeLessThan(SUGGEST_RULES.uncertainSd);
    const common = { now, result: r, lastCheckInAt: START + 4 * H, lastSuggestedAt: null };
    expect(suggestCheckIn({ ...common, sleepyAt: now + H })?.reason).toBe('sleepy-soon');
    expect(suggestCheckIn({ ...common, sleepyAt: now + 3 * H })).toBeNull();
    expect(suggestCheckIn({ ...common, rtSurprise: { kss: 2, t: now - H } })?.reason).toBe('signals-disagree');
    expect(suggestCheckIn({ ...common, rtSurprise: { kss: -2, t: now - H } })?.reason).toBe('signals-disagree');
    expect(suggestCheckIn({ ...common, rtSurprise: { kss: 1, t: now - H } })).toBeNull();
    // an old test is no reason to ask now
    expect(suggestCheckIn({ ...common, rtSurprise: { kss: 2.5, t: now - 5 * H } })).toBeNull();
    // the more important reason wins
    expect(suggestCheckIn({ ...common, sleepyAt: now + H, rtSurprise: { kss: 2, t: now - H } })?.reason).toBe('sleepy-soon');
  });

  it('asks after a long stretch of work without a check-in, but not during a break', () => {
    const last = START + 2 * H;
    const now = last + 3.5 * H;
    const work = [...base, { t: last, type: 'kss', value: 4 } as TwinEvent, { t: last + 10 * M, type: 'context', context: 'focus' } as TwinEvent];
    const r = at(work, now);
    expect(r.now.offsetSd).toBeLessThan(SUGGEST_RULES.uncertainSd);
    expect(suggestCheckIn({ now, result: r, lastCheckInAt: last, lastSuggestedAt: null })?.reason).toBe('long-gap');
    const rest = [...work, { t: now - 5 * M, type: 'context', context: 'break' } as TwinEvent];
    expect(suggestCheckIn({ now, result: at(rest, now), lastCheckInAt: last, lastSuggestedAt: null })).toBeNull();
  });
});

describe('objective versus subjective divergence', () => {
  it('reads a test on the population scale and clips it', () => {
    expect(objectiveKss(pvt.at3, cfg)).toBeCloseTo(3, 6);
    expect(objectiveKss(pvt.at3 + 2 * pvt.perKss, cfg)).toBeCloseTo(5, 6);
    expect(objectiveKss(2000, cfg)).toBe(9);
    expect(objectiveKss(100, cfg)).toBe(1);
  });

  it('needs at least two full tests and a check-in, and ignores short tests', () => {
    const ev: TwinEvent[] = [sleepEv(START), { t: START + 3 * H, type: 'kss', value: 3 }, test(START + 3 * H + 5 * M, 340), test(START + 5 * H, 340, 60)];
    const d = divergence(ev, START + 6 * H, cfg);
    expect(d.verdict).toBe('not-enough-data');
    expect(d.fullTests).toBe(1);
    expect(d.message).toContain(`${DIVERGENCE_RULES.minFullTests} full`);
  });

  it('says the signals agree when reaction times follow the ratings', () => {
    const ev = Array.from({ length: 9 }, (_, d) => day(d)).flat();
    const d = divergence(ev, START + 8 * DAY + 10 * H, cfg);
    expect(d.verdict).toBe('agree');
    expect(Math.abs(d.anchorKss as number)).toBeLessThan(0.3);
    expect(Math.abs(d.trend7d as number)).toBeLessThan(0.3);
    expect(Math.abs((d.latest as NonNullable<typeof d.latest>).gap)).toBeLessThan(0.5);
  });

  it('flags reaction times that slow over days while ratings stay flat', () => {
    // from day 2, reactions slow by 20 ms a day relative to the ratings (Van Dongen et al., 2003 pattern)
    const ev = Array.from({ length: 9 }, (_, d) => day(d, { rtExtra: (x) => Math.max(0, x - 1) * 20 })).flat();
    const d = divergence(ev, START + 8 * DAY + 10 * H, cfg);
    expect(d.trend7d).not.toBeNull();
    expect(d.trend7d as number).toBeGreaterThan(DIVERGENCE_RULES.growthKss);
    expect(d.verdict).toBe('slower');
    expect(d.message).toContain('slower than your ratings suggest');
  });

  it('does not judge a single test against the population: a slow responder is not called impaired', () => {
    // one day only: no anchor history, so no verdict, however slow the person's usual reactions are
    const slow = [...day(0), test(START + 9 * H, rtFor(3, 5 * pvt.perKss))];
    const d1 = divergence(slow, START + 10 * H, cfg);
    expect(d1.verdict).toBe('not-enough-data');
    expect((d1.latest as NonNullable<typeof d1.latest>).gap).toBeGreaterThan(1.5); // context only
    // a constitutionally slow responder over 9 days (constant 3 SD slower): the anchor absorbs it, no drift
    const constantSlow = Array.from({ length: 9 }, (_, d) => day(d, { rtExtra: () => 3 * pvt.biasSd })).flat();
    const d2 = divergence(constantSlow, START + 8 * DAY + 10 * H, cfg);
    expect((d2.latest as NonNullable<typeof d2.latest>).objectiveKss).toBeGreaterThan(5);
    expect(d2.verdict).toBe('agree');
    expect(Math.abs((d2.latest as NonNullable<typeof d2.latest>).personalGapKss)).toBeLessThan(1);
  });

  it('flags reactions that become quicker than the ratings over days', () => {
    const ev = Array.from({ length: 9 }, (_, d) => day(d, { rtExtra: (x) => -Math.max(0, x - 1) * 20 })).flat();
    const d = divergence(ev, START + 8 * DAY + 10 * H, cfg);
    expect(d.trend7d as number).toBeLessThan(-DIVERGENCE_RULES.growthKss);
    expect(d.verdict).toBe('faster');
  });

  it("reports the latest test's personal surprise against this person's own expected reaction time", () => {
    const ev = [...Array.from({ length: 3 }, (_, d) => day(d)).flat()];
    const last = ev.filter((e) => e.type === 'pvt').at(-1) as Extract<TwinEvent, { type: 'pvt' }>;
    const surprise = divergence(ev, last.t + H, cfg).latest as NonNullable<ReturnType<typeof divergence>['latest']>;
    const shifted = ev.map((e) => (e === last ? { ...last, medianRt: last.medianRt + 3 * pvt.perKss } : e));
    const s2 = divergence(shifted, last.t + H, cfg).latest as NonNullable<ReturnType<typeof divergence>['latest']>;
    expect(s2.personalGapKss - surprise.personalGapKss).toBeCloseTo(3, 6);
  });
});

describe('sleep history', () => {
  it('reports the default night when nothing is entered', () => {
    const s = sleepStatus([], START + 5 * H, cfg);
    expect(s.usesDefaultSleep).toBe(true);
    expect(s.debt).toBeNull();
    expect(s.missingNights).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.message).toContain('No sleep entered');
  });

  it('adds up the effect of five short nights and splits it into last night and earlier nights', () => {
    const ev = [0, 1, 2, 3, 4].map((d) => sleepEv(START + d * DAY, 5));
    const now = START + 4 * DAY + 8 * H;
    const s = sleepStatus(ev, now, cfg);
    expect(s.usesDefaultSleep).toBe(false);
    expect(s.nights.slice(0, 5).every((n) => n.status === 'recorded')).toBe(true);
    expect(s.nights[5].status).toBe('assumed-habitual');
    const debt = s.debt as NonNullable<typeof s.debt>;
    expect(debt.lastNight).toBeGreaterThan(0);
    expect(debt.earlierNights).toBeGreaterThan(0);
    expect(debt.total).toBeCloseTo(debt.lastNight + debt.earlierNights, 9);
    // the same number computed directly from the Three-Process Model
    const sleeps = [0, 1, 2, 3, 4].map((d) => ({ wake: START + d * DAY, hours: 5 }));
    const direct = -TPM_DEFAULTS.kssSlope * (alertness(now, sleeps[4], TPM_DEFAULTS, 0, sleeps).A - alertness(now, { wake: sleeps[4].wake, hours: 7.5 }, TPM_DEFAULTS, 0, []).A);
    expect(debt.total).toBeCloseTo(direct, 9);
    expect(s.message).toContain(`+${debt.total.toFixed(1)} KSS`);
  });

  it('says a missing night after an earlier entry is treated as a night without sleep', () => {
    const now = START + 6 * DAY + 4 * H;
    // entries for the nights ending 6, 5 and 3 days after START; the night ending on day 4 is missing
    const ev = [3, 5, 6].map((d) => sleepEv(START + d * DAY));
    const s = sleepStatus(ev, now, cfg);
    expect(s.missingNights).toEqual([2, 4, 5, 6]);
    expect(s.nights[2].status).toBe('assumed-no-sleep');
    expect(s.nights[4].status).toBe('assumed-habitual');
    expect(s.message).toContain('nights without sleep');
  });

  it('flags a stale entry: the twin then assumes the person stayed awake', () => {
    const s = sleepStatus([sleepEv(START)], START + 30 * H, cfg);
    expect(s.staleSleep).toBe(true);
    expect(s.hoursSinceWake).toBeCloseTo(30, 6);
    expect(s.nights[0].status).toBe('assumed-no-sleep');
    expect(s.message).toContain('ended 30 h ago');
  });

  it('is quiet when sleep is habitual and up to date', () => {
    const s = sleepStatus([sleepEv(START, 7.5)], START + 6 * H, cfg);
    expect(s.staleSleep).toBe(false);
    expect(Math.abs((s.debt as NonNullable<typeof s.debt>).total)).toBeLessThan(1e-6);
    expect(s.message).toContain('close to habitual');
  });
});
