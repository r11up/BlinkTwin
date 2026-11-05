import { describe, expect, it } from 'vitest';
import { AlertEngine } from '../src/sensing/alerts.ts';
import { BlinkMeter, percentile } from '../src/sensing/blink.ts';
import { LookDownGate } from '../src/sensing/head.ts';
import { tlxFromItems } from '../src/ui/dialogs.ts';
import { mulberry32 } from '../src/sim/synth.ts';
import { toCsv } from '../src/store.ts';
import { DEFAULT_CONFIG, forecast, replay, type TwinEvent } from '../src/twin/twin.ts';

// The blink meter as released before the long-closure fix, kept verbatim as a reference: for closures
// shorter than the freeze time the fixed meter must give exactly the same outputs.
class ReferenceBlinkMeter {
  private raw: { t: number; v: number }[] = [];
  private frames: { t: number; closure: number | null }[] = [];
  private blinks: { start: number; end: number; durationMs: number }[] = [];
  private longClosures: { start: number; end: number; durationMs: number }[] = [];
  private closingSince: number | null = null;

  push(t: number, score: number | null): number | null {
    if (score === null) {
      this.frames.push({ t, closure: null });
      this.closingSince = null;
      this.trim(t);
      return null;
    }
    this.raw.push({ t, v: score });
    while (this.raw.length && this.raw[0].t < t - 30_000) this.raw.shift();
    const base = percentile(this.raw.map((r) => r.v), 0.2);
    const closure = Math.min(1, Math.max(0, (score - base) / Math.max(1e-6, 1 - base)));
    this.frames.push({ t, closure });
    if (this.closingSince === null && closure >= 0.5) {
      this.closingSince = t;
    } else if (this.closingSince !== null && closure <= 0.3) {
      const b = { start: this.closingSince, end: t, durationMs: t - this.closingSince };
      if (b.durationMs >= 50 && b.durationMs <= 1000) this.blinks.push(b);
      else if (b.durationMs > 1000) this.longClosures.push(b);
      this.closingSince = null;
    }
    this.trim(t);
    return closure;
  }

  closedFor(t: number): number {
    return this.closingSince === null ? 0 : t - this.closingSince;
  }

  window(tEnd: number, lengthMs = 60_000) {
    const from = tEnd - lengthMs;
    const frames = this.frames.filter((f) => f.t > from && f.t <= tEnd);
    const face = frames.filter((f) => f.closure !== null);
    const closed = face.filter((f) => (f.closure as number) >= 0.8).length;
    const blinks = this.blinks.filter((b) => b.end > from && b.end <= tEnd);
    return {
      t: tEnd,
      perclos: face.length ? closed / face.length : 0,
      blinkRate: blinks.length / (lengthMs / 60_000),
      blinks: blinks.length,
      meanBlinkMs: blinks.length ? blinks.reduce((s, b) => s + b.durationMs, 0) / blinks.length : 0,
      longClosures: this.longClosures.filter((b) => b.end > from && b.end <= tEnd).length,
      coverage: frames.length ? face.length / frames.length : 0,
    };
  }

  private trim(t: number) {
    const keep = t - 5 * 60_000;
    while (this.frames.length && this.frames[0].t < keep) this.frames.shift();
    while (this.blinks.length && this.blinks[0].end < keep) this.blinks.shift();
    while (this.longClosures.length && this.longClosures[0].end < keep) this.longClosures.shift();
  }
}

/** A noisy eye-closure trace: open level drifting around `open`, blinks of the given durations, some lost faces. */
function trace(seed: number, seconds: number, durations: number[], open = 0.08, peak = 0.92, fps = 20) {
  const rng = mulberry32(seed);
  const events: { start: number; end: number }[] = [];
  let t = 2000;
  while (t < seconds * 1000) {
    const d = durations[Math.floor(rng() * durations.length)];
    events.push({ start: t, end: t + d });
    t += d + 1500 + rng() * 4000;
  }
  const out: { t: number; score: number | null }[] = [];
  let k = 0;
  for (let i = 0; i < seconds * fps; i++) {
    const tt = (i * 1000) / fps + (rng() - 0.5) * 6;
    const lost = tt % 47_000 > 45_000;
    while (k < events.length && events[k].end <= tt) k++;
    const closed = k < events.length && tt >= events[k].start;
    const level = open + 0.03 * Math.sin(tt / 20_000) + (rng() - 0.5) * 0.04;
    out.push({ t: tt, score: lost ? null : closed ? peak + (rng() - 0.5) * 0.05 : level });
  }
  return out;
}

