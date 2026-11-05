# The science behind BlinkTwin

Everything BlinkTwin predicts, how it is computed, the evidence behind it and its limits. The app shows the same text under each "How is this predicted?" link. Numbers come from the analyses in `results/`.

## When will I feel sleepy?

The forecast projects your sleepiness forward with the **Three-Process Model of alertness** (Åkerstedt & Folkard, 1997), a biomathematical model built from sleep-deprivation and shift-work studies, in its published form (Åkerstedt, Folkard & Portin, 2004; Åkerstedt et al., 2008; Ingre et al., 2014). It adds four processes:

- **S, sleep pressure:** alertness falls the longer you are awake and recovers while you sleep. Below a breakpoint (12.2 on the model's scale) recovery is linear and slow, so a short night recovers less than a long one. S carries over from night to night, so a run of short nights builds up sleep debt, provided you enter each night's sleep.

- **C, body clock:** a 24-hour rhythm with its alertness peak at about 16:48 and its low in the early morning.

- **U, ultradian rhythm:** a 12-hour component with dips at about 13:48 (the post-lunch dip) and 01:48.

- **W, sleep inertia:** grogginess right after waking that fades within an hour or two.

Their sum is converted to the **Karolinska Sleepiness Scale** (KSS, 1 to 9; Åkerstedt & Gillberg, 1990) with the published formula KSS = 10.6 − 0.6 × alertness. The twin then adds what it has learned about *you*: your offset from the model, estimated from your check-ins, carried forward with an uncertainty that grows with the forecast horizon. Continuous work adds 0.4 KSS per hour until a break of 10 minutes or more; this time-on-task term is an assumption of BlinkTwin, not part of the published model, and has not been validated.

**"Sleepy" means KSS 7** ("sleepy, but no effort to keep awake"). In studies of drivers and of KSS itself, ratings of 7 and above go with more performance lapses, longer blinks and more EEG signs of sleepiness (Ingre et al., 2006; Kaida et al., 2006). The time shown is when the middle of the forecast first reaches 7. The shaded band is a 90% range.

**How good is it?** In the simulation study (300 virtual people kept awake for 24 hours, three check-ins), the one-hour forecast of KSS ≥ 7 had a Brier score of 0.063 for BlinkTwin, 0.066 for check-ins alone and 0.086 for the rhythm model alone (lower is better; 0.199 for always guessing the base rate). BlinkTwin and check-ins alone were practically the same (difference −0.0028, 95% CI −0.0052 to −0.0001). This is a simulation, not a test on real people.

## How sleepy am I now, and how sure is the twin?

The number is the twin's estimate of how sleepy you **feel**, on the KSS scale: rhythm model + time on task + your personal offset. Because your check-ins set its level, it estimates *subjective* sleepiness. After several short nights people often feel less impaired than their performance shows (Van Dongen et al., 2003). The Now card therefore also shows an **objective check**: what your last reaction test says on the population scale, not adjusted to you. A single reading cannot show that you are more impaired than you feel, because people's usual reaction times differ by about 2.6 KSS points and devices add their own delay; the app flags a possible gap only when your own reaction times slow over a day or a week while your ratings do not. This check is experimental and has not been validated.

The ± value is a 90% range from the Kalman filter (Kalman, 1960) that tracks your offset. It shrinks with each check-in and widens again as time passes without new information.

The **Why the twin thinks so** panel adds up how much each source (check-ins, reaction tests, webcam) has moved your offset, on top of the rhythm model and time on task. It is bookkeeping of the filter's updates, and it depends on their order: a check-in that follows a reaction test can take back part of what that test added.

## Why check-ins matter: questionnaire anchoring

Validated questionnaires are the most direct measure of how sleepy you feel, but you cannot fill them in every minute. Reaction times and the eyes can be measured often, but each person's sit at their own level: a population formula can read you as sleepier or more alert than you are.

BlinkTwin reads each passive signal through a **forward measurement model**: the signal equals a population baseline, plus a change for each KSS point, plus your own **anchor** (how far your baseline sits from the population's), plus noise. In DROZY, median reaction time rose 18.8 ms per KSS point within a person, while people's baselines differed by about 49 ms. Each signal's anchor is part of the filter's state. Check-ins set your level; a signal that reads you wrong moves its anchor, not your estimate; later changes in that signal move your estimate.

**Evidence from real people (DROZY, 14 adults, the released twin with each person left out in turn):** for the KSS of the later, sleep-deprived tests, the mean absolute error was 1.73 for the rhythm model alone, 1.51 with a check-in at the first test, 1.47 with reaction test and eyes only, and 1.38 with both (20 to 24 predictions; the confidence intervals overlap widely). Simply predicting each test's average rating in the other people gave 1.39, so in DROZY the twin did not beat that benchmark.

**Does a personal offset carry over?** In OpenNeuro ds004902 (Xiang et al., 2024; 33 adults), a person's offset from the rhythm model after normal sleep was only weakly related to their offset after a night without sleep (r = 0.29, 95% CI −0.05 to 0.58). An offset learned on an ordinary day may carry over only partly to a very different day, which is why the offset is allowed to drift.

**Evidence from simulation (300 virtual people per scenario, 24 hours awake):** three check-ins cut the error from 0.82 (rhythm model alone) to 0.66, and BlinkTwin reached 0.63 (difference from check-ins alone −0.03, 95% CI −0.04 to −0.02; better for 64% of people). Adding the passive signals *without* anchors made the error much worse (MAE 1.74). Across 8 scenarios that break the twin's assumptions on purpose, the difference between BlinkTwin and check-ins alone (three check-ins) ranged from −0.06 to −0.01 KSS points. These differences are small, a few hundredths of a KSS point. Simulation shows what the model can do when its structure is roughly right, not that it helps real people.

## Reaction test

The 3-minute **psychomotor vigilance test** (PVT-B; Basner, Mollicone & Dinges, 2011) is the standard behavioural test of sustained attention under sleep loss. A counter appears after a random 1 to 4 s delay and you respond as fast as you can. Responses slower than 355 ms are lapses; responses before the counter, or faster than 100 ms, are false starts.

The twin uses your median reaction time through its forward model, fitted on DROZY (14 adults, three 10-minute PVTs under increasing sleep deprivation; Massoz et al., 2016): within a person, median reaction time rose **18.8 ms for every KSS point**, with about 36 ms of test-to-test noise. DROZY used a 10-minute PVT on laboratory hardware, so the 3-minute browser version may behave differently.

Browsers, keyboards and screens add a delay of tens of milliseconds that differs between devices (Bridges et al., 2020; Anwyl-Irvine et al., 2021). Your reaction-time anchor absorbs a constant delay once you have checked in, but a new device or browser changes it, so compare yourself with yourself on the same machine.

## Eyes and head (webcam)

MediaPipe Face Landmarker (Kartynnik et al., 2019) runs inside the page and gives, for every frame, how closed each eye is (its eyeBlink blendshapes; Grishchenko et al., 2023), where you are looking and how your head is turned. No video is stored or sent anywhere; only one-minute summaries are saved in your browser.

- **Blinks** are detected with two thresholds (closing above 50%, reopening below 30%) after adjusting to your own open-eye level.

- **PERCLOS** is the share of time your eyes are at least 80% closed on this adjusted score. It follows the idea of the established eyelid measure (Wierwille et al., 1994; Dinges & Grace, 1998) but is not the same calibrated measurement.

- **Blink duration** lengthens as people get sleepier (Caffier et al., 2003; Schleicher et al., 2008).

- **Head pose** (pitch, yaw, roll) is measured relative to your own resting position over the last 20 s; a nod is a pitch change of 12° or more that comes back within 2.5 s.

**Validation on DROZY videos.** We ran this pipeline (the same MediaPipe model file and the same blink code) on all 36 DROZY tests (14 people). The videos are near-infrared, not from an ordinary webcam. A face was found in 99.9% of frames. Blink rate agreed moderately with electro-oculography, the reference for blinks (Spearman ρ = 0.71; within a person r = 0.65), but about 13 blinks per minute were missed. Within a person, longer blinks (r = 0.58) and more long eye closures (r = 0.51) went with higher sleepiness ratings. PERCLOS did not work on this video: MediaPipe's closure score rarely came near full closure (its 99th percentile averaged 0.68), so PERCLOS stayed below 0.5% in every test. The twin therefore ignores PERCLOS when the camera's blinks do not reach full closure. Run on DROZY's 68-point face landmarks instead, the same blink code agreed closely with electro-oculography (Spearman ρ = 0.88 for blink rate), so the weak link is the closure score, not the blink logic. Validation with ordinary webcams is still needed.

Successive minutes of PERCLOS are correlated (lag-1 correlation 0.32 in DROZY), so the twin counts each minute as less than one independent reading.

## Long eye-closure and head-drop alerts

**Long eye-closure alert** (red screen and sound): your eyes stay closed for 1 second or more while you are not looking down. **Head-drop alert**: your head tilts forward from its resting position for 1 second or more while your eyes are at least half closed. The alert clears after 1.5 s with your eyes open. These are behavioural warning signs. They are not microsleeps, which are defined from the EEG (Hertig-Godeschalk et al., 2020).

**Warning** (amber): over the last minute, PERCLOS of 15% or more, two or more eye closures longer than 1 s, slow blinks (300 ms or longer on average), or a twin estimate of KSS 7 or more. Warnings repeat at most every 5 minutes.

All thresholds are ad hoc defaults chosen from the drowsiness literature; none has been validated for BlinkTwin. Looking down at a keyboard or phone lowers the eyelids, so eye closure while looking down is ignored, but false alerts are still possible, and the absence of an alert does not mean you are fit. **Do not rely on BlinkTwin to keep you safe while driving or operating machinery.**

## Perceived workload

Workload is measured with the **NASA Task Load Index** (raw TLX: the mean of six 0 to 100 ratings; Hart & Staveland, 1988). Rate the work you were just doing, not the reaction test. Between check-ins the estimate relaxes towards the typical demand of what you are doing, with a 20-minute time constant. The typical demands start from defaults (break 15, reading 40, meeting 50, focused work 65) and move towards your own TLX ratings in each activity. No camera signal is used for workload. The workload estimate has not been evaluated; treat it as approximate between check-ins.

## What-if scenarios

The twin re-runs its forecast with one input changed. **A 15-minute break** sets time on task to zero; the forecast then assumes you do not go back to continuous work. **Going to bed** lets sleep pressure recover during the sleep episode and starts a new day from the new wake time. **Keep going** continues the current activity. Your offset and its uncertainty stay the same in every scenario.

## Limits

- BlinkTwin is a research prototype, not a medical device. It does not diagnose anything.

- Its main estimate is how sleepy you feel, because your ratings set its level. Use the objective reaction-test check alongside it.

- The Three-Process Model's constants describe an average person. The twin's offset corrects your level, but not an unusual body-clock timing, shift work, travel across time zones or a daylight-saving change. Naps and caffeine are not modelled.

- If you do not enter your sleep, the twin assumes you woke at 07:00 after 7.5 hours.

- The signal models come from 14 people in a sleep laboratory with a near-infrared camera and a 10-minute PVT; ordinary webcams, lighting, glasses and a 3-minute browser test can change them.

- The simulation results depend on how the virtual people were built. A study with real users is planned.

## References

- Åkerstedt T, Folkard S. The three-process model of alertness and its extension to performance, sleep latency, and sleep length. *Chronobiol Int* 1997;14(2):115–123.

- Åkerstedt T, Folkard S, Portin C. Predictions from the three-process model of alertness. *Aviat Space Environ Med* 2004;75(3 Suppl):A75–A83.

- Åkerstedt T, Gillberg M. Subjective and objective sleepiness in the active individual. *Int J Neurosci* 1990;52:29–37.

- Åkerstedt T, Ingre M, Kecklund G, Folkard S, Axelsson J. Accounting for partial sleep deprivation and cumulative sleepiness in the three-process model of alertness regulation. *Chronobiol Int* 2008;25(2):309–319.

- Anwyl-Irvine A, Dalmaijer ES, Hodges N, Evershed JK. Realistic precision and accuracy of online experiment platforms, web browsers, and devices. *Behav Res Methods* 2021;53(4):1407–1425.

- Basner M, Mollicone D, Dinges DF. Validity and sensitivity of a brief psychomotor vigilance test (PVT-B) to total and partial sleep deprivation. *Acta Astronaut* 2011;69:949–959.

- Bridges D, Pitiot A, MacAskill MR, Peirce JW. The timing mega-study: comparing a range of experiment generators, both lab-based and online. *PeerJ* 2020;8:e9414.

- Caffier PP, Erdmann U, Ullsperger P. Experimental evaluation of eye-blink parameters as a drowsiness measure. *Eur J Appl Physiol* 2003;89:319–325.

- Dinges DF, Grace R. PERCLOS: a valid psychophysiological measure of alertness as assessed by psychomotor vigilance. FHWA-MCRT-98-006, 1998.

- Grishchenko I, et al. Blendshapes GHUM: real-time monocular facial blendshape prediction. arXiv:2309.05782, 2023.

- Hart SG, Staveland LE. Development of NASA-TLX (Task Load Index). *Adv Psychol* 1988;52:139–183.

- Hertig-Godeschalk A, Skorucak J, Malafeev A, Achermann P, Mathis J, Schreier DR. Microsleep episodes in the borderland between wakefulness and sleep. *Sleep* 2020;43(1):zsz163.

- Ingre M, Åkerstedt T, Peters B, Anund A, Kecklund G. Subjective sleepiness, simulated driving performance and blink duration: examining individual differences. *J Sleep Res* 2006;15:47–53.

- Ingre M, Van Leeuwen W, Klemets T, et al. Validating and extending the three process model of alertness in airline operations. *PLoS ONE* 2014;9(10):e108679.

- Kaida K, Takahashi M, Åkerstedt T, et al. Validation of the Karolinska sleepiness scale against performance and EEG variables. *Clin Neurophysiol* 2006;117:1574–1581.

- Kalman RE. A new approach to linear filtering and prediction problems. *J Basic Eng* 1960;82:35–45.

- Kartynnik Y, Ablavatski A, Grishchenko I, Grundmann M. Real-time facial surface geometry from monocular video on mobile GPUs. arXiv:1907.06724, 2019.

- Massoz Q, Langohr T, François C, Verly JG. The ULg multimodality drowsiness database (called DROZY) and examples of use. IEEE WACV 2016.

- Schleicher R, Galley N, Briest S, Galley L. Blinks and saccades as indicators of fatigue in sleepiness warnings: looking tired? *Ergonomics* 2008;51:982–1010.

- Van Dongen HPA, Maislin G, Mullington JM, Dinges DF. The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation. *Sleep* 2003;26(2):117–126.

- Wierwille WW, Wreggit SS, Kirn CL, Ellsworth LA, Fairbanks RJ. Research on vehicle-based driver status/performance monitoring: development, validation, and refinement of algorithms for detection of driver drowsiness. NHTSA report DOT HS 808 247, 1994.

- Xiang C, Fan X, Bai D, Lv K, Lei X. A resting-state EEG dataset for sleep deprivation. *Sci Data* 2024;11:427.

