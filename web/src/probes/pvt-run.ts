// Timing logic of one reaction test (PVT-B), separate from the dialog so that it can be tested with a fake
// clock. Exactly one timer is pending at any time: the wait before the next stimulus, or the 600 ms during
// which the last reaction time is shown. A response with no stimulus on screen (including one during that
// feedback) is a false start; it cancels the pending timer and starts a new wait, so a double press can
// never leave two stimuli scheduled.

import { PVT_B } from './pvt-score.ts';

export interface PvtClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  random(): number;
}

export interface PvtView {
  stimulus(): void; // show the counter, counting from now
  feedback(rtMs: number): void; // show this reaction time
  clear(): void; // hide the counter
  finished(): void; // the test time is over
}

export const FEEDBACK_MS = 600;

export class PvtRun {
  readonly rts: number[] = [];
  premature = 0;
  stimulusAt: number | null = null;
  private timer: number | null = null;
  private startedAt: number | null = null;
  private done = false;
  private readonly durationMs: number;
  private readonly clock: PvtClock;
  private readonly view: PvtView;

  constructor(durationMs: number, clock: PvtClock, view: PvtView) {
    this.durationMs = durationMs;
    this.clock = clock;
    this.view = view;
  }

  get running(): boolean {
    return this.startedAt !== null && !this.done;
  }

  get stimulusCount(): number {
    return this.rts.length + (this.stimulusAt === null ? 0 : 1);
  }

  timeLeftMs(): number {
    return this.startedAt === null ? this.durationMs : Math.max(0, this.durationMs - (this.clock.now() - this.startedAt));
  }

  start() {
    if (this.startedAt !== null) return;
    this.startedAt = this.clock.now();
    this.schedule();
  }

  /** A key press, click or tap. `eventTime` is the input event's time stamp on the same clock, if trustworthy. */
  respond(eventTime?: number) {
    if (!this.running) return;
    if (this.stimulusAt === null) {
      this.premature++;
      this.view.clear();
      this.schedule();
      return;
    }
    const now = this.clock.now();
    const t = eventTime !== undefined && now - eventTime <= 50 ? eventTime : now;
    const rt = t - this.stimulusAt;
    this.rts.push(rt);
    this.stimulusAt = null;
    this.view.feedback(rt);
    this.setTimer(() => {
      this.view.clear();
      this.schedule();
    }, FEEDBACK_MS);
  }

  stop() {
    if (this.done) return;
    this.done = true;
    this.cancelTimer();
    this.stimulusAt = null;
  }

  private schedule() {
    if (this.timeLeftMs() <= 0) {
      this.stop();
      this.view.finished();
      return;
    }
    const isi = PVT_B.isiMinMs + this.clock.random() * (PVT_B.isiMaxMs - PVT_B.isiMinMs);
    this.setTimer(() => {
      this.stimulusAt = this.clock.now();
      this.view.stimulus();
    }, isi);
  }

  private setTimer(fn: () => void, ms: number) {
    this.cancelTimer();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (!this.done) fn();
    }, ms);
  }

  private cancelTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