describe('blink meter: long-closure baseline freeze', () => {
  it('gives exactly the previous outputs when every closure is shorter than 2 s', () => {
    for (const [seed, durations, open] of [
      [1, [120, 180, 250, 400], 0.06],
      [2, [90, 150, 1200, 1700, 1850], 0.15],
      [3, [200, 600, 900, 1500], 0.35],
    ] as [number, number[], number][]) {
      const now = new BlinkMeter();
      const ref = new ReferenceBlinkMeter();
      let nextWindow = 10_000;
      for (const f of trace(seed, 240, durations, open)) {
        expect(now.push(f.t, f.score)).toBe(ref.push(f.t, f.score));
        expect(now.closedFor(f.t)).toBe(ref.closedFor(f.t));
        if (f.t >= nextWindow) {
          const { peakClosure, ...w } = now.window(f.t);
          expect(w).toEqual(ref.window(f.t));
          expect(peakClosure === null || (peakClosure >= 0 && peakClosure <= 1)).toBe(true);
          nextWindow += 10_000;
        }
      }
    }
  });

  it('reproduces the previous meter exactly with the freeze switched off, long closures included', () => {
    const legacy = new BlinkMeter({ freezeAfterMs: Infinity });
    const ref = new ReferenceBlinkMeter();
    for (const f of trace(5, 240, [150, 3000, 12_000, 40_000])) {
      expect(legacy.push(f.t, f.score)).toBe(ref.push(f.t, f.score));
      expect(legacy.closedFor(f.t)).toBe(ref.closedFor(f.t));
    }
    const { peakClosure, ...w } = legacy.window(240_000, 240_000);
    void peakClosure;
    expect(w).toEqual(ref.window(240_000, 240_000));
  });

  it('reports a 40-s eye closure as one continuous closure and keeps the alarm on throughout', () => {
    const fps = 30;
    const score = (t: number) => (t >= 60_000 && t < 100_000 ? 0.93 : 0.07);
    const now = new BlinkMeter();
    const ref = new ReferenceBlinkMeter();
    const alerts = new AlertEngine();
    let refEnded = false;
    let maxClosed = 0;
    for (let i = 0; i < 130 * fps; i++) {
      const t = (i * 1000) / fps;
      const c = now.push(t, score(t)) as number;
      ref.push(t, score(t));
      if (t >= 60_100 && t < 100_000) {
        expect(c).toBeGreaterThanOrEqual(0.5);
        expect(now.closedFor(t)).toBeCloseTo(t - 60_000, -2);
        const level = alerts.frame({ t, face: true, eyesClosedForMs: now.closedFor(t), headDroppedForMs: 0, closure: c }).state.level;
        if (t >= 61_100) expect(level).toBe('alarm');
        if (ref.closedFor(t) === 0) refEnded = true;
      }
      maxClosed = Math.max(maxClosed, now.closedFor(t));
    }
    expect(refEnded).toBe(true); // the previous meter lost the closure part-way through
    expect(maxClosed).toBeGreaterThan(39_900);
    expect(now.window(130_000, 130_000).longClosures).toBe(1);
  });

  it('counts blinks normally right after a long closure', () => {
    const fps = 30;
    const score = (t: number) => {
      if (t >= 30_000 && t < 70_000) return 0.93; // 40-s closure
      return t > 70_000 && (t - 70_000) % 2000 < 150 ? 0.93 : 0.07; // a blink every 2 s after it
    };
    const m = new BlinkMeter();
    for (let i = 0; i < 82 * fps; i++) m.push((i * 1000) / fps, score((i * 1000) / fps));
    const w = m.window(82_000, 11_000); // 71 to 82 s, starting 1 s after the eyes reopened
    expect(w.blinks).toBeGreaterThanOrEqual(5);
  });

  it('releases the freeze after 60 s so a sustained change of eye level is adapted to', () => {
    const fps = 30;
    const m = new BlinkMeter();
    let endedAt: number | null = null;
    for (let i = 0; i < 150 * fps; i++) {
      const t = (i * 1000) / fps;
      m.push(t, t >= 30_000 ? 0.7 : 0.07); // e.g. looking down for good
      if (t > 31_000 && endedAt === null && m.closedFor(t) === 0) endedAt = t;
    }
    expect(endedAt).not.toBeNull();
    expect(endedAt as number).toBeGreaterThanOrEqual(90_000);
    expect(endedAt as number).toBeLessThan(91_000);
  });
});

