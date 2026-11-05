// Sleep history: which recent nights are missing, what the twin assumes for them, and how much the recorded
// nights change today's estimate.
//
// The prior (Three-Process Model, src/twin/tpm.ts) carries sleep debt across days. How it fills gaps
// matters, and the person should know:
// - nights BEFORE the first recorded entry are assumed habitual (habitualSleepHours, same wake time);
// - a night missing AFTER an earlier entry (between two entries, or since the last one) is treated as a
//   night WITHOUT sleep, because sAtLastWake counts the whole time between two recorded wake times as awake;
//   with fillMissingNights (the app's setting) such a night is instead filled with a habitual one when the
//   gap between wake times exceeds 30 h, and an entry more than 30 h old gives way to today's default night
//   (status 'filled-habitual'); a real night without sleep is entered with 0 hours;
// - with no entry at all, the twin assumes waking at the default hour after the default sleep.
// This module reports which case applies to each of the last nights, so the UI can ask for the missing
// entries that change the estimate most.

import { alertness, type SleepEpisode } from '../twin/tpm.ts';
import { DEFAULT_CONFIG, replay, type TwinConfig, type TwinEvent } from '../twin/twin.ts';

export type NightStatus = 'recorded' | 'assumed-habitual' | 'assumed-no-sleep' | 'filled-habitual';

export interface Night {
  index: number; // 0 = the 24 h before now, 1 = the 24 h before that, ...
  from: number; // window of wake times (from, to]
  to: number;
  entry: SleepEpisode | null;
  status: NightStatus;
}

export interface SleepStatus {
  nights: Night[];
  missingNights: number[]; // indices without an entry
  usesDefaultSleep: boolean; // no sleep entry at all: the estimate uses the default night
  usesFilledNight: boolean; // with fillMissingNights: the last entry is too old, so today's night is assumed
  hoursSinceWake: number; // since the wake time the twin is using
  staleSleep: boolean; // the episode in use ended more than 24 h ago
  // Effect of the recorded sleep on the prior now, in KSS points (+ = sleepier), unclipped:
  // total = recorded history vs all nights habitual (same wake time); lastNight = last night's length vs
  // habitual; earlierNights = the nights before it vs habitual. null with no entry.
  debt: { total: number; lastNight: number; earlierNights: number } | null;
  message: string;
}

const H = 3_600_000;
const f1 = (x: number) => x.toFixed(1);

export function sleepStatus(events: TwinEvent[], now: number, cfg: TwinConfig = DEFAULT_CONFIG, opts: { nights?: number } = {}): SleepStatus {
  const nNights = opts.nights ?? 7;
  const r = replay(events, cfg, { until: now, stepMinutes: 24 * 60 });
  const recorded = r.sleeps.filter((s) => s.wake <= now);
  const usesDefaultSleep = recorded.length === 0;
  const oldestWake = recorded.length ? Math.min(...recorded.map((s) => s.wake)) : Infinity;

  const nights: Night[] = [];
  for (let k = 0; k < nNights; k++) {
    const to = now - k * 24 * H;
    const from = to - 24 * H;
    const inWindow = recorded.filter((s) => s.wake > from && s.wake <= to);
    const entry = inWindow.at(-1) ?? null;
    // an older entry exists if any recorded wake is earlier than this window
    let status: NightStatus = entry ? 'recorded' : oldestWake <= from ? 'assumed-no-sleep' : 'assumed-habitual';
    let used: SleepEpisode | null = entry;
    if (!entry && cfg.fillMissingNights && oldestWake <= from) {
      // with fillMissingNights the windows are not aligned to nights: look at the sleep the prior actually
      // uses here (an episode that wakes in the window, or whose sleep overlaps it)
      const H0 = (e: SleepEpisode) => e.wake - e.hours * H;
      const touching = r.priorHistory.filter((e) => e.hours > 0 && ((e.wake > from && e.wake <= to) || (H0(e) < to && e.wake > from)));
      const assumed = touching.find((e) => !recorded.includes(e));
      const real = touching.find((e) => recorded.includes(e));
      if (assumed) status = 'filled-habitual';
      else if (real) {
        status = 'recorded';
        used = real;
      }
    }
    nights.push({ index: k, from, to, entry: used, status });
  }
  const missingNights = nights.filter((n) => !n.entry).map((n) => n.index);
  const hoursSinceWake = (now - r.sleep.wake) / H;
  const staleSleep = !usesDefaultSleep && hoursSinceWake > 24;

  let debt: SleepStatus['debt'] = null;
  if (!usesDefaultSleep) {
    const tpm = cfg.tpm;
    const tz = cfg.tzOffsetMinutes;
    const habitual: SleepEpisode = { wake: r.sleep.wake, hours: tpm.habitualSleepHours };
    // alertness A; KSS = a - b A, so a change in A of dA changes KSS by -b dA (before clipping)
    const A = (sleep: SleepEpisode, history: SleepEpisode[]) => alertness(now, sleep, tpm, tz, history).A;
    const aRecorded = A(r.sleep, r.priorHistory);
    const aLastOnly = A(r.sleep, []); // last night as recorded, earlier nights habitual
    const aHabitual = A(habitual, []);
    const k = -tpm.kssSlope;
    debt = { total: k * (aRecorded - aHabitual), lastNight: k * (aLastOnly - aHabitual), earlierNights: k * (aRecorded - aLastOnly) };
  }

  const usesFilledNight = !usesDefaultSleep && r.sleepAssumption.usesDefault;
  return {
    nights,
    missingNights,
    usesDefaultSleep,
    usesFilledNight,
    hoursSinceWake,
    staleSleep,
    debt,
    message: message(nights, usesDefaultSleep, usesFilledNight, staleSleep, hoursSinceWake, debt, cfg),
  };
}

