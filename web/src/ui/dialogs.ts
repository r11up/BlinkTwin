// Check-in (KSS + NASA-TLX) and the reaction-time test, each in a modal <dialog>.

import { PVT_B, scorePvt, type PvtSummary } from '../probes/pvt-score.ts';

// Karolinska Sleepiness Scale wording (Akerstedt & Gillberg, 1990)
export const KSS_LABELS = [
  'Extremely alert',
  'Very alert',
  'Alert',
  'Rather alert',
  'Neither alert nor sleepy',
  'Some signs of sleepiness',
  'Sleepy, but no effort to keep awake',
  'Sleepy, some effort to keep awake',
  'Very sleepy, great effort to keep awake, fighting sleep',
];

// NASA Task Load Index subscales (Hart & Staveland, 1988); raw TLX = mean of the six
const TLX_ITEMS: [string, string, string, string][] = [
  ['mental', 'Mental demand', 'How mentally demanding was the task?', 'Very low|Very high'],
  ['physical', 'Physical demand', 'How physically demanding was the task?', 'Very low|Very high'],
  ['temporal', 'Temporal demand', 'How hurried or rushed was the pace of the task?', 'Very low|Very high'],
  ['performance', 'Performance', 'How successful were you in accomplishing what you were asked to do?', 'Perfect|Failure'],
  ['effort', 'Effort', 'How hard did you have to work to accomplish your level of performance?', 'Very low|Very high'],
  ['frustration', 'Frustration', 'How insecure, discouraged, irritated, stressed and annoyed were you?', 'Very low|Very high'],
];

export interface CheckIn {
  kss: number;
  tlx: { value: number; items: number[] } | null;
}

let dialogCount = 0;

/** Opens a modal dialog; `%TITLE_ID%` in the html marks the element that names it. */
function dialog(html: string): HTMLDialogElement {
  const d = document.createElement('dialog');
  const id = `dlg-title-${++dialogCount}`;
  d.setAttribute('aria-labelledby', id);
  d.innerHTML = html.replace('%TITLE_ID%', id);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

/** Raw TLX from the six subscales, or null unless the person rated every one (never store untouched defaults). */
export function tlxFromItems(values: number[], touched: boolean[]): { value: number; items: number[] } | null {
  if (values.length !== TLX_ITEMS.length || touched.some((t) => !t)) return null;
  return { value: values.reduce((s, v) => s + v, 0) / values.length, items: values };
}

export function openCheckIn(opts: { askTlx: boolean }): Promise<CheckIn | null> {
  return new Promise((resolve) => {
    const kss = KSS_LABELS.map(
      (l, i) => `<label class="kss-option"><input type="radio" name="kss" value="${i + 1}" required><span class="kss-n">${i + 1}</span><span>${l}</span></label>`,
    ).join('');
    const tlx = TLX_ITEMS.map(
      ([id, name, q, anchors]) => `<div class="tlx-item untouched"><div class="tlx-q"><label for="tlx-${id}"><b>${name}</b> ${q}</label> <output for="tlx-${id}">not rated</output></div>
        <input type="range" id="tlx-${id}" name="${id}" min="0" max="100" step="5" value="50" aria-valuetext="not rated">
        <div class="tlx-anchors" aria-hidden="true"><span>${anchors.split('|')[0]}</span><span>${anchors.split('|')[1]}</span></div></div>`,
    ).join('');
    // the backdrop hides the twin's own estimate so it cannot steer the rating
    const d = dialog(
      `<form method="dialog" class="checkin-form">
      <h2 id="%TITLE_ID%">Check in</h2>
      <fieldset class="kss-list"><legend class="muted">How sleepy have you felt in the last 5 minutes? (Karolinska Sleepiness Scale)</legend>${kss}</fieldset>
      ${
        opts.askTlx
          ? `<details class="tlx-block"><summary>Also rate the workload of what you were just doing (NASA-TLX, optional)</summary>
        <p class="small muted">Move every slider, including any you would leave in the middle. Workload is saved only when all six are rated.</p>${tlx}
        <p class="small tlx-status" aria-live="polite"></p></details>`
          : ''
      }
      <div class="actions"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="ok" class="primary">Save check-in</button></div>
    </form>`,
    );
    d.classList.add('checkin-dialog');
    const ranges = [...d.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    const touched = ranges.map(() => false);
    const status = d.querySelector('.tlx-status') as HTMLElement | null;
    const showStatus = () => {
      const n = touched.filter(Boolean).length;
      if (status) status.textContent = n === 0 ? '' : n < ranges.length ? `${n} of ${ranges.length} rated.` : 'All six rated. Raw TLX will be saved.';
    };
    ranges.forEach((r, i) => {
      const out = r.parentElement?.querySelector('output') as HTMLOutputElement;
      const mark = () => {
        touched[i] = true;
        r.closest('.tlx-item')?.classList.remove('untouched');
        out.textContent = r.value;
        r.setAttribute('aria-valuetext', r.value);
        showStatus();
      };
      r.addEventListener('input', mark);
      r.addEventListener('change', mark);
      r.addEventListener('pointerdown', mark);
      r.addEventListener('keydown', (e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) mark();
      });
    });
    const form = d.querySelector('form') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      const n = touched.filter(Boolean).length;
      if ((e.submitter as HTMLButtonElement | null)?.value === 'ok' && n > 0 && n < ranges.length) {
        e.preventDefault();
        if (status) status.textContent = `${n} of ${ranges.length} rated. Rate all six, or close the workload section to skip it.`;
        (d.querySelector('.tlx-block') as HTMLDetailsElement).open = true;
        ranges[touched.indexOf(false)].focus();
      }
    });
    d.querySelector('.tlx-block')?.addEventListener('toggle', (e) => {
      // closing the section means skipping workload this time
      if ((e.target as HTMLDetailsElement).open) return;
      touched.fill(false);
      ranges.forEach((r) => {
        r.closest('.tlx-item')?.classList.add('untouched');
        (r.parentElement?.querySelector('output') as HTMLOutputElement).textContent = 'not rated';
        r.setAttribute('aria-valuetext', 'not rated');
      });
      showStatus();
    });
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return resolve(null);
      const fd = new FormData(form);
      const items = TLX_ITEMS.map(([id]) => Number(fd.get(id)));
      resolve({ kss: Number(fd.get('kss')), tlx: tlxFromItems(items, touched) });
    });
  });
}

