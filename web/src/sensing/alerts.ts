// Real-time drowsiness alerts. Pure state machine so the rules can be tested and reported exactly.
//
// Alarm (red, sound): eyes closed for >= microsleepMs, or head dropped from its resting pitch for
//   >= headDropMs while the eyes are at least half closed. These are signs of a microsleep.
// Warning (amber): over the last minute PERCLOS >= perclosWarn, or >= longClosuresWarn closures longer
//   than 1 s, or a mean blink duration >= blinkMsWarn (with at least 5 blinks), or the twin's KSS >= 7.
// Notice: face not seen for faceLostMs.

export type AlertLevel = 'ok' | 'notice' | 'warning' | 'alarm';

export interface AlertRules {
  microsleepMs: number;
  headDropMs: number;
  recoverMs: number; // eyes open this long before an alarm clears
  perclosWarn: number;
  longClosuresWarn: number;
  blinkMsWarn: number;
  kssWarn: number;
  warnCooldownMs: number;
  faceLostMs: number;
}

export const ALERT_RULES: AlertRules = {
  microsleepMs: 1000,
  headDropMs: 1000,
  recoverMs: 1500,
  perclosWarn: 0.15,
  longClosuresWarn: 2,
  blinkMsWarn: 300,
  kssWarn: 7,
  warnCooldownMs: 5 * 60_000,
  faceLostMs: 5000,
};

export interface FrameInput {
  t: number;
  face: boolean;
  eyesClosedForMs: number; // continuous closure so far (0 if open)
  headDroppedForMs: number;
  closure: number; // normalised 0-1
}

export interface MinuteInput {
  perclos: number;
  longClosures: number;
  meanBlinkMs: number;
  blinks: number;
  twinKss: number | null;
}

export interface AlertState {
  level: AlertLevel;
  reason: string;
  since: number;
}

export class AlertEngine {
  private state: AlertState = { level: 'ok', reason: '', since: 0 };
  private lastWarn = -Infinity;
  private lastFace: number | null = null;
  private openSince: number | null = null;
  private minute: MinuteInput | null = null;
  private readonly rules: AlertRules;

  constructor(rules: Partial<AlertRules> = {}) {
    this.rules = { ...ALERT_RULES, ...rules };
  }

  get current(): AlertState {
    return this.state;
  }

  updateMinute(m: MinuteInput) {
    this.minute = m;
  }

  /** Feed one frame. Returns the new state and whether it just escalated (to trigger sound). */
  frame(f: FrameInput): { state: AlertState; escalated: boolean } {
    const r = this.rules;
    const prev = this.state.level;
    if (f.face) this.lastFace = f.t;
    const microsleep = f.face && f.eyesClosedForMs >= r.microsleepMs;
    const headDrop = f.face && f.headDroppedForMs >= r.headDropMs && f.closure >= 0.5;
    if (microsleep || headDrop) {
      this.openSince = null;
      if (prev !== 'alarm') this.set('alarm', microsleep ? 'Eyes closed for more than a second' : 'Head dropping with eyes closing', f.t);
    } else if (prev === 'alarm') {
      if (this.openSince === null) this.openSince = f.t;
      if (f.t - this.openSince >= r.recoverMs) this.set('ok', '', f.t);
    }
    if (this.state.level !== 'alarm') {
      const why = this.warningReason();
      if (why && f.t - this.lastWarn >= r.warnCooldownMs) {
        this.lastWarn = f.t;
        this.set('warning', why, f.t);
      } else if (!why && this.state.level === 'warning') {
        this.set('ok', '', f.t);
      } else if (this.state.level !== 'warning') {
        const lost = this.lastFace !== null && f.t - this.lastFace >= r.faceLostMs;
        if (lost && this.state.level !== 'notice') this.set('notice', 'Face not visible', f.t);
        if (!lost && this.state.level === 'notice') this.set('ok', '', f.t);
      }
    }
    const rank = { ok: 0, notice: 1, warning: 2, alarm: 3 } as const;
    return { state: this.state, escalated: rank[this.state.level] > rank[prev] && this.state.level !== 'notice' };
  }

  acknowledge(t: number) {
    if (this.state.level === 'warning') this.set('ok', '', t);
  }

  private warningReason(): string | null {
    const m = this.minute;
    const r = this.rules;
    if (!m) return null;
    if (m.perclos >= r.perclosWarn) return `Eyes closed ${(m.perclos * 100).toFixed(0)}% of the last minute`;
    if (m.longClosures >= r.longClosuresWarn) return `${m.longClosures} long eye closures in the last minute`;
    if (m.blinks >= 5 && m.meanBlinkMs >= r.blinkMsWarn) return `Slow blinks (${Math.round(m.meanBlinkMs)} ms on average)`;
    if (m.twinKss !== null && m.twinKss >= r.kssWarn) return `Your twin estimates KSS ${m.twinKss.toFixed(1)}`;
    return null;
  }

  private set(level: AlertLevel, reason: string, t: number) {
    this.state = { level, reason, since: t };
  }
}