describe('blink meter: peak closure of blinks', () => {
  const run = (open: number, peak: number, every = 3000) => {
    const m = new BlinkMeter();
    for (let i = 0; i < 60 * 30; i++) {
      const t = (i * 1000) / 30;
      m.push(t, t % every < 200 ? peak : open);
    }
    return m.window(60_000);
  };

  it('is high when blinks close the eyes fully', () => {
    const w = run(0.05, 0.95);
    expect(w.peakClosure).not.toBeNull();
    expect(w.peakClosure as number).toBeGreaterThan(0.9);
  });

  it('is low when the camera never sees a full closure (as in DROZY near-infrared video)', () => {
    const w = run(0.13, 0.65);
    expect(w.blinks).toBeGreaterThanOrEqual(15);
    expect(w.perclos).toBe(0);
    expect(w.peakClosure as number).toBeLessThan(0.65);
  });

  it('is missing with fewer than three blinks', () => {
    expect(run(0.05, 0.95, 25_000).peakClosure).toBeNull();
  });
});

describe('PERCLOS is used only where blinks reach the PERCLOS level', () => {
  const H = 3_600_000;
  const START = Date.UTC(2026, 0, 5, 7);
  const cfg = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0, useChannels: { blink: false } };
  const base: TwinEvent[] = [{ t: START - H, type: 'sleep', wake: START, hours: 8 }];
  const cam = (peakClosure?: number): TwinEvent => ({ t: START + 4 * H, type: 'cam', perclos: 0.2, blinkRate: 15, meanBlinkMs: 200, coverage: 1, ...(peakClosure === undefined ? {} : { peakClosure }) });
  const offset = (ev: TwinEvent[]) => replay(ev, cfg, { until: START + 4 * H }).now.offset;

  it('ignores PERCLOS when the median blink peak is below the threshold', () => {
    expect(offset([...base, cam(0.6)])).toBe(offset(base));
  });

  it('uses PERCLOS as before when the field is absent or the peak is high enough', () => {
    const withoutField = offset([...base, cam()]);
    expect(withoutField).toBeGreaterThan(offset(base));
    expect(offset([...base, cam(0.95)])).toBe(withoutField);
    expect(offset([...base, cam(DEFAULT_CONFIG.perclosMinPeakClosure)])).toBe(withoutField);
  });

  it('exports the peak closure in the CSV', () => {
    const lines = toCsv([cam(0.62), cam()]).split('\n');
    const col = lines[0].split(',').indexOf('peakClosure');
    expect(col).toBeGreaterThan(0);
    expect(lines[1].split(',')[col]).toBe('0.62');
    expect(lines[2].split(',')[col]).toBe('');
  });
});

