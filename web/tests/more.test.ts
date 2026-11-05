import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scorePvt } from '../src/probes/pvt-score.ts';
import { AlertEngine } from '../src/sensing/alerts.ts';
import { BlinkMeter } from '../src/sensing/blink.ts';
import { HeadTracker } from '../src/sensing/head.ts';
import { makePerson, mulberry32, simulate } from '../src/sim/synth.ts';
import { toCsv } from '../src/store.ts';
import { alertness, sAtWake, TPM_DEFAULTS } from '../src/twin/tpm.ts';
import { DEFAULT_CONFIG, forecast, replay, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';
import { SCIENCE } from '../src/ui/science.ts';

const H = 3_600_000;
const M = 60_000;
const START = Date.UTC(2026, 0, 5, 7);
const UTC: TwinConfig = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };

function day(seed: number, checkIns = [9, 12, 15, 19]) {
  const p = makePerson(seed, mulberry32(seed));
  return simulate(
    p,
    {
      start: START,
      sleepHours: 7,
      awakeHours: 20,
      blockMinutes: 50,
      breakMinutes: 10,
      checkIns: checkIns.map((h) => START + (h - 7) * H),
      pvtEveryHours: 2,
      pvtBeforeCheckIn: true,
      camera: true,
      tzOffsetMinutes: 0,
    },
    mulberry32(seed * 7 + 1),
  );
}

describe('twin invariants over many virtual people', () => {
  for (const personalise of [false, true]) {
    it(`holds for 40 people (personal slopes ${personalise ? 'on' : 'off'})`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const sim = day(seed);
        const r = replay(sim.events, { ...UTC, personalise }, { until: START + 20 * H, from: START, stepMinutes: 15 });
        let last = -Infinity;
        for (const s of r.snapshots) {
          expect(s.t).toBeGreaterThan(last);
          last = s.t;
          expect(s.kss).toBeGreaterThanOrEqual(1);
          expect(s.kss).toBeLessThanOrEqual(9);
          expect(s.kssSd).toBeGreaterThan(0);
          expect(Number.isFinite(s.kss)).toBe(true);
          expect(s.workload).toBeGreaterThanOrEqual(0);
          expect(s.workload).toBeLessThanOrEqual(100);
        }
        const sum = r.contributions.kss + r.contributions.pvt + r.contributions.cam;
        expect(sum).toBeCloseTo(r.now.offset, 9);
        expect(r.anchors.pvtSd).toBeGreaterThan(0);
        expect(r.anchors.camSd).toBeGreaterThan(0);
      }
    });
  }

  it('replay is deterministic and independent of event order', () => {
    const sim = day(3);
    const shuffled = [...sim.events].sort(() => mulberry32(9)() - 0.5).reverse();
    const a = replay(sim.events, UTC, { until: START + 18 * H, from: START });
    const b = replay(shuffled, UTC, { until: START + 18 * H, from: START });
    expect(b.now.kss).toBeCloseTo(a.now.kss, 12);
    expect(b.now.offsetSd).toBeCloseTo(a.now.offsetSd, 12);
  });

  it('ignores events after the requested time (no peeking into the future)', () => {
    const sim = day(5);
    const until = START + 10 * H;
    const a = replay(sim.events, UTC, { until, from: START });
    const b = replay(sim.events.filter((e) => e.t <= until), UTC, { until, from: START });
    expect(a.now.kss).toBe(b.now.kss);
  });

  it('each check-in reduces the uncertainty of the offset', () => {
    const base: TwinEvent[] = [{ t: START - H, type: 'sleep', wake: START, hours: 8 }];
    let prev = Infinity;
    for (let n = 1; n <= 5; n++) {
      const ev = [...base];
      for (let i = 0; i < n; i++) ev.push({ t: START + (2 + i) * H, type: 'kss', value: 4 });
      const r = replay(ev, UTC, { until: START + (2 + n) * H });
      expect(r.now.offsetSd).toBeLessThan(prev);
      prev = r.now.offsetSd;
    }
  });

  it('anchored twin with check-ins beats the rhythm model on average', () => {
    let twinErr = 0;
    let priorErr = 0;
    for (let seed = 100; seed < 130; seed++) {
      const sim = day(seed);
      const tw = replay(sim.events, UTC, { until: START + 20 * H, from: START, stepMinutes: 30 });
      const pr = replay(sim.events.filter((e) => e.type === 'sleep'), UTC, { until: START + 20 * H, from: START, stepMinutes: 30 });
      const truth = new Map(sim.truth.map((p) => [p.t, p.kss]));
      tw.snapshots.forEach((s, i) => {
        const t = truth.get(s.t);
        if (t === undefined) return;
        twinErr += Math.abs(s.kss - t);
        priorErr += Math.abs(pr.snapshots[i].kss - t);
      });
    }
    expect(twinErr).toBeLessThan(priorErr);
  });
});