/** Runs the PVT-B. Respond with Space, a click or a tap whenever the counter appears. */
export function runPvt(durationMs = PVT_B.durationMs): Promise<PvtSummary | null> {
  return new Promise((resolve) => {
    const short = durationMs < PVT_B.durationMs;
    const d = dialog(
      `<div class="pvt">
      <div class="pvt-head"><span id="%TITLE_ID%">Reaction test</span><span class="pvt-time" aria-hidden="true"></span><button class="ghost pvt-cancel">Stop</button></div>
      <div class="pvt-stage" tabindex="0" aria-label="Response area"><div class="pvt-intro">Look at this box. When a red counter appears, press <kbd>Space</kbd>, click or tap as fast as you can. Do not respond before it appears.<br><br><button class="primary pvt-go">Start (${Math.round(durationMs / 60000)} min)</button></div><div class="pvt-counter" hidden></div><div class="pvt-result" hidden role="status"></div></div>
      <p class="muted small">Brief PVT (PVT-B). ${
        short ? 'The 1-minute version is shown to you but not used by the twin, which needs the full 3 minutes. ' : ''
      }Browser, screen and keyboard add a delay that differs between devices (often tens of milliseconds), so compare results taken on the same device.</p>
    </div>`,
    );
    d.classList.add('pvt-dialog');
    const stage = d.querySelector('.pvt-stage') as HTMLElement;
    const counter = d.querySelector('.pvt-counter') as HTMLElement;
    const intro = d.querySelector('.pvt-intro') as HTMLElement;
    const timeEl = d.querySelector('.pvt-time') as HTMLElement;
    const rts: number[] = [];
    let premature = 0;
    let stimulusAt: number | null = null;
    let raf = 0;
    let timer = 0;
    let start = 0;
    let done = false;

    let result: PvtSummary | null = null;
    const close = () => {
      if (d.open) d.close();
      resolve(result);
    };
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      if (!ok) return close();
      // show the result before closing, so the person sees the test has ended and what it found
      result = scorePvt(rts, premature);
      counter.hidden = true;
      timeEl.textContent = '';
      const panel = d.querySelector('.pvt-result') as HTMLElement;
      panel.hidden = false;
      panel.innerHTML = result.n
        ? `<b>Done.</b><div class="pvt-stats"><span><b>${Math.round(result.medianRt)}</b> ms median</span><span><b>${result.lapses}</b> lapses</span><span><b>${result.falseStarts}</b> false starts</span></div><button class="primary pvt-done">Save and close</button>`
        : `<b>No valid responses.</b><button class="primary pvt-done">Close</button>`;
      const doneBtn = panel.querySelector('.pvt-done') as HTMLButtonElement;
      doneBtn.addEventListener('click', close);
      doneBtn.focus();
      (d.querySelector('.pvt-cancel') as HTMLButtonElement).hidden = true;
    };
    const schedule = () => {
      if (performance.now() - start >= durationMs) return finish(true);
      const isi = PVT_B.isiMinMs + Math.random() * (PVT_B.isiMaxMs - PVT_B.isiMinMs);
      timer = window.setTimeout(() => {
        stimulusAt = performance.now();
        counter.hidden = false;
        const tick = () => {
          if (stimulusAt === null) return;
          counter.textContent = String(Math.round(performance.now() - stimulusAt));
          raf = requestAnimationFrame(tick);
        };
        tick();
      }, isi);
    };
    const respond = (ev: Event) => {
      if (!start || done) return;
      ev.preventDefault();
      if (stimulusAt === null) {
        premature++;
        clearTimeout(timer);
        schedule();
        return;
      }
      const rt = performance.now() - ev.timeStamp > 50 ? performance.now() - stimulusAt : ev.timeStamp - stimulusAt;
      rts.push(rt);
      stimulusAt = null;
      cancelAnimationFrame(raf);
      counter.textContent = String(Math.round(rt));
      window.setTimeout(() => {
        counter.hidden = true;
        schedule();
      }, 600);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') respond(ev);
      if (ev.code === 'Escape') finish(false);
    };
    const clock = () => {
      if (done || !start) return;
      const left = Math.max(0, durationMs - (performance.now() - start));
      timeEl.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
      window.setTimeout(clock, 250);
    };
    (d.querySelector('.pvt-go') as HTMLButtonElement).addEventListener('click', (ev) => {
      ev.stopPropagation();
      intro.hidden = true;
      start = performance.now();
      stage.focus();
      clock();
      schedule();
    });
    stage.addEventListener('pointerdown', respond);
    window.addEventListener('keydown', onKey, true);
    (d.querySelector('.pvt-cancel') as HTMLButtonElement).addEventListener('click', () => finish(false));
    d.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      if (done) close();
      else finish(false);
    });
  });
}
