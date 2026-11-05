import { describe, expect, it } from 'vitest';
import { isVisible, resolveStudyMode, STUDY_CHECKIN_HOURS, studyPromptDue, type StudyElement } from '../src/ui/study.ts';

const H = 3_600_000;
const M = 60_000;
const DAY = Date.UTC(2026, 0, 5); // midnight UTC; tz offset 0 below

describe('study mode', () => {
  it('hides every model output but keeps safety alerts, controls and the camera', () => {
    const hidden: StudyElement[] = ['estimate', 'forecast', 'objective-check', 'why', 'timeline', 'track-record', 'personal-model', 'suggestions', 'amber-warnings'];
    for (const el of hidden) {
      expect(isVisible(el, true)).toBe(false);
      expect(isVisible(el, false)).toBe(true);
    }
    for (const el of ['red-alerts', 'camera-live', 'controls'] as StudyElement[]) {
      expect(isVisible(el, true)).toBe(true);
      expect(isVisible(el, false)).toBe(true);
    }
    expect(isVisible('study-prompts', true)).toBe(true);
    expect(isVisible('study-prompts', false)).toBe(false);
  });

  it('is turned on and off by the URL and remembered otherwise', () => {
    expect(resolveStudyMode('?study=1', null)).toEqual({ study: true, remember: '1' });
    expect(resolveStudyMode('?study=0', '1')).toEqual({ study: false, remember: '0' });
    expect(resolveStudyMode('', '1')).toEqual({ study: true, remember: null });
    expect(resolveStudyMode('?demo=1', null)).toEqual({ study: false, remember: null });
  });

  it('prompts the protocol check-ins at their times, once, within the window', () => {
    const at = (h: number) => DAY + h * H;
    expect(STUDY_CHECKIN_HOURS).toEqual([9.5, 12, 14.5, 17]);
    expect(studyPromptDue(at(9.5) - M, null, 0)).toBeNull(); // not yet
    expect(studyPromptDue(at(9.5), null, 0)).toBe(9.5);
    expect(studyPromptDue(at(10), at(8), 0)).toBe(9.5); // a check-in before the slot does not count
    expect(studyPromptDue(at(10), at(9.6), 0)).toBeNull(); // answered
    expect(studyPromptDue(at(10.6), null, 0)).toBeNull(); // window of an hour passed
    expect(studyPromptDue(at(12.2), at(9.6), 0)).toBe(12);
    expect(studyPromptDue(at(17.5), null, 0)).toBe(17);
  });

  it('uses local clock time', () => {
    // UTC+10 (offset -600 min): 09:30 local is 23:30 UTC the day before
    const nowUtc = Date.UTC(2026, 0, 4, 23, 40);
    expect(studyPromptDue(nowUtc, null, -600)).toBe(9.5);
  });
});
