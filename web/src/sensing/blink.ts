// Turns a per-frame eye-closure score (MediaPipe's eyeBlink blendshapes, 0 = open, 1 = closed) into
// blink events and windowed fatigue features. Pure and frame-rate independent enough to unit-test.
//
// The raw score's open-eye level differs between people, cameras and lighting, so it is normalised
// against a rolling low percentile (the person's own open-eye level) before thresholds are applied.
//
// Long closures: the rolling percentile would climb to the closed level once the eyes have been shut for
// most of its window (about 24 s with the defaults), which would end the closure and clear the alarm while
// the person may be asleep. So once a closure has lasted freezeAfterMs, the baseline is frozen at its value
// when the closure began, until the eyes reopen. After releaseAfterMs the freeze is released, so that a
// sustained change in posture or lighting (for example looking down) can still be adapted to. Closures
// shorter than freezeAfterMs are processed exactly as before.

export interface Blink {
  start: number;
  end: number;
  durationMs: number;
  peak: number; // highest normalised closure reached during the closure
}

export interface CamWindow {
  t: number; // end of window
  perclos: number; // fraction of face-present frames with eyes >= 80% closed (normalised)
  blinkRate: number; // blinks per minute
  blinks: number; // ordinary blinks in the window
  meanBlinkMs: number; // mean duration of ordinary blinks
  longClosures: number; // closures longer than maxBlinkMs
  coverage: number; // fraction of frames with a face
  // Median peak normalised closure of the window's ordinary blinks (null with fewer than 3 blinks). If
  // ordinary blinks do not reach the PERCLOS level, PERCLOS cannot register eye closure on this camera.
  peakClosure: number | null;
}

export interface BlinkMeterOptions {
  baselineWindowMs: number;
  baselinePercentile: number;
  closeThreshold: number; // normalised closure that starts a blink
  openThreshold: number; // normalised closure that ends it (hysteresis)
  perclosThreshold: number;
  minBlinkMs: number;
  maxBlinkMs: number;
  freezeAfterMs: number; // a closure this long freezes the open-eye baseline
  releaseAfterMs: number; // ... until the eyes reopen or the closure has lasted this long
}

export const BLINK_DEFAULTS: BlinkMeterOptions = {
  baselineWindowMs: 30_000,
  baselinePercentile: 0.2,
  closeThreshold: 0.5,
  openThreshold: 0.3,
  perclosThreshold: 0.8,
  minBlinkMs: 50,
  maxBlinkMs: 1000,
  freezeAfterMs: 2000,
  releaseAfterMs: 60_000,
};

interface Frame {
  t: number;
  closure: number | null; // normalised closure, null when no face
}

export class BlinkMeter {
  private raw: { t: number; v: number }[] = [];
  private frames: Frame[] = [];
  private blinks: Blink[] = [];
  private longClosures: Blink[] = [];
  private closingSince: number | null = null;
  private closingPeak = 0;
  private baseAtClosureStart = 0;
  private lastBase = 0;
  private readonly opt: BlinkMeterOptions;

  constructor(opt: Partial<BlinkMeterOptions> = {}) {
    this.opt = { ...BLINK_DEFAULTS, ...opt };
  }

  /** Feed one frame. `score` is the mean of the left and right eyeBlink blendshapes, or null if no face. */
  push(t: number, score: number | null): number | null {
    if (score === null) {
      this.frames.push({ t, closure: null });
      if (this.closingSince !== null && this.frozen(t)) this.dropClosureSamples();
      this.closingSince = null;
      this.trim(t);
      return null;
    }
    this.raw.push({ t, v: score });
    while (this.raw.length && this.raw[0].t < t - this.opt.baselineWindowMs) this.raw.shift();
    const live = percentile(this.raw.map((r) => r.v), this.opt.baselinePercentile);
    const frozen = this.closingSince !== null && this.frozen(t);
    const base = frozen ? this.baseAtClosureStart : live;
    const closure = Math.min(1, Math.max(0, (score - base) / Math.max(1e-6, 1 - base)));
    this.frames.push({ t, closure });

    if (this.closingSince === null && closure >= this.opt.closeThreshold) {
      this.closingSince = t;
      this.closingPeak = closure;
      // the baseline just before this closure started: the open-eye level to hold if it lasts
      this.baseAtClosureStart = this.lastBase;
    } else if (this.closingSince !== null && closure <= this.opt.openThreshold) {
      const b = { start: this.closingSince, end: t, durationMs: t - this.closingSince, peak: this.closingPeak };
      if (b.durationMs >= this.opt.minBlinkMs && b.durationMs <= this.opt.maxBlinkMs) this.blinks.push(b);
      else if (b.durationMs > this.opt.maxBlinkMs) this.longClosures.push(b);
      // a closure that froze the baseline must not leave its closed-eye samples in the open-eye baseline
      if (frozen) this.dropClosureSamples();
      this.closingSince = null;
    } else if (this.closingSince !== null) {
      this.closingPeak = Math.max(this.closingPeak, closure);
    }
    this.lastBase = this.closingSince === null || !frozen ? live : this.lastBase;
    this.trim(t);
    return closure;
  }

  /** Whether the baseline is frozen at time t for the closure in progress. */
  private frozen(t: number): boolean {
    if (this.closingSince === null) return false;
    const d = t - this.closingSince;
    return d >= this.opt.freezeAfterMs && d < this.opt.releaseAfterMs;
  }

  private dropClosureSamples() {
    const from = this.closingSince as number;
    this.raw = this.raw.filter((r) => r.t < from);
  }

  /** How long the eyes have been continuously closed at time t (0 if open). */
  closedFor(t: number): number {
    return this.closingSince === null ? 0 : t - this.closingSince;
  }

  window(tEnd: number, lengthMs = 60_000): CamWindow {
    const from = tEnd - lengthMs;
    const frames = this.frames.filter((f) => f.t > from && f.t <= tEnd);
    const face = frames.filter((f) => f.closure !== null);
    const closed = face.filter((f) => (f.closure as number) >= this.opt.perclosThreshold).length;
    const blinks = this.blinks.filter((b) => b.end > from && b.end <= tEnd);
    const minutes = lengthMs / 60_000;
    return {
      t: tEnd,
      perclos: face.length ? closed / face.length : 0,
      blinkRate: blinks.length / minutes,
      blinks: blinks.length,
      meanBlinkMs: blinks.length ? blinks.reduce((s, b) => s + b.durationMs, 0) / blinks.length : 0,
      longClosures: this.longClosures.filter((b) => b.end > from && b.end <= tEnd).length,
      coverage: frames.length ? face.length / frames.length : 0,
      peakClosure: blinks.length >= 3 ? median(blinks.map((b) => b.peak)) : null,
    };
  }

  private trim(t: number) {
    const keep = t - 5 * 60_000;
    while (this.frames.length && this.frames[0].t < keep) this.frames.shift();
    while (this.blinks.length && this.blinks[0].end < keep) this.blinks.shift();
    while (this.longClosures.length && this.longClosures[0].end < keep) this.longClosures.shift();
  }
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
