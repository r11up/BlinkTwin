// "How is this predicted?": the science behind every number the app shows. Kept in one place so the
// app and docs/SCIENCE.md say the same thing. Numbers come from results/ in the repository.

export interface ScienceSection {
  id: string;
  title: string;
  html: string;
}

export const SCIENCE: ScienceSection[] = [
  {
    id: 'forecast',
    title: 'When will I feel sleepy?',
    html: `<p>The forecast projects your sleepiness forward with the <b>Three-Process Model of alertness</b> (Åkerstedt &amp; Folkard, 1997), a biomathematical model built from sleep-deprivation and shift-work studies, in its published form (Åkerstedt, Folkard &amp; Portin, 2004; Åkerstedt et al., 2008; Ingre et al., 2014). It adds four processes:</p>
<ul>
<li><b>S, sleep pressure:</b> alertness falls the longer you are awake and recovers while you sleep. Below a breakpoint (12.2 on the model's scale) recovery is linear and slow, so a short night recovers less than a long one. S carries over from night to night, so a run of short nights builds up sleep debt, provided you enter each night's sleep.</li>
<li><b>C, body clock:</b> a 24-hour rhythm with its alertness peak at about 16:48 and its low in the early morning.</li>
<li><b>U, ultradian rhythm:</b> a 12-hour component with dips at about 13:48 (the post-lunch dip) and 01:48.</li>
<li><b>W, sleep inertia:</b> grogginess right after waking that fades within an hour or two.</li>
</ul>
<p>Their sum is converted to the <b>Karolinska Sleepiness Scale</b> (KSS, 1 to 9; Åkerstedt &amp; Gillberg, 1990) with the published formula KSS = 10.6 − 0.6 × alertness. The twin then adds what it has learned about <i>you</i>: your offset from the model, estimated from your check-ins, carried forward with an uncertainty that grows with the forecast horizon. Continuous work adds 0.4 KSS per hour until a break of 10 minutes or more; this time-on-task term is an assumption of BlinkTwin, not part of the published model, and has not been validated.</p>
<p><b>"Sleepy" means KSS 7</b> ("sleepy, but no effort to keep awake"). In studies of drivers and of KSS itself, ratings of 7 and above go with more performance lapses, longer blinks and more EEG signs of sleepiness (Ingre et al., 2006; Kaida et al., 2006). The time shown is when the middle of the forecast first reaches 7. The shaded band is a 90% range.</p>
<p><b>How good is it?</b> In the simulation study (300 virtual people kept awake for 24 hours, three check-ins), the one-hour forecast of KSS ≥ 7 had a Brier score of ⟦fc_twin⟧ for BlinkTwin, ⟦fc_checkins⟧ for check-ins alone and ⟦fc_prior⟧ for the rhythm model alone (lower is better; ⟦fc_clim⟧ for always guessing the base rate). BlinkTwin and check-ins alone were practically the same (difference ⟦fc_diff⟧, 95% CI ⟦fc_diff_ci⟧). This is a simulation, not a test on real people.</p>`,
  },
  {
    id: 'now',
    title: 'How sleepy am I now, and how sure is the twin?',
    html: `<p>The number is the twin's estimate of how sleepy you <b>feel</b>, on the KSS scale: rhythm model + time on task + your personal offset. Because your check-ins set its level, it estimates <i>subjective</i> sleepiness. After several short nights people often feel less impaired than their performance shows (Van Dongen et al., 2003). The Now card therefore also shows an <b>objective check</b>: what your last reaction test says on the population scale, not adjusted to you. If it reads well above how sleepy you feel, take that seriously.</p>
<p>The ± value is a 90% range from the Kalman filter (Kalman, 1960) that tracks your offset. It shrinks with each check-in and widens again as time passes without new information.</p>
<p>The <b>Why the twin thinks so</b> panel adds up how much each source (check-ins, reaction tests, webcam) has moved your offset, on top of the rhythm model and time on task. It is bookkeeping of the filter's updates, and it depends on their order: a check-in that follows a reaction test can take back part of what that test added.</p>`,
  },
  {
    id: 'anchoring',
    title: 'Why check-ins matter: questionnaire anchoring',
    html: `<p>Validated questionnaires are the most direct measure of how sleepy you feel, but you cannot fill them in every minute. Reaction times and the eyes can be measured often, but each person's sit at their own level: a population formula can read you as sleepier or more alert than you are.</p>
<p>BlinkTwin reads each passive signal through a <b>forward measurement model</b>: the signal equals a population baseline, plus a change for each KSS point, plus your own <b>anchor</b> (how far your baseline sits from the population's), plus noise. In DROZY, median reaction time rose 18.8 ms per KSS point within a person, while people's baselines differed by about 49 ms. Each signal's anchor is part of the filter's state. Check-ins set your level; a signal that reads you wrong moves its anchor, not your estimate; later changes in that signal move your estimate.</p>
<p><b>Evidence from real people (DROZY, 14 adults, the released twin with each person left out in turn):</b> for the KSS of the later, sleep-deprived tests, the mean absolute error was 1.73 for the rhythm model alone, 1.51 with a check-in at the first test, 1.47 with reaction test and eyes only, and 1.38 with both (20 to 24 predictions; the confidence intervals overlap widely). Simply predicting each test's average rating in the other people gave 1.39, so in DROZY the twin did not beat that benchmark.</p>
<p><b>Does a personal offset carry over?</b> In OpenNeuro ds004902 (Xiang et al., 2024; 33 adults), a person's offset from the rhythm model after normal sleep was only weakly related to their offset after a night without sleep (r = 0.29, 95% CI −0.05 to 0.58). An offset learned on an ordinary day may carry over only partly to a very different day, which is why the offset is allowed to drift.</p>
<p><b>Evidence from simulation (300 virtual people per scenario, 24 hours awake):</b> three check-ins cut the error from ⟦m_prior⟧ (rhythm model alone) to ⟦m_checkins3⟧, and BlinkTwin reached ⟦m_twin3⟧ (difference from check-ins alone ⟦d_twin3⟧, 95% CI ⟦d_twin3_ci⟧; better for ⟦w_twin3⟧ of people). Adding the passive signals <i>without</i> anchors made the error much worse (⟦m_noanchor3⟧). Across ⟦n_scen⟧ scenarios that break the twin's assumptions on purpose, BlinkTwin's error with three check-ins was ⟦range_d⟧ KSS points from check-ins alone. These differences are small, a few hundredths of a KSS point. Simulation shows what the model can do when its structure is roughly right, not that it helps real people.</p>`,
  },
  {
    id: 'pvt',
    title: 'Reaction test',
    html: `<p>The 3-minute <b>psychomotor vigilance test</b> (PVT-B; Basner, Mollicone &amp; Dinges, 2011) is the standard behavioural test of sustained attention under sleep loss. A counter appears after a random 1 to 4 s delay and you respond as fast as you can. Responses slower than 355 ms are lapses; responses before the counter, or faster than 100 ms, are false starts.</p>
<p>The twin uses your median reaction time through its forward model, fitted on DROZY (14 adults, three 10-minute PVTs under increasing sleep deprivation; Massoz et al., 2016): within a person, median reaction time rose <b>18.8 ms for every KSS point</b>, with about 36 ms of test-to-test noise. DROZY used a 10-minute PVT on laboratory hardware, so the 3-minute browser version may behave differently.</p>
<p>Browsers, keyboards and screens add a delay of tens of milliseconds that differs between devices (Bridges et al., 2020; Anwyl-Irvine et al., 2021). Your reaction-time anchor absorbs a constant delay once you have checked in, but a new device or browser changes it, so compare yourself with yourself on the same machine.</p>`,
  },
  {
    id: 'eyes',
    title: 'Eyes and head (webcam)',
    html: `<p>MediaPipe Face Landmarker (Kartynnik et al., 2019) runs inside the page and gives, for every frame, how closed each eye is (its eyeBlink blendshapes; Grishchenko et al., 2023), where you are looking and how your head is turned. No video is stored or sent anywhere; only one-minute summaries are saved in your browser.</p>
<ul>
<li><b>Blinks</b> are detected with two thresholds (closing above 50%, reopening below 30%) after adjusting to your own open-eye level.</li>
<li><b>PERCLOS</b> is the share of time your eyes are at least 80% closed on this adjusted score. It follows the idea of the established eyelid measure (Wierwille et al., 1994; Dinges &amp; Grace, 1998) but is not the same calibrated measurement.</li>
<li><b>Blink duration</b> lengthens as people get sleepier (Caffier et al., 2003; Schleicher et al., 2008).</li>
<li><b>Head pose</b> (pitch, yaw, roll) is measured relative to your own resting position over the last 20 s; a nod is a pitch change of 12° or more that comes back within 2.5 s.</li>
</ul>
<p><b>Validation on DROZY videos.</b> We ran this pipeline (the same MediaPipe model file and the same blink code) on all 36 DROZY tests (14 people). The videos are near-infrared, not from an ordinary webcam. A face was found in 99.9% of frames. Blink rate agreed moderately with electro-oculography, the reference for blinks (Spearman ρ = 0.71; within a person r = 0.65), but about 13 blinks per minute were missed. Within a person, longer blinks (r = 0.58) and more long eye closures (r = 0.51) went with higher sleepiness ratings. PERCLOS did not work on this video: MediaPipe's closure score rarely came near full closure (its 99th percentile averaged 0.68), so PERCLOS stayed below 0.5% in every test. The twin therefore ignores PERCLOS when the camera's blinks do not reach full closure. Run on DROZY's 68-point face landmarks instead, the same blink code agreed closely with electro-oculography (Spearman ρ = 0.88 for blink rate), so the weak link is the closure score, not the blink logic. Validation with ordinary webcams is still needed.</p>
<p>Successive minutes of PERCLOS are correlated (lag-1 correlation 0.32 in DROZY), so the twin counts each minute as less than one independent reading.</p>`,
  },
  {
    id: 'alarms',
    title: 'Long eye-closure and head-drop alerts',
    html: `<p><b>Long eye-closure alert</b> (red screen and sound): your eyes stay closed for 1 second or more while you are not looking down. <b>Head-drop alert</b>: your head tilts forward from its resting position for 1 second or more while your eyes are at least half closed. The alert clears after 1.5 s with your eyes open. These are behavioural warning signs. They are not microsleeps, which are defined from the EEG (Hertig-Godeschalk et al., 2020).</p>
<p><b>Warning</b> (amber): over the last minute, PERCLOS of 15% or more, two or more eye closures longer than 1 s, slow blinks (300 ms or longer on average), or a twin estimate of KSS 7 or more. Warnings repeat at most every 5 minutes.</p>
<p>All thresholds are ad hoc defaults chosen from the drowsiness literature; none has been validated for BlinkTwin. Looking down at a keyboard or phone lowers the eyelids, so eye closure while looking down is ignored, but false alerts are still possible, and the absence of an alert does not mean you are fit. <b>Do not rely on BlinkTwin to keep you safe while driving or operating machinery.</b></p>`,
  },
  {
    id: 'workload',
    title: 'Perceived workload',
    html: `<p>Workload is measured with the <b>NASA Task Load Index</b> (raw TLX: the mean of six 0 to 100 ratings; Hart &amp; Staveland, 1988). Rate the work you were just doing, not the reaction test. Between check-ins the estimate relaxes towards the typical demand of what you are doing, with a 20-minute time constant. The typical demands start from defaults (break 15, reading 40, meeting 50, focused work 65) and move towards your own TLX ratings in each activity. No camera signal is used for workload. The workload estimate has not been evaluated; treat it as approximate between check-ins.</p>`,
  },
  {
    id: 'whatif',
    title: 'What-if scenarios',
    html: `<p>The twin re-runs its forecast with one input changed. <b>A 15-minute break</b> sets time on task to zero; the forecast then assumes you do not go back to continuous work. <b>Going to bed</b> lets sleep pressure recover during the sleep episode and starts a new day from the new wake time. <b>Keep going</b> continues the current activity. Your offset and its uncertainty stay the same in every scenario.</p>`,
  },
  {
    id: 'limits',
    title: 'Limits',
    html: `<ul>
<li>BlinkTwin is a research prototype, not a medical device. It does not diagnose anything.</li>
<li>Its main estimate is how sleepy you feel, because your ratings set its level. Use the objective reaction-test check alongside it.</li>
<li>The Three-Process Model's constants describe an average person. The twin's offset corrects your level, but not an unusual body-clock timing, shift work, travel across time zones or a daylight-saving change. Naps and caffeine are not modelled.</li>
<li>If you do not enter your sleep, the twin assumes you woke at 07:00 after 7.5 hours.</li>
<li>The signal models come from 14 people in a sleep laboratory with a near-infrared camera and a 10-minute PVT; ordinary webcams, lighting, glasses and a 3-minute browser test can change them.</li>
<li>The simulation results depend on how the virtual people were built. A study with real users is planned.</li>
</ul>`,
  },
  {
    id: 'refs',
    title: 'References',
    html: `<ul class="refs">
<li>Åkerstedt T, Folkard S. The three-process model of alertness and its extension to performance, sleep latency, and sleep length. <i>Chronobiol Int</i> 1997;14(2):115–123.</li>
<li>Åkerstedt T, Folkard S, Portin C. Predictions from the three-process model of alertness. <i>Aviat Space Environ Med</i> 2004;75(3 Suppl):A75–A83.</li>
<li>Åkerstedt T, Gillberg M. Subjective and objective sleepiness in the active individual. <i>Int J Neurosci</i> 1990;52:29–37.</li>
<li>Åkerstedt T, Ingre M, Kecklund G, Folkard S, Axelsson J. Accounting for partial sleep deprivation and cumulative sleepiness in the three-process model of alertness regulation. <i>Chronobiol Int</i> 2008;25(2):309–319.</li>
<li>Anwyl-Irvine A, Dalmaijer ES, Hodges N, Evershed JK. Realistic precision and accuracy of online experiment platforms, web browsers, and devices. <i>Behav Res Methods</i> 2021;53(4):1407–1425.</li>
<li>Basner M, Mollicone D, Dinges DF. Validity and sensitivity of a brief psychomotor vigilance test (PVT-B) to total and partial sleep deprivation. <i>Acta Astronaut</i> 2011;69:949–959.</li>
<li>Bridges D, Pitiot A, MacAskill MR, Peirce JW. The timing mega-study: comparing a range of experiment generators, both lab-based and online. <i>PeerJ</i> 2020;8:e9414.</li>
<li>Caffier PP, Erdmann U, Ullsperger P. Experimental evaluation of eye-blink parameters as a drowsiness measure. <i>Eur J Appl Physiol</i> 2003;89:319–325.</li>
<li>Dinges DF, Grace R. PERCLOS: a valid psychophysiological measure of alertness as assessed by psychomotor vigilance. FHWA-MCRT-98-006, 1998.</li>
<li>Grishchenko I, et al. Blendshapes GHUM: real-time monocular facial blendshape prediction. arXiv:2309.05782, 2023.</li>
<li>Hart SG, Staveland LE. Development of NASA-TLX (Task Load Index). <i>Adv Psychol</i> 1988;52:139–183.</li>
<li>Hertig-Godeschalk A, Skorucak J, Malafeev A, Achermann P, Mathis J, Schreier DR. Microsleep episodes in the borderland between wakefulness and sleep. <i>Sleep</i> 2020;43(1):zsz163.</li>
<li>Ingre M, Åkerstedt T, Peters B, Anund A, Kecklund G. Subjective sleepiness, simulated driving performance and blink duration: examining individual differences. <i>J Sleep Res</i> 2006;15:47–53.</li>
<li>Ingre M, Van Leeuwen W, Klemets T, et al. Validating and extending the three process model of alertness in airline operations. <i>PLoS ONE</i> 2014;9(10):e108679.</li>
<li>Kaida K, Takahashi M, Åkerstedt T, et al. Validation of the Karolinska sleepiness scale against performance and EEG variables. <i>Clin Neurophysiol</i> 2006;117:1574–1581.</li>
<li>Kalman RE. A new approach to linear filtering and prediction problems. <i>J Basic Eng</i> 1960;82:35–45.</li>
<li>Kartynnik Y, Ablavatski A, Grishchenko I, Grundmann M. Real-time facial surface geometry from monocular video on mobile GPUs. arXiv:1907.06724, 2019.</li>
<li>Massoz Q, Langohr T, François C, Verly JG. The ULg multimodality drowsiness database (called DROZY) and examples of use. IEEE WACV 2016.</li>
<li>Schleicher R, Galley N, Briest S, Galley L. Blinks and saccades as indicators of fatigue in sleepiness warnings: looking tired? <i>Ergonomics</i> 2008;51:982–1010.</li>
<li>Van Dongen HPA, Maislin G, Mullington JM, Dinges DF. The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation. <i>Sleep</i> 2003;26(2):117–126.</li>
<li>Wierwille WW, Wreggit SS, Kirn CL, Ellsworth LA, Fairbanks RJ. Research on vehicle-based driver status/performance monitoring: development, validation, and refinement of algorithms for detection of driver drowsiness. NHTSA report DOT HS 808 247, 1994.</li>
<li>Xiang C, Fan X, Bai D, Lv K, Lei X. A resting-state EEG dataset for sleep deprivation. <i>Sci Data</i> 2024;11:427.</li>
</ul>`,
  },
];

export function openScience(sectionId?: string) {
  const d = document.createElement('dialog');
  d.className = 'science';
  d.innerHTML = `<div class="science-head"><h2>How BlinkTwin predicts</h2><button class="ghost science-close">Close</button></div>
    <nav class="science-nav">${SCIENCE.map((s) => `<a href="#sci-${s.id}">${s.title}</a>`).join('')}</nav>
    ${SCIENCE.map((s) => `<section id="sci-${s.id}"><h3>${s.title}</h3>${s.html}</section>`).join('')}`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  (d.querySelector('.science-close') as HTMLButtonElement).addEventListener('click', () => d.close());
  d.querySelectorAll<HTMLAnchorElement>('.science-nav a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      d.querySelector(a.getAttribute('href') as string)?.scrollIntoView({ behavior: 'smooth' });
    }),
  );
  d.showModal();
  if (sectionId) d.querySelector(`#sci-${sectionId}`)?.scrollIntoView();
}

/** Small "How is this predicted?" link that opens the explanation at the right section. */
export function infoLink(sectionId: string, label = 'How is this predicted?'): string {
  return `<button class="info-link" data-science="${sectionId}" type="button">ⓘ ${label}</button>`;
}
