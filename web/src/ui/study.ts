// Study mode for the field phase of the validation study.
//
// During the field phase the participant's ratings are the outcome the model is scored against, so nothing the
// model computes may be shown to them: a visible estimate, forecast or "your reactions are slower than you
// feel" message would anchor the next rating and inflate the agreement being measured. In study mode the app
// still records every event, runs the camera and the reaction test, prompts check-ins at the protocol's fixed
// times and exports the log, but every model output is hidden behind a clear "Study mode" banner.
//
// The red long eye-closure and head-drop alerts stay on: they come from the camera, not from the model, and
// they are a safety feature. The amber warnings (minute-level eye measures and the model's KSS) are hidden,
// because they are feedback about sleepiness that would anchor the ratings.
//
// Turned on with ?study=1 and off with ?study=0; the choice is remembered in this browser.

export const STUDY_KEY = 'blinktwin.study';

/** Everything on the page that shows a model output or sleepiness feedback. */
export type StudyElement =
  | 'estimate' // the Now card's numbers, 90% range and defaults note
  | 'forecast'
  | 'objective-check'
  | 'why' // breakdown of the estimate
  | 'timeline' // sleepiness and workload charts, what-ifs
  | 'track-record'
  | 'personal-model'
  | 'suggestions' // model-driven check-in nudges
  | 'amber-warnings'
  | 'red-alerts' // camera alerts (safety)
  | 'camera-live' // live eye and head numbers
  | 'controls' // check-in, reaction test, context, sleep, data export
  | 'study-prompts'; // fixed-time check-in prompts of the protocol

const HIDDEN_IN_STUDY: ReadonlySet<StudyElement> = new Set<StudyElement>([
  'estimate',
  'forecast',
  'objective-check',
  'why',
  'timeline',
  'track-record',
  'personal-model',
  'suggestions',
  'amber-warnings',
]);

/** Whether an element is shown. Study prompts appear only in study mode; model outputs only outside it. */
export function isVisible(el: StudyElement, study: boolean): boolean {
  if (el === 'study-prompts') return study;
  return !(study && HIDDEN_IN_STUDY.has(el));
}

/**
 * Study mode from the URL (?study=1 or ?study=0) and the remembered choice. Returns the mode and the value to
 * remember ('1' or '0'), or null when the URL does not say.
 */
export function resolveStudyMode(search: string, stored: string | null): { study: boolean; remember: '1' | '0' | null } {
  const flag = new URLSearchParams(search).get('study');
  if (flag === '1' || flag === 'true') return { study: true, remember: '1' };
  if (flag === '0' || flag === 'false') return { study: false, remember: '0' };
  return { study: stored === '1', remember: null };
}

/** The protocol's prompted check-in times (local clock, hours). */
export const STUDY_CHECKIN_HOURS = [9.5, 12, 14.5, 17];
export const STUDY_PROMPT_WINDOW_MINUTES = 60;

/**
 * The prompted check-in due now, if any: the latest protocol time that has passed within the prompt window and
 * has no check-in since it. Returns the slot's local clock hour, or null.
 */
export function studyPromptDue(
  now: number,
  lastCheckInAt: number | null,
  tzOffsetMinutes: number = new Date(now).getTimezoneOffset(),
  hours: number[] = STUDY_CHECKIN_HOURS,
  windowMinutes: number = STUDY_PROMPT_WINDOW_MINUTES,
): number | null {
  const H = 3_600_000;
  const local = now - tzOffsetMinutes * 60_000;
  const midnight = local - (((local % (24 * H)) + 24 * H) % (24 * H)); // local midnight, in shifted ms
  for (const h of [...hours].sort((a, b) => b - a)) {
    const slot = midnight + h * H + tzOffsetMinutes * 60_000; // back to epoch ms
    if (now >= slot && now - slot <= windowMinutes * 60_000) return lastCheckInAt !== null && lastCheckInAt >= slot ? null : h;
  }
  return null;
}
