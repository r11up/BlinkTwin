import { describe, expect, it } from 'vitest';
import { FEEDBACK_MS, PvtRun, type PvtClock, type PvtView } from '../src/probes/pvt-run.ts';

/** A manual clock: timers fire only when time is advanced. */
function fakeClock(randoms: number[] = [0.5]) {
  let now = 0;
  let next = 1;
  let r = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: PvtClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id),
    random: () => randoms[r++ % randoms.length],
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { clock, advance, pending: () => timers.size, now: () => now };
}

function recorder() {
  const log: string[] = [];
  const view: PvtView = {
    stimulus: () => log.push('stimulus'),
    feedback: (rt) => log.push(`feedback ${Math.round(rt)}`),
    clear: () => log.push('clear'),
    finished: () => log.push('finished'),
  };
  return { view, log };
}

describe('reaction test timing (PvtRun)', () => {
  it('shows a stimulus after the inter-stimulus interval and records the reaction time', () => {
    const c = fakeClock([0.5]); // interval 2.5 s
    const v = recorder();
    const run = new PvtRun(60_000, c.clock, v.view);
    run.start();
    c.advance(2499);
    expect(v.log).toEqual([]);
    c.advance(1);
    expect(v.log).toEqual(['stimulus']);
    c.advance(300);
    run.respond();
    expect(run.rts).toEqual([300]);
    expect(v.log.at(-1)).toBe('feedback 300');
    c.advance(FEEDBACK_MS);
    expect(v.log.at(-1)).toBe('clear');
    expect(c.pending()).toBe(1);
  });

  it('a press during the feedback is a false start and never leaves two stimuli scheduled', () => {
    const c = fakeClock([0.5]);
    const v = recorder();
    const run = new PvtRun(60_000, c.clock, v.view);
    run.start();
    c.advance(2500 + 280);
    run.respond(); // a reaction
    c.advance(100);
    run.respond(); // double press while the reaction time is still shown
    expect(run.premature).toBe(1);
    expect(c.pending()).toBe(1); // only the new wait, not the old feedback timer as well
    c.advance(FEEDBACK_MS); // the cancelled feedback timer must not schedule a second wait
    expect(c.pending()).toBe(1);
    c.advance(5000);
    expect(v.log.filter((e) => e === 'stimulus')).toHaveLength(2);
    expect(c.pending()).toBe(0); // waiting for the response to the second stimulus
  });

  it('a false start before the stimulus restarts the wait', () => {
    const c = fakeClock([0.5]);
    const v = recorder();
    const run = new PvtRun(60_000, c.clock, v.view);
    run.start();
    c.advance(1000);
    run.respond();
    expect(run.premature).toBe(1);
    c.advance(2000); // 3 s after start: the original stimulus time has passed, but the wait restarted
    expect(v.log.includes('stimulus')).toBe(false);
    c.advance(500);
    expect(v.log.includes('stimulus')).toBe(true);
  });

  it('uses the input time stamp when it is recent, and the clock otherwise', () => {
    const c = fakeClock([0]);
    const run = new PvtRun(60_000, c.clock, recorder().view);
    run.start();
    c.advance(1000);
    c.advance(320);
    run.respond(c.now() - 20); // event stamped 20 ms ago
    expect(run.rts[0]).toBe(300);
    c.advance(FEEDBACK_MS + 1000);
    c.advance(250);
    run.respond(c.now() - 500); // implausibly old time stamp: use the clock
    expect(run.rts[1]).toBe(250);
  });

  it('finishes when the time is up and then ignores input and timers', () => {
    const c = fakeClock([0]);
    const v = recorder();
    const run = new PvtRun(10_000, c.clock, v.view);
    run.start();
    for (let i = 0; i < 20; i++) {
      c.advance(1000);
      c.advance(300);
      run.respond();
      c.advance(FEEDBACK_MS);
    }
    expect(v.log.at(-1)).toBe('finished');
    expect(run.running).toBe(false);
    const n = run.rts.length;
    run.respond();
    c.advance(10_000);
    expect(run.rts.length).toBe(n);
    expect(c.pending()).toBe(0);
  });

  it('stopping cancels the pending stimulus', () => {
    const c = fakeClock([0.5]);
    const v = recorder();
    const run = new PvtRun(60_000, c.clock, v.view);
    run.start();
    run.stop();
    c.advance(10_000);
    expect(v.log).toEqual([]);
    expect(c.pending()).toBe(0);
  });
});
