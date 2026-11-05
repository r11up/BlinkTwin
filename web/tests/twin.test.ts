import { describe, expect, it } from 'vitest';
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
    // after the first hour of sleep inertia, the next morning stays below KSS 7
    const wake = day + 31 * H;
    expect(f.points.filter((p) => !p.asleep && p.t >= wake + H).every((p) => p.kss < 7)).toBe(true);
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

import { AlertEngine } from '../src/sensing/alerts.ts';
import { HeadTracker, poseFromMatrix } from '../src/sensing/head.ts';

describe('head pose', () => {
  it('reads zero angles from an identity matrix and a known pitch', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(poseFromMatrix(id)).toEqual({ pitch: 0, yaw: -0, roll: 0 });
    const a = (20 * Math.PI) / 180;
    // rotation about x by 20 degrees, column-major
    const rx = [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
    expect(poseFromMatrix(rx).pitch).toBeCloseTo(20, 5);
  });

  it('detects a nod relative to the resting pose', () => {
    const h = new HeadTracker();
    let t = 0;
    for (; t < 10_000; t += 40) h.push(t, { pitch: 5, yaw: 0, roll: 0 });
    for (; t < 10_800; t += 40) h.push(t, { pitch: 25, yaw: 0, roll: 0 });
    expect(h.droppedFor(t - 40)).toBeGreaterThan(600);
    for (; t < 12_000; t += 40) h.push(t, { pitch: 5, yaw: 0, roll: 0 });
    expect(h.nodsIn(t)).toBe(1);
  });
});

describe('alerts', () => {
  const frame = (t: number, closedMs = 0, headMs = 0, closure = 0) => ({ t, face: true, eyesClosedForMs: closedMs, headDroppedForMs: headMs, closure });

  it('sounds an alarm after a second of closed eyes and clears once eyes stay open', () => {
    const a = new AlertEngine();
    expect(a.frame(frame(0, 500, 0, 1)).state.level).toBe('ok');
    const r = a.frame(frame(600, 1100, 0, 1));
    expect(r.state.level).toBe('alarm');
    expect(r.escalated).toBe(true);
    a.frame(frame(700));
    expect(a.frame(frame(1500)).state.level).toBe('alarm');
    expect(a.frame(frame(2300)).state.level).toBe('ok');
  });

  it('alarms on a head drop only when the eyes are closing', () => {
    const a = new AlertEngine();
    expect(a.frame(frame(0, 0, 1500, 0.1)).state.level).toBe('ok');
    expect(a.frame(frame(100, 0, 1600, 0.7)).state.level).toBe('alarm');
  });

  it('warns on high PERCLOS, with a cooldown', () => {
    const a = new AlertEngine();
    a.updateMinute({ perclos: 0.2, longClosures: 0, meanBlinkMs: 150, blinks: 12, twinKss: 4 });
    expect(a.frame(frame(1000)).state.level).toBe('warning');
    a.acknowledge(1100);
    expect(a.frame(frame(2000)).state.level).toBe('ok');
    a.updateMinute({ perclos: 0.02, longClosures: 0, meanBlinkMs: 150, blinks: 12, twinKss: 7.4 });
    expect(a.frame(frame(400_000)).state.reason).toContain('KSS');
  });

  it('gives a notice when the face is lost', () => {
    const a = new AlertEngine();
    a.frame(frame(0));
    expect(a.frame({ t: 6000, face: false, eyesClosedForMs: 0, headDroppedForMs: 0, closure: 0 }).state.level).toBe('notice');
  });
});

describe('anchoring', () => {
  it('a passive channel that reads a person wrong is absorbed by its anchor, not the offset', () => {
    // eyes always look very sleepy while the person keeps reporting the rhythm-model level
    const sl = { wake: day + 7 * H, hours: 8 };
    const ev: TwinEvent[] = [{ t: day + 6 * H, type: 'sleep', wake: sl.wake, hours: 8 }];
    for (let m = 0; m < 8 * 60; m++) ev.push({ t: day + 9 * H + m * 60_000, type: 'cam', perclos: 0.12, blinkRate: 15, meanBlinkMs: 300, coverage: 1 });
    for (let h = 10; h <= 16; h += 2) ev.push({ t: day + h * H, type: 'kss', value: Math.round(priorKss(day + h * H, sl, TPM_DEFAULTS, 0)) });
    const anchored = replay(ev, UTC, { until: day + 17 * H });
    const naive = replay(ev, { ...UTC, useAnchors: false }, { until: day + 17 * H });
    expect(Math.abs(anchored.now.offset)).toBeLessThan(Math.abs(naive.now.offset));
    expect(anchored.anchors.perclos.mean).toBeGreaterThan(2);
    expect(anchored.anchors.blink.mean).toBeGreaterThan(30);
  });
});

