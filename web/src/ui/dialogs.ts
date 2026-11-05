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

function dialog(html: string): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

export function openCheckIn(opts: { askTlx: boolean }): Promise<CheckIn | null> {
  return new Promise((resolve) => {
    const kss = KSS_LABELS.map(
      (l, i) => `<label class="kss-option"><input type="radio" name="kss" value="${i + 1}" required><span class="kss-n">${i + 1}</span><span>${l}</span></label>`,
    ).join('');
    const tlx = TLX_ITEMS.map(
      ([id, name, q, anchors]) => `<div class="tlx-item"><div class="tlx-q"><b>${name}</b> ${q}</div>
        <input type="range" name="${id}" min="0" max="100" step="5" value="50" aria-label="${name}">
        <div class="tlx-anchors"><span>${anchors.split('|')[0]}</span><span>${anchors.split('|')[1]}</span></div></div>`,
    ).join('');
    // the backdrop hides the twin's own estimate so it cannot steer the rating
    const d = dialog(`<form method="dialog" class="checkin-form">
      <h2>Check in</h2>
      <p class="muted">How sleepy have you felt in the last 5 minutes? (Karolinska Sleepiness Scale)</p>
      <div class="kss-list">${kss}</div>
      <details ${opts.askTlx ? 'open' : ''} class="tlx-block"><summary>Workload of what you were just doing (NASA-TLX, optional)</summary>${tlx}
        <label class="skip"><input type="checkbox" name="skipTlx" ${opts.askTlx ? '' : 'checked'}> Skip workload this time</label></details>
      <div class="actions"><button value="cancel" formnovalidate class="ghost">Cancel</button><button value="ok" class="primary">Save check-in</button></div>
    </form>`);
    d.classList.add('checkin-dialog');
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return resolve(null);
      const fd = new FormData(d.querySelector('form') as HTMLFormElement);
      const items = TLX_ITEMS.map(([id]) => Number(fd.get(id)));
      const skip = fd.get('skipTlx') === 'on';
      resolve({ kss: Number(fd.get('kss')), tlx: skip ? null : { value: items.reduce((s, v) => s + v, 0) / items.length, items } });
    });
  });
}

/** Runs the PVT-B. Respond with Space, a click or a tap whenever the counter appears. */
export function runPvt(durationMs = PVT_B.durationMs): Promise<PvtSummary | null> {
  return new Promise((resolve) => {
    const d = dialog(`<div class="pvt">
      <div class="pvt-head"><span>Reaction test</span><span class="pvt-time"></span><button class="ghost pvt-cancel">Stop</button></div>
      <div class="pvt-stage" tabindex="0"><div class="pvt-intro">Look at this box. When a red counter appears, press <kbd>Space</kbd> or click as fast as you can.<br><br><button class="primary pvt-go">Start (${Math.round(durationMs / 60000)} min)</button></div><div class="pvt-counter" hidden></div></div>
      <p class="muted small">Brief PVT (PVT-B). Browser timing adds a few milliseconds, the same for every test, so compare your results with your own.</p>
    </div>`);
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

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      d.close();
      resolve(ok ? scorePvt(rts, premature) : null);
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
      finish(false);
    });
  });
}