describe('forecast and what-if', () => {
  const sim = day(11);
  const atFocus = sim.events.find((e) => e.type === 'context' && e.context === 'focus' && e.t > START + 10 * H) as TwinEvent;
  const r = replay(sim.events, UTC, { until: atFocus.t + 40 * M, from: START });

  it('a break now never forecasts more sleepiness than carrying on', () => {
    const go = forecast(r, UTC, { hours: 2, scenario: {} });
    const rest = forecast(r, UTC, { hours: 2, scenario: { breakNow: true } });
    go.points.forEach((p, i) => expect(rest.points[i].kss).toBeLessThanOrEqual(p.kss + 1e-9));
  });

  it('sleeping tonight lowers next-morning sleepiness compared with staying up', () => {
    const up = forecast(r, UTC, { hours: 16 });
    const bed = forecast(r, UTC, { hours: 16, scenario: { sleepAt: START + 16 * H, sleepHours: 8 } });
    const morning = START + 26 * H;
    const near = (pts: typeof up.points) => pts.reduce((a, b) => (Math.abs(b.t - morning) < Math.abs(a.t - morning) ? b : a));
    expect(near(bed.points).kss).toBeLessThan(near(up.points).kss);
  });

  it('probability of KSS >= 7 rises with the forecast mean and stays in [0, 1]', () => {
    const f = forecast(r, UTC, { hours: 14 });
    for (const p of f.points) {
      expect(p.pSleepy).toBeGreaterThanOrEqual(0);
      expect(p.pSleepy).toBeLessThanOrEqual(1);
    }
    const sorted = [...f.points].sort((a, b) => a.kss - b.kss);
    expect(sorted[sorted.length - 1].pSleepy).toBeGreaterThan(sorted[0].pSleepy);
  });
});

describe('three-process model', () => {
  it('circadian alertness peaks near 16:48', () => {
    const sleep = { wake: START, hours: 8 };
    let best = { h: 0, c: -Infinity };
    for (let h = 0; h < 24; h += 0.1) {
      const c = alertness(Date.UTC(2026, 0, 5, 0) + h * H, sleep, TPM_DEFAULTS, 0).C;
      if (c > best.c) best = { h, c };
    }
    expect(best.h).toBeCloseTo(16.8, 0);
  });

  it('more sleep gives more sleep pressure recovery', () => {
    for (let h = 1; h < 12; h++) expect(sAtWake(h + 1)).toBeGreaterThan(sAtWake(h));
  });
});