describe('alerts when the face is lost', () => {
  const frame = (t: number, face: boolean, closedMs: number, extra: Partial<{ lookingDown: boolean; closure: number }> = {}) => ({
    t,
    face,
    eyesClosedForMs: closedMs,
    headDroppedForMs: 0,
    closure: extra.closure ?? (closedMs > 0 ? 0.9 : 0),
    lookingDown: extra.lookingDown,
  });

  it('keeps the alarm on while the face is out of view, and clears only after the eyes are seen open', () => {
    const a = new AlertEngine();
    for (let t = 0; t <= 1500; t += 50) a.frame(frame(t, true, t));
    expect(a.current.level).toBe('alarm');
    for (let t = 1550; t <= 10_000; t += 50) a.frame(frame(t, false, 0));
    expect(a.current.level).toBe('alarm');
    expect(a.current.reason).toBe('Face lost while eyes were closed');
    for (let t = 10_050; t < 11_500; t += 50) a.frame(frame(t, true, 0));
    expect(a.current.level).toBe('alarm');
    a.frame(frame(11_600, true, 0));
    expect(a.current.level).toBe('ok');
  });

  it('raises the alarm if the face is lost after a closure of a second, but not after looking down or with open eyes', () => {
    const closed = new AlertEngine({ microsleepMs: 1000 });
    closed.frame(frame(0, true, 1000, { lookingDown: true })); // looking down: no alarm yet
    expect(closed.current.level).toBe('ok');
    closed.frame(frame(50, false, 0));
    expect(closed.current.level).toBe('ok');

    const a = new AlertEngine({ microsleepMs: 1200 });
    a.frame(frame(0, true, 1000));
    a.frame(frame(50, true, 1100));
    expect(a.current.level).toBe('ok');
    const b = new AlertEngine({ microsleepMs: 1000 });
    b.frame(frame(0, true, 900));
    b.frame(frame(50, true, 1000, { lookingDown: true }));
    b.frame(frame(100, false, 0));
    expect(b.current.level).toBe('ok');

    const open = new AlertEngine();
    open.frame(frame(0, true, 0));
    for (let t = 50; t < 3000; t += 50) open.frame(frame(t, false, 0));
    expect(open.current.level).toBe('ok');
  });
});

describe('looking down is judged from the frames before a closure', () => {
  it('a look-down score that rises only because the eyes close does not count', () => {
    const g = new LookDownGate();
    let closedSince: number | null = null;
    let last = false;
    for (let t = 0; t <= 3000; t += 40) {
      const closing = t >= 1000;
      if (closing) closedSince ??= t;
      const closedFor = closedSince === null ? 0 : t - closedSince;
      last = g.push(t, closing ? 0.8 : 0.1, closedFor);
    }
    expect(last).toBe(false);
  });

  it('a closure that starts while looking down counts as looking down', () => {
    const g = new LookDownGate();
    let closedSince: number | null = null;
    let last = false;
    for (let t = 0; t <= 3000; t += 40) {
      const closing = t >= 1000;
      if (closing) closedSince ??= t;
      last = g.push(t, t >= 400 ? 0.7 : 0.1, closedSince === null ? 0 : t - closedSince);
    }
    expect(last).toBe(true);
  });
});

describe('reaction tests shorter than the full 3 minutes', () => {
  const H = 3_600_000;
  const START = Date.UTC(2026, 0, 5, 7);
  const cfg = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
  const base: TwinEvent[] = [{ t: START - H, type: 'sleep', wake: START, hours: 8 }];
  const pvt = (durationS?: number): TwinEvent => ({ t: START + 4 * H, type: 'pvt', medianRt: 450, lapses: 8, n: 40, falseStarts: 0, ...(durationS === undefined ? {} : { durationS }) });
  const offset = (ev: TwinEvent[]) => replay(ev, cfg, { until: START + 4 * H }).now.offset;

  it('are not used by the twin', () => {
    expect(offset([...base, pvt(60)])).toBe(offset(base));
  });

  it('full tests are used, with or without the duration field', () => {
    expect(offset([...base, pvt()])).toBeGreaterThan(offset(base));
    expect(offset([...base, pvt(180)])).toBe(offset([...base, pvt()]));
  });
});

describe('NASA-TLX is stored only when every subscale was rated', () => {
  it('returns null for untouched or partly rated sliders', () => {
    expect(tlxFromItems([50, 50, 50, 50, 50, 50], [false, false, false, false, false, false])).toBeNull();
    expect(tlxFromItems([60, 50, 50, 50, 50, 50], [true, false, false, false, false, false])).toBeNull();
  });
  it('returns the raw TLX (mean) when all six were rated, defaults included', () => {
    expect(tlxFromItems([60, 50, 40, 30, 20, 10], [true, true, true, true, true, true])).toEqual({ value: 35, items: [60, 50, 40, 30, 20, 10] });
  });
});

