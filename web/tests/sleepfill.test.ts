import { describe, expect, it } from 'vitest';
import { alertness, priorKss, TPM_DEFAULTS, type SleepEpisode } from '../src/twin/tpm.ts';
import { DEFAULT_CONFIG, forecast, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const H = 3_600_000;
const DAY = 24 * H;
const MON = Date.UTC(2026, 0, 5, 7); // Monday 07:00 UTC
const off: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
const on: TwinConfig = { ...off, fillMissingNights: true };
const sleepEv = (wake: number, hours: number): TwinEvent => ({ t: wake, type: 'sleep', wake, hours });
const prior = (t: number, sleep: SleepEpisode, history: SleepEpisode[]) => priorKss(t, sleep, TPM_DEFAULTS, 0, history);

describe('missing nights', () => {
  it('is off by default, so research replays keep treating gaps as time awake', () => {
    expect(DEFAULT_CONFIG.fillMissingNights).toBeFalsy();
    const t = MON + 2 * DAY + 3 * H; // Wednesday 10:00, only Monday's night entered
    const r = replay([sleepEv(MON, 8)], off, { until: t });
    expect(r.now.prior).toBeCloseTo(prior(t, { wake: MON, hours: 8 }, [{ wake: MON, hours: 8 }]), 9);
    expect(r.now.prior).toBeGreaterThan(8.5); // about 51 h awake
    expect(r.sleepAssumption).toEqual({ usesDefault: false, filledNights: 0 });
  });

  it('with filling on, an entry more than 30 h old gives way to today\'s default night, with habitual nights between', () => {
    const t = MON + 2 * DAY + 3 * H;
    const r = replay([sleepEv(MON, 8)], on, { until: t });
    const wed = { wake: MON + 2 * DAY, hours: off.defaultSleepHours };
    const expected = prior(t, wed, [{ wake: MON, hours: 8 }, { wake: MON + DAY, hours: TPM_DEFAULTS.habitualSleepHours }, wed]);
    expect(r.now.prior).toBeCloseTo(expected, 9);
    expect(r.now.prior).toBeLessThan(5);
    expect(r.sleep).toEqual(wed);
    expect(r.sleepAssumption).toEqual({ usesDefault: true, filledNights: 1 });
  });

  it('with filling on, a gap of more than 30 h between two entries gets habitual nights', () => {
    const t = MON + 2 * DAY + 3 * H;
    const ev = [sleepEv(MON, 8), sleepEv(MON + 2 * DAY, 6)];
    const filled = replay(ev, on, { until: t });
    const raw = replay(ev, off, { until: t });
    const wed = { wake: MON + 2 * DAY, hours: 6 };
    expect(filled.now.prior).toBeCloseTo(prior(t, wed, [{ wake: MON, hours: 8 }, { wake: MON + DAY, hours: TPM_DEFAULTS.habitualSleepHours }, wed]), 9);
    expect(filled.now.prior).toBeLessThan(raw.now.prior - 0.5); // without filling, Tuesday night counts as awake
    expect(filled.sleepAssumption).toEqual({ usesDefault: false, filledNights: 1 });
  });

  it('a night entered with 0 hours is a real all-nighter, even with filling on', () => {
    const t = MON + DAY + 3 * H; // Tuesday 10:00 after no sleep
    const allNighter = replay([sleepEv(MON, 8), sleepEv(MON + DAY, 0)], on, { until: t });
    const asIfAwake = replay([sleepEv(MON, 8)], off, { until: t });
    expect(allNighter.sleepAssumption.filledNights).toBe(0);
    expect(allNighter.now.prior).toBeCloseTo(asIfAwake.now.prior, 6);
    expect(allNighter.now.prior).toBeGreaterThan(6.5);
  });

  it('gives no sleep inertia after a night without sleep', () => {
    const p = alertness(MON + DAY, { wake: MON + DAY, hours: 0 }, TPM_DEFAULTS, 0, [{ wake: MON, hours: 8 }]);
    expect(p.W).toBe(0);
    expect(alertness(MON, { wake: MON, hours: 8 }, TPM_DEFAULTS, 0).W).toBeCloseTo(TPM_DEFAULTS.inertiaAmplitude, 9);
  });

  it('forecasts from the same filled history', () => {
    const t = MON + 2 * DAY + 3 * H;
    const r = replay([sleepEv(MON, 8)], on, { until: t });
    const f = forecast(r, on, { hours: 1, stepMinutes: 60 });
    expect(f.points[0].kss).toBeCloseTo(r.now.kss, 6);
  });
});

describe('sleep status with filled nights', () => {
  it('reports filled nights and today\'s assumed night', async () => {
    const { sleepStatus } = await import('../src/insights/sleep.ts');
    const s = sleepStatus([sleepEv(MON, 8)], MON + 2 * DAY + 3 * H, on);
    expect(s.usesDefaultSleep).toBe(false);
    expect(s.usesFilledNight).toBe(true);
    expect(s.nights[0].status).toBe('filled-habitual');
    expect(s.nights[1].status).toBe('filled-habitual');
    expect(s.nights[2].status).toBe('recorded');
    expect(s.message).toContain('more than 30 h old');
    const raw = sleepStatus([sleepEv(MON, 8)], MON + 2 * DAY + 3 * H, off);
    expect(raw.nights[1].status).toBe('assumed-no-sleep');
    expect(raw.usesFilledNight).toBe(false);
  });
});