describe('anchor modes: consider-covariance comparator', () => {
  const day = Date.UTC(2026, 0, 5, 0);
  const wake = day + 7 * H;
  // a person whose reaction times are always 3 between-person SDs slower than the population at KSS 3
  const slow = UTC.channels.pvt.at3 + 3 * UTC.channels.pvt.biasSd;
  const tests = Array.from({ length: 10 }, (_, i) => ({ t: wake + (2 + i) * 0.5 * H, type: 'pvt' as const, medianRt: slow, lapses: 3, n: 45, falseStarts: 0 }));
  const ev: TwinEvent[] = [{ t: wake, type: 'sleep', wake, hours: 8 }, ...tests];
  const run = (mode: 'estimate' | 'consider' | 'none', events = ev) => replay(events, { ...UTC, anchorMode: mode }, { until: wake + 8 * H });

  const isSymmetricPositiveDefinite = (P: number[][]) => {
    const n = P.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (Math.abs(P[i][j] - P[j][i]) > 1e-9) return false;
    // Cholesky
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) {
        let sum = P[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          if (sum <= 0) return false;
          L[i][i] = Math.sqrt(sum);
        } else L[i][j] = sum / L[j][j];
      }
    return true;
  };

  it('never moves the anchors and keeps the covariance symmetric positive definite', () => {
    const r = run('consider');
    for (const c of ['pvt', 'blink', 'perclos'] as const) expect(r.anchors[c].mean).toBe(0);
    expect(isSymmetricPositiveDefinite(r.covariance)).toBe(true);
    expect(r.anchors.pvt.sd).toBeGreaterThan(0);
  });

  it('moves the offset less than a filter that treats the persistent bias as fresh noise', () => {
    const none = run('none').now.offset;
    const consider = run('consider').now.offset;
    expect(consider).toBeGreaterThan(0);
    expect(consider).toBeLessThan(none);
    // the last of ten identical readings moves the offset less under consider-covariance
    const lastStep = (mode: 'consider' | 'none') => run(mode).now.offset - run(mode, ev.slice(0, -1)).now.offset;
    expect(lastStep('consider')).toBeLessThan(lastStep('none'));
  });

  it("matches useAnchors: false for mode 'none' and the default for 'estimate'", () => {
    expect(run('none').now.offset).toBe(replay(ev, { ...UTC, useAnchors: false }, { until: wake + 8 * H }).now.offset);
    expect(run('estimate').now.offset).toBe(replay(ev, UTC, { until: wake + 8 * H }).now.offset);
  });
});

describe('mean-reverting offset (offsetReversionHours)', () => {
  const day = Date.UTC(2026, 0, 5, 0);
  const wake = day + 7 * H;
  const cfg = { ...UTC, offsetReversionHours: 24 };
  const ev: TwinEvent[] = [
    { t: wake, type: 'sleep', wake, hours: 8 },
    { t: wake + 3 * H, type: 'kss', value: 9 },
  ];

  it('decays the learned offset towards zero with the given time constant', () => {
    const at = (h: number) => replay(ev, cfg, { until: wake + 3 * H + h * H }).now.offset;
    const d0 = at(0);
    expect(d0).toBeGreaterThan(1);
    expect(at(24)).toBeCloseTo(d0 * Math.exp(-1), 6);
    expect(at(72)).toBeCloseTo(d0 * Math.exp(-3), 6);
    // the random walk keeps it
    expect(replay(ev, UTC, { until: wake + 75 * H }).now.offset).toBeCloseTo(replay(ev, UTC, { until: wake + 3 * H }).now.offset, 9);
  });

  it('keeps the offset variance bounded by its stationary value', () => {
    const sdAfter = (c: TwinConfig, days: number) => replay(ev, c, { until: wake + days * 24 * H }).now.offsetSd;
    expect(sdAfter(cfg, 30)).toBeCloseTo(cfg.offsetPriorSd, 3);
    expect(sdAfter(cfg, 30)).toBeLessThanOrEqual(cfg.offsetPriorSd + 1e-9);
    expect(sdAfter(UTC, 30)).toBeGreaterThan(5); // a random walk keeps growing
  });

  it('forecasts a decaying offset with bounded uncertainty', () => {
    const r = replay(ev, cfg, { until: wake + 4 * H });
    const f = forecast(r, cfg, { hours: 12 });
    const last = f.points[f.points.length - 1];
    expect(last.kssSd).toBeLessThanOrEqual(cfg.offsetPriorSd + 1e-9);
    const rw = forecast(replay(ev, UTC, { until: wake + 4 * H }), UTC, { hours: 12 });
    expect(last.kssSd).toBeLessThan(rw.points[rw.points.length - 1].kssSd);
  });
});