describe('time on task', () => {
  const H = 3_600_000;
  const M = 60_000;
  const START = Date.UTC(2026, 0, 5, 7);
  const cfg = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
  const sleep: TwinEvent = { t: START - H, type: 'sleep', wake: START, hours: 8 };
  const ctx = (t: number, context: 'focus' | 'break'): TwinEvent => ({ t, type: 'context', context });
  const totAt = (ev: TwinEvent[], t: number) => replay(ev, cfg, { until: t }).now.tot / cfg.totPerHour;

  it('a short break pauses time on task instead of adding its minutes', () => {
    const ev = [sleep, ctx(START + H, 'focus'), ctx(START + H + 30 * M, 'break'), ctx(START + H + 35 * M, 'focus')];
    expect(totAt(ev, START + H + 45 * M) * 60).toBeCloseTo(40, 6);
  });

  it('a break of 10 minutes or more resets it, as before', () => {
    const ev = [sleep, ctx(START + H, 'focus'), ctx(START + H + 30 * M, 'break'), ctx(START + H + 40 * M, 'focus')];
    expect(totAt(ev, START + H + 50 * M) * 60).toBeCloseTo(10, 6);
  });
});

describe('forecast with a work rhythm', () => {
  const H = 3_600_000;
  const M = 60_000;
  const START = Date.UTC(2026, 0, 5, 7);
  const cfg = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0 };
  const ev: TwinEvent[] = [{ t: START - H, type: 'sleep', wake: START, hours: 8 }, { t: START + 2 * H, type: 'context', context: 'focus' }];
  const now = START + 2 * H + 30 * M;
  const r = replay(ev, cfg, { until: now });
  // hours on task in a forecast: its difference from a break-now forecast (time on task 0), daytime so unclipped
  const zero = forecast(r, cfg, { hours: 8, stepMinutes: 5, scenario: { breakNow: true } }).points;
  const tot = (pts: { t: number; kss: number }[], i: number) => (pts[i].kss - zero[i].kss) / cfg.totPerHour;

  it('without the rhythm, keeps the previous behaviour: continuous work for the whole horizon', () => {
    const f = forecast(r, cfg, { hours: 8, stepMinutes: 5 }).points;
    for (const i of [0, 12, 36, 60]) expect(tot(f, i)).toBeCloseTo(0.5 + i / 12, 6);
  });

  it('with 50-minute blocks and 10-minute breaks, time on task never exceeds 50 minutes and returns to zero', () => {
    const f = forecast(r, cfg, { hours: 8, stepMinutes: 5, scenario: { breaksEveryMinutes: 50, breakMinutes: 10 } }).points;
    const tots = f.map((_, i) => tot(f, i)); // every 5 minutes from now
    expect(Math.max(...tots)).toBeLessThanOrEqual(50 / 60 + 1e-9);
    expect(tots[0]).toBeCloseTo(0.5, 6);
    expect(tots[3]).toBeCloseTo(45 / 60, 6); // the current block ends 20 minutes from now
    expect(tots[5]).toBeCloseTo(50 / 60, 6); // 25 min: on the break, frozen
    expect(tots[7]).toBeCloseTo(5 / 60, 6); // 35 min: 5 minutes into the next block, after the reset
    expect(tots[17]).toBeCloseTo(50 / 60, 6); // 85 min: on the second break
    expect(tots[19]).toBeCloseTo(5 / 60, 6);
  });

  it('a break now, then the rhythm, starts from zero after the break', () => {
    const f = forecast(r, cfg, { hours: 8, stepMinutes: 5, scenario: { breaksEveryMinutes: 50, breakMinutes: 10, breakNow: true, breakNowMinutes: 15 } }).points;
    expect(tot(f, 0)).toBeCloseTo(0.5, 6); // frozen for the first 10 minutes of the break
    expect(tot(f, 2)).toBeCloseTo(0, 6); // reset after 10 minutes
    expect(tot(f, 5)).toBeCloseTo(10 / 60, 6); // back at work at 15 minutes
  });
});

describe('face-model delegate', () => {
  it('treats software WebGL renderers as having no usable graphics processor', async () => {
    const { softwareWebGl } = await import('../src/sensing/camera.ts');
    expect(softwareWebGl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(softwareWebGl('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(softwareWebGl('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe(false);
    expect(softwareWebGl('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(softwareWebGl(null)).toBe(false);
  });
});
