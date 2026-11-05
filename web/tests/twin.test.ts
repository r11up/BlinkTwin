import { describe, expect, it } from 'vitest';
import { blrInit, blrPredict, blrUpdate } from '../src/twin/blr.ts';
import { alertness, priorKss, sAtWake, TPM_DEFAULTS } from '../src/twin/tpm.ts';
import { DEFAULT_CONFIG, forecast, normalCdf, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';
import { BlinkMeter, percentile } from '../src/sensing/blink.ts';
import { scorePvt } from '../src/probes/pvt-score.ts';

const H = 3_600_000;
const UTC = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 } satisfies TwinConfig;
const day = Date.UTC(2026, 10, 5); // midnight UTC
const sleep = { wake: day + 7 * H, hours: 8 };

describe('three-process model prior', () => {
  it('recovers most of S over a full night', () => {
    expect(sAtWake(8)).toBeGreaterThan(13.5);
    expect(sAtWake(8)).toBeLessThanOrEqual(TPM_DEFAULTS.upperAsymptote);
    expect(sAtWake(4)).toBeLessThan(sAtWake(8));
  });

  it('is groggy at waking, alert mid-afternoon and sleepy before dawn after a night awake', () => {
    const atWake = priorKss(sleep.wake, sleep, TPM_DEFAULTS, 0);
    const afternoon = priorKss(day + 16 * H, sleep, TPM_DEFAULTS, 0);
    const lateNight = priorKss(day + 23 * H, sleep, TPM_DEFAULTS, 0);
    const dawn = priorKss(day + 30 * H, sleep, TPM_DEFAULTS, 0);
    expect(atWake).toBeGreaterThan(afternoon + 2);
    expect(afternoon).toBeLessThan(3.5);
    expect(lateNight).toBeGreaterThan(afternoon);
    expect(dawn).toBeGreaterThan(6.5);
    expect(dawn).toBeLessThanOrEqual(9);
  });

  it('sleep inertia fades within a few hours', () => {
    expect(alertness(sleep.wake, sleep, TPM_DEFAULTS, 0).W).toBeCloseTo(TPM_DEFAULTS.inertiaAmplitude, 5);
    expect(Math.abs(alertness(sleep.wake + 3 * H, sleep, TPM_DEFAULTS, 0).W)).toBeLessThan(0.1);
  });
});

describe('Bayesian linear regression', () => {
  it('moves from the population prior to a person\'s own slope', () => {
    let m = blrInit([4, 1], [1, 1], 0.5);
    for (let i = 0; i < 60; i++) {
      const x = (i % 7) - 3;
      m = blrUpdate(m, [1, x], 6 + 2.5 * x);
    }
    expect(m.mean[0]).toBeCloseTo(6, 1);
    expect(m.mean[1]).toBeCloseTo(2.5, 1);
    expect(blrPredict(m, [1, 0]).variance).toBeLessThan(0.3);
  });
});

describe('twin replay', () => {
  const base: TwinEvent[] = [{ t: day + 6 * H, type: 'sleep', wake: sleep.wake, hours: 8 }];

  it('with no check-ins it follows the prior exactly', () => {
    const r = replay(base, UTC, { until: day + 14 * H });
    expect(r.now.offset).toBe(0);
    expect(r.now.kss).toBeCloseTo(priorKss(day + 14 * H, sleep, TPM_DEFAULTS, 0), 6);
  });

  it('learns a persistent offset from KSS check-ins and becomes more certain', () => {
    const ev: TwinEvent[] = [...base];
    for (let h = 9; h <= 17; h += 2) {
      ev.push({ t: day + h * H, type: 'kss', value: Math.round(priorKss(day + h * H, sleep, TPM_DEFAULTS, 0) + 2) });
    }
    const r = replay(ev, UTC, { until: day + 17.5 * H });
    expect(r.now.offset).toBeGreaterThan(1.3);
    expect(r.now.offsetSd).toBeLessThan(DEFAULT_CONFIG.offsetPriorSd / 2);
    expect(r.contributions.kss).toBeCloseTo(r.now.offset, 6);
    expect(r.checkIns).toBe(5);
  });

  it('attributes the offset to its sources exactly', () => {
    const ev: TwinEvent[] = [
      ...base,
      { t: day + 10 * H, type: 'pvt', medianRt: 420, lapses: 6, n: 40, falseStarts: 1 },
      { t: day + 10.1 * H, type: 'kss', value: 6 },
      { t: day + 11 * H, type: 'cam', perclos: 0.08, blinkRate: 12, meanBlinkMs: 260, coverage: 0.95 },
    ];
    const r = replay(ev, UTC, { until: day + 12 * H });
    const sum = r.contributions.kss + r.contributions.pvt + r.contributions.cam;
    expect(sum).toBeCloseTo(r.now.offset, 9);
    expect(r.calibration.pvt.n).toBe(1);
  });

  it('accumulates time on task and resets it after a long break', () => {
    const ev: TwinEvent[] = [
      ...base,
      { t: day + 9 * H, type: 'context', context: 'focus' },
      { t: day + 11 * H, type: 'context', context: 'break' },
      { t: day + 11.5 * H, type: 'context', context: 'focus' },
    ];
    const during = replay(ev, UTC, { until: day + 10.99 * H });
    expect(during.now.tot).toBeCloseTo(DEFAULT_CONFIG.totPerHour * 1.99, 2);
    const after = replay(ev, UTC, { until: day + 12 * H });
    expect(after.now.tot).toBeCloseTo(DEFAULT_CONFIG.totPerHour * 0.5, 2);
  });

  it('pulls workload towards TLX ratings', () => {
    const ev: TwinEvent[] = [...base, { t: day + 10 * H, type: 'context', context: 'focus' }, { t: day + 10.5 * H, type: 'tlx', value: 85 }];
    const r = replay(ev, UTC, { until: day + 10.5 * H });
    expect(r.now.workload).toBeGreaterThan(70);
  });
});

