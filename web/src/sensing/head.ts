// Head pose and gaze from MediaPipe Face Landmarker outputs, plus a head-nod detector.
// Angles are reported relative to the person's own resting pose (median of the last 20 s), so the
// sign convention of the camera does not matter for nod and head-drop detection.

import { percentile } from './blink.ts';

export interface Pose {
  pitch: number; // degrees, nodding
  yaw: number; // degrees, turning
  roll: number; // degrees, tilting
}

/** Euler angles (degrees) from MediaPipe's 4x4 facial transformation matrix (column-major `data`). */
export function poseFromMatrix(m: ArrayLike<number>): Pose {
  // R = [[m0 m4 m8], [m1 m5 m9], [m2 m6 m10]] for R = Rz(roll) Ry(yaw) Rx(pitch)
  const r20 = Math.max(-1, Math.min(1, m[2]));
  const deg = 180 / Math.PI;
  return {
    pitch: Math.atan2(m[6], m[10]) * deg,
    yaw: Math.asin(-r20) * deg,
    roll: Math.atan2(m[1], m[0]) * deg,
  };
}

/** Gaze direction from eyeLook* blendshapes: x > 0 towards the person's left, y > 0 upwards, range about [-1, 1]. */
export function gazeFromBlendshapes(score: (name: string) => number): { x: number; y: number } {
  const x = (score('eyeLookOutRight') + score('eyeLookInLeft') - score('eyeLookInRight') - score('eyeLookOutLeft')) / 2;
  const y = (score('eyeLookUpLeft') + score('eyeLookUpRight') - score('eyeLookDownLeft') - score('eyeLookDownRight')) / 2;
  return { x, y };
}

export interface Nod {
  start: number;
  peak: number; // degrees from resting pitch
  durationMs: number;
}

// Sign of a forward (downward) head movement in relative pitch. With MediaPipe's camera frame (y up, z towards
// the viewer) a rotation of +theta about x turns the face down. Check on a device with the live readout:
// nodding down should make pitch positive.
export const PITCH_DOWN_SIGN = 1;

export class HeadTracker {
  private samples: { t: number; p: Pose }[] = [];
  private nods: Nod[] = [];
  private nodStart: number | null = null;
  private dropStart: number | null = null;
  private nodPeak = 0;
  private readonly nodDeg: number;
  private readonly maxNodMs: number;

  constructor(nodDeg = 12, maxNodMs = 2500) {
    this.nodDeg = nodDeg;
    this.maxNodMs = maxNodMs;
  }

  /** Feed one frame; returns the pose relative to the resting pose. */
  push(t: number, p: Pose): Pose {
    this.samples.push({ t, p });
    while (this.samples.length && this.samples[0].t < t - 20_000) this.samples.shift();
    const rest = this.rest();
    const rel = { pitch: p.pitch - rest.pitch, yaw: p.yaw - rest.yaw, roll: p.roll - rest.roll };
    const dev = Math.abs(rel.pitch);
    const down = rel.pitch * PITCH_DOWN_SIGN;
    if (down >= this.nodDeg) this.dropStart ??= t;
    else if (down < this.nodDeg / 2) this.dropStart = null;
    if (this.nodStart === null && dev >= this.nodDeg) {
      this.nodStart = t;
      this.nodPeak = dev;
    } else if (this.nodStart !== null) {
      this.nodPeak = Math.max(this.nodPeak, dev);
      if (dev < this.nodDeg / 2) {
        const d = t - this.nodStart;
        if (d <= this.maxNodMs) this.nods.push({ start: this.nodStart, peak: this.nodPeak, durationMs: d });
        this.nodStart = null;
      }
    }
    while (this.nods.length && this.nods[0].start < t - 5 * 60_000) this.nods.shift();
    return rel;
  }

  /** How long the head has been pitched forward (down) from its resting pose by at least the nod threshold. */
  droppedFor(t: number): number {
    return this.dropStart === null ? 0 : t - this.dropStart;
  }

  nodsIn(tEnd: number, lengthMs = 60_000): number {
    return this.nods.filter((n) => n.start > tEnd - lengthMs && n.start <= tEnd).length;
  }

  /** Standard deviation of pitch and yaw over the window: how much the head is moving. */
  movement(tEnd: number, lengthMs = 10_000): number {
    const s = this.samples.filter((x) => x.t > tEnd - lengthMs);
    if (s.length < 2) return 0;
    const sd = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    };
    return Math.hypot(sd(s.map((x) => x.p.pitch)), sd(s.map((x) => x.p.yaw)));
  }

  private rest(): Pose {
    return {
      pitch: percentile(this.samples.map((x) => x.p.pitch), 0.5),
      yaw: percentile(this.samples.map((x) => x.p.yaw), 0.5),
      roll: percentile(this.samples.map((x) => x.p.roll), 0.5),
    };
  }
}

/**
 * Decides whether an eye closure happened while the person was looking down (at a keyboard or phone), which
 * lowers the upper lids without sleep. The eyeLookDown blendshapes can also rise when the eyes simply close,
 * so during a closure the decision is taken from the frames in the `windowMs` before the closure began
 * (looking down if most of them were), not from the frames of the closure itself.
 */
export class LookDownGate {
  private recent: { t: number; down: boolean }[] = [];
  private decision: boolean | null = null;
  private readonly threshold: number;
  private readonly windowMs: number;

  constructor(threshold = 0.45, windowMs = 500) {
    this.threshold = threshold;
    this.windowMs = windowMs;
  }

  /** `score`: mean eyeLookDown blendshape (null without a face); `closedForMs`: the blink meter's closure so far. */
  push(t: number, score: number | null, closedForMs: number): boolean {
    if (closedForMs > 0) {
      if (this.decision === null) {
        const onset = t - closedForMs;
        const before = this.recent.filter((r) => r.t >= onset - this.windowMs && r.t < onset);
        this.decision = before.length > 0 && before.filter((r) => r.down).length * 2 > before.length;
      }
      return this.decision;
    }
    this.decision = null;
    if (score !== null) this.recent.push({ t, down: score > this.threshold });
    while (this.recent.length && this.recent[0].t < t - 2000) this.recent.shift();
    return score !== null && score > this.threshold;
  }
}