function message(nights: Night[], usesDefault: boolean, usesFilled: boolean, stale: boolean, sinceWake: number, debt: SleepStatus['debt'], cfg: TwinConfig): string {
  if (usesDefault) {
    return `No sleep entered: the estimate assumes you woke at ${String(cfg.defaultWakeHour).padStart(2, '0')}:00 after ${cfg.defaultSleepHours} h. Enter your sleep for a personal estimate.`;
  }
  const parts: string[] = [];
  if (usesFilled) {
    parts.push(`Your last sleep entry is more than 30 h old, so the estimate assumes you woke at ${String(cfg.defaultWakeHour).padStart(2, '0')}:00 today after ${cfg.defaultSleepHours} h. Enter last night, or mark it as a night without sleep.`);
  }
  const filledNights = nights.filter((n) => n.status === 'filled-habitual' && n.index > 0).length;
  if (filledNights > 0) {
    parts.push(`${filledNights} of the last ${nights.length} nights ${filledNights === 1 ? 'has' : 'have'} no entry; the twin assumes ${cfg.tpm.habitualSleepHours}-hour ${filledNights === 1 ? 'night' : 'nights'} there. Enter ${filledNights === 1 ? 'it' : 'them'} if different.`);
  }
  if (stale) {
    parts.push(`Your last sleep entry ended ${Math.round(sinceWake)} h ago. If you have slept since, enter it; otherwise the twin assumes you have been awake all that time.`);
  }
  const noSleep = nights.filter((n) => n.status === 'assumed-no-sleep' && n.index > 0).length;
  if (noSleep > 0) {
    parts.push(`${noSleep} of the last ${nights.length} nights ${noSleep === 1 ? 'has' : 'have'} no entry after an earlier one, and the twin treats ${noSleep === 1 ? 'it' : 'them'} as nights without sleep. Enter ${noSleep === 1 ? 'it' : 'them'} if you slept.`);
  }
  if (debt && Math.abs(debt.total) >= 0.3) {
    parts.push(
      debt.total > 0
        ? `Your recorded sleep adds about +${f1(debt.total)} KSS to today's estimate compared with ${cfg.tpm.habitualSleepHours}-hour nights${Math.abs(debt.earlierNights) >= 0.3 ? ` (+${f1(debt.earlierNights)} from earlier nights)` : ''}.`
        : `Your recorded sleep lowers today's estimate by about ${f1(-debt.total)} KSS compared with ${cfg.tpm.habitualSleepHours}-hour nights.`,
    );
  }
  return parts.length ? parts.join(' ') : 'Your recorded sleep is close to habitual and up to date.';
}