describe('forecast', () => {
  it('predicts when the person becomes sleepy if they stay up all night', () => {
    const r = replay([{ t: day + 6 * H, type: 'sleep', wake: sleep.wake, hours: 8 }], UTC, { until: day + 20 * H });
    const f = forecast(r, UTC, { hours: 12 });
    expect(f.sleepyAt).not.toBeNull();
    expect((f.sleepyAt as number) - day).toBeGreaterThan(24 * H);
    expect(f.points.at(-1)!.kssSd).toBeGreaterThan(f.points[0].kssSd);
  });

  it('a night of sleep removes the predicted sleepiness', () => {
    const r = replay([{ t: day + 6 * H, type: 'sleep', wake: sleep.wake, hours: 8 }], UTC, { until: day + 20 * H });
    const f = forecast(r, UTC, { hours: 16, scenario: { sleepAt: day + 23 * H, sleepHours: 8 } });
    expect(f.sleepyAt).toBeNull();
    expect(f.points.some((p) => p.asleep)).toBe(true);
  });

  it('normal CDF is accurate', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });
});

describe('blink meter', () => {
  function feed(meter: BlinkMeter, closures: (t: number) => number, seconds: number, fps = 30) {
    for (let i = 0; i < seconds * fps; i++) meter.push((i * 1000) / fps, closures((i * 1000) / fps));
  }

  it('counts blinks and their duration on a synthetic eye signal', () => {
    const m = new BlinkMeter();
    // eyes open at 0.05; a 150 ms blink every 4 s
    feed(m, (t) => (t % 4000 < 150 ? 0.9 : 0.05), 60);
    const w = m.window(60_000);
    expect(w.blinkRate).toBeGreaterThanOrEqual(14);
    expect(w.blinkRate).toBeLessThanOrEqual(16);
    expect(w.meanBlinkMs).toBeGreaterThan(120);
    expect(w.meanBlinkMs).toBeLessThan(200);
    expect(w.coverage).toBe(1);
    expect(w.perclos).toBeLessThan(0.06);
  });

  it('sees drowsy eyes: long closures raise PERCLOS', () => {
    const m = new BlinkMeter();
    feed(m, (t) => (t % 10000 < 1500 ? 0.95 : 0.1), 60);
    const w = m.window(60_000);
    expect(w.longClosures).toBeGreaterThanOrEqual(5);
    expect(w.perclos).toBeGreaterThan(0.1);
  });

  it('adapts to a person whose open-eye score is high', () => {
    const m = new BlinkMeter();
    feed(m, (t) => (t % 3000 < 200 ? 0.97 : 0.4), 60);
    expect(m.window(60_000).blinkRate).toBeGreaterThanOrEqual(19);
  });

  it('percentile interpolates', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe('PVT-B scoring', () => {
  it('counts lapses and false starts', () => {
    const s = scorePvt([250, 260, 400, 600, 80, 300], 2);
    expect(s.n).toBe(5);
    expect(s.lapses).toBe(2);
    expect(s.falseStarts).toBe(3);
    expect(s.medianRt).toBe(300);
  });
});