describe('sensing edge cases', () => {
  it('blink meter copes with 15 fps, jitter and lost-face frames', () => {
    const m = new BlinkMeter();
    const rng = mulberry32(4);
    let t = 0;
    while (t < 60_000) {
      const lost = t > 20_000 && t < 26_000;
      m.push(t, lost ? null : t % 3000 < 200 ? 0.92 : 0.06);
      t += 1000 / 15 + (rng() - 0.5) * 20;
    }
    const w = m.window(60_000);
    expect(w.coverage).toBeGreaterThan(0.85);
    expect(w.coverage).toBeLessThan(0.95);
    expect(w.blinkRate).toBeGreaterThanOrEqual(15);
    expect(w.blinkRate).toBeLessThanOrEqual(20);
  });

  it('does not count a closure longer than a second as a blink', () => {
    const m = new BlinkMeter();
    for (let t = 0; t < 30_000; t += 33) m.push(t, t > 10_000 && t < 12_500 ? 0.95 : 0.05);
    const w = m.window(30_000, 30_000);
    expect(w.blinks).toBe(0);
    expect(w.longClosures).toBe(1);
  });

  it('head movement is near zero for a still head and larger when moving', () => {
    const still = new HeadTracker();
    const moving = new HeadTracker();
    for (let t = 0; t < 10_000; t += 40) {
      still.push(t, { pitch: 2, yaw: 1, roll: 0 });
      moving.push(t, { pitch: 10 * Math.sin(t / 500), yaw: 8 * Math.cos(t / 700), roll: 0 });
    }
    expect(still.movement(10_000)).toBeLessThan(0.01);
    expect(moving.movement(10_000)).toBeGreaterThan(5);
  });

  it('no alarm without a face, and a warning does not repeat within the cooldown', () => {
    const a = new AlertEngine();
    expect(a.frame({ t: 0, face: false, eyesClosedForMs: 5000, headDroppedForMs: 5000, closure: 1 }).state.level).not.toBe('alarm');
    a.updateMinute({ perclos: 0.3, longClosures: 0, meanBlinkMs: 150, blinks: 10, twinKss: 3 });
    expect(a.frame({ t: 10_000, face: true, eyesClosedForMs: 0, headDroppedForMs: 0, closure: 0 }).state.level).toBe('warning');
    a.acknowledge(11_000);
    expect(a.frame({ t: 60_000, face: true, eyesClosedForMs: 0, headDroppedForMs: 0, closure: 0 }).state.level).toBe('ok');
    expect(a.frame({ t: 400_000, face: true, eyesClosedForMs: 0, headDroppedForMs: 0, closure: 0 }).state.level).toBe('warning');
  });

  it('PVT scoring handles an empty or all-false-start test', () => {
    const empty = scorePvt([], 0);
    expect(empty.n).toBe(0);
    expect(Number.isNaN(empty.medianRt)).toBe(true);
    const all = scorePvt([50, 60, 70], 4);
    expect(all.n).toBe(0);
    expect(all.falseStarts).toBe(7);
  });
});

describe('data export', () => {
  it('CSV has a header and one row per event, with alert reasons quoted', () => {
    const ev: TwinEvent[] = [
      { t: START, type: 'kss', value: 5 },
      { t: START + M, type: 'alert', level: 'warning', reason: 'Slow blinks, 320 ms' },
      { t: START + 2 * M, type: 'cam', perclos: 0.05, blinkRate: 14, meanBlinkMs: 210, coverage: 0.9, nods: 1, headMovement: 2.5 },
    ];
    const lines = toCsv(ev).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0].split(',')).toContain('reason');
    expect(lines[2]).toContain('"Slow blinks, 320 ms"');
  });
});

describe('science text matches the results', () => {
  const sim = JSON.parse(readFileSync(new URL('../../results/sim_summary.json', import.meta.url), 'utf8'));
  const drozy = JSON.parse(readFileSync(new URL('../../results/drozy_summary.json', import.meta.url), 'utf8'));
  const text = SCIENCE.map((s) => s.html).join(' ');
  const mae = (method: string, k: number) => sim.mae.find((r: { method: string; k: number }) => r.method === method && r.k === k).mae as number;
  const fc = (method: string) => sim.forecast.find((r: { method: string }) => r.method === method).brier as number;

  it('quotes the simulation numbers correctly', () => {
    expect(text).toContain(mae('anchor', 3).toFixed(3));
    expect(text).toContain(mae('prior', 0).toFixed(3));
    expect(text).toContain(mae('anchor', 1).toFixed(3));
    expect(text).toContain(mae('checkins', 1).toFixed(3));
    expect(text).toContain(fc('anchor').toFixed(3));
    expect(text).toContain(fc('prior').toFixed(3));
  });

  it('quotes the DROZY numbers correctly', () => {
    const json = JSON.stringify(drozy);
    for (const n of ['0.88', '0.77']) expect(text).toContain(n);
    expect(json).toMatch(/0\.88/);
    expect(json).toMatch(/0\.77/);
  });

  it('every in-text citation appears in the reference list', () => {
    const refs = SCIENCE.find((s) => s.id === 'refs')?.html ?? '';
    const cited = new Set([...text.matchAll(/([A-ZÅ][a-zå]+)(?: et al\.| &amp; [A-ZÅ][a-zå]+)?,? (\d{4})/g)].map((m) => `${m[1]} ${m[2]}`));
    for (const c of cited) {
      const [name, year] = c.split(' ');
      if (['Kartynnik', 'Kalman', 'Massoz', 'Basner', 'Wierwille', 'Dinges', 'Caffier', 'Schleicher', 'Ingre', 'Kaida', 'Hart', 'Åkerstedt'].includes(name)) {
        expect(refs).toContain(name);
        expect(refs).toContain(year);
      }
    }
  });
});
