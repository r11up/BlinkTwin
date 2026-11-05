// A synthetic day for the demo mode: one virtual person, four check-ins with a reaction test before each,
// webcam windows during task blocks. Clearly labelled as demo data in the interface.

import { makePerson, mulberry32, simulate } from './sim/synth.ts';
import type { DemoState } from './store.ts';

export function demoDay(seed = 7): DemoState {
  const today = new Date();
  today.setHours(7, 0, 0, 0);
  const wake = today.getTime();
  const H = 3_600_000;
  const rng = mulberry32(seed);
  const person = makePerson(seed, rng);
  person.offset = 0.8;
  const { events } = simulate(
    person,
    {
      start: wake,
      sleepHours: 6.5,
      awakeHours: 13.5,
      blockMinutes: 50,
      breakMinutes: 10,
      checkIns: [9.5, 12.5, 15.5, 19].map((h) => wake + (h - 7) * H),
      pvtEveryHours: 0,
      pvtBeforeCheckIn: true,
      camera: true,
      tzOffsetMinutes: today.getTimezoneOffset(),
    },
    rng,
  );
  return { events, now: wake + 13.5 * H };
}
