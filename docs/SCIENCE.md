# The science behind BlinkTwin

Everything BlinkTwin predicts, how it is computed, the evidence behind it and its limits. The app shows the same text under each "How is this predicted?" link. Numbers come from the analyses in `results/`.

## When will I feel sleepy?

The forecast projects your sleepiness forward with the **Three-Process Model of alertness** (Åkerstedt & Folkard, 1997), a biomathematical model built from sleep-deprivation and shift-work studies. It adds three processes:

- **S, sleep pressure:** alertness falls exponentially the longer you are awake and recovers exponentially while you sleep. Your wake time and hours slept set its starting point.

- **C, body clock:** a 24-hour rhythm with its alertness peak in the late afternoon (about 16:48) and its low in the early morning.

- **W, sleep inertia:** grogginess right after waking that fades within an hour or two.

Their sum is converted to the **Karolinska Sleepiness Scale** (KSS, 1 to 9; Åkerstedt & Gillberg, 1990). The twin then adds what it has learned about *you*: your offset from the model, estimated from your check-ins, and carried forward with an uncertainty that grows with the forecast horizon. Continuous work adds 0.4 KSS per hour until a break of 10 minutes or more; this time-on-task term is a model assumption that has not been validated yet.

**"Sleepy" means KSS 7** ("sleepy, but no effort to keep awake"). In studies of drivers and of KSS itself, ratings of 7 and above go with more performance lapses, longer blinks and more EEG signs of sleepiness (Ingre et al., 2006; Kaida et al., 2006). The time shown is when the middle of the forecast first reaches 7. The shaded band is a 90% range.

**How good is it?** In the simulation study (300 virtual people over a 24-hour day), the forecast of KSS ≥ 7 one hour ahead had a Brier score of 0.062 with anchoring and four check-ins, against 0.098 for the rhythm model alone (lower is better; 0.163 for guessing the base rate). This is a simulation, not a test on real people yet.

## How sleepy am I now, and how sure is the twin?

The number is the twin's current estimate on the KSS scale: rhythm model + time on task + your personal offset. The ± value is a 90% range from the Kalman filter (Kalman, 1960) that tracks your offset. It shrinks with each check-in and widens again as time passes without new information.

The **Why the twin thinks so** panel splits the estimate exactly: the rhythm model's value plus the amount each source (check-ins, reaction test, webcam) has moved your offset. The parts add up to the estimate because the filter's prediction step never changes the mean, only the uncertainty.

## Why check-ins matter: questionnaire anchoring

Validated questionnaires are the most direct measure of how sleepy and loaded you feel, but you cannot fill them in every minute. Webcam and reaction-time signals are continuous, but each person's eyes and reaction times sit at their own level. A population formula can read you as sleepier or more alert than you are.

BlinkTwin therefore gives each passive signal its own **anchor**: a bias term in the filter that learns how that signal reads *you*. Check-ins set your level; passive signals track changes from it. A camera that reads you wrong moves its anchor, not your estimate.

**Evidence (simulation, 300 virtual people):** three check-ins a day cut the error by about a third against the rhythm model alone (MAE 0.625 vs 0.930 KSS). Adding passive signals *without* anchors gave no gain over check-ins and made the uncertainty overconfident (its 90% ranges covered the truth only 85% of the time). With anchors, the twin was never worse than check-ins alone and slightly better with few check-ins (MAE 0.703 vs 0.732 after one check-in). Learning a personal slope for each signal from a handful of check-ins made things worse, so BlinkTwin learns only the anchors.

**Evidence (DROZY, 14 real people):** with one or two check-ins, personal calibration did not beat the population formula in this small lab dataset. Whether it helps in daily life is what the planned validation study will test.

## Reaction test

The 3-minute **psychomotor vigilance test** (PVT-B; Basner, Mollicone & Dinges, 2011) is the standard behavioural test of sustained attention under sleep loss. A counter appears after a random 1 to 4 s delay and you respond as fast as you can. Responses slower than 355 ms are lapses; responses before the counter, or faster than 100 ms, are false starts.

The twin uses your median reaction time. The population formula comes from the DROZY dataset (14 adults, three tests under increasing sleep deprivation; Massoz et al., 2016): **+2.2 KSS for every 100 ms slower** (95% CI 1.1 to 3.4). Within a person, slower median RT went with higher sleepiness (repeated-measures r = 0.77). DROZY used a 10-minute PVT, so the 3-minute version may differ slightly. Browser timing adds a few milliseconds, the same every time, so compare yourself with yourself.

## Eyes and head (webcam)

MediaPipe Face Landmarker (Kartynnik et al., 2019) runs inside the page and gives, for every frame, how closed each eye is, where you are looking and how your head is turned. No video is stored or sent anywhere; only one-minute summaries are saved in your browser.

- **Blinks** are detected with two thresholds (closing above 50%, reopening below 30%) after adjusting to your own open-eye level.

- **PERCLOS** is the share of time your eyes are at least 80% closed, a long-established drowsiness measure (Wierwille & Ellsworth, 1994; Dinges & Grace, 1998).

- **Blink duration** lengthens as people get sleepier (Caffier et al., 2003; Schleicher et al., 2008).

- **Head pose** (pitch, yaw, roll) is measured relative to your own resting position over the last 20 s; a nod is a pitch change of 12° or more that comes back within 2.5 s.

**Validation:** run unchanged on the DROZY face landmarks, the same blink code agreed with electro-oculography, the gold standard for blinks (Spearman ρ = 0.88 for blink rate; it counted about 5 blinks per minute fewer). In DROZY, PERCLOS (+0.28 KSS per 1%) and blink duration (+1.9 KSS per 100 ms) rose with sleepiness; blink rate did not. Because one minute of webcam data is strongly correlated with the next, the twin gives each minute little weight.

## Drowsiness alarms

**Alarm** (red screen and sound): your eyes stay closed for 1 second or more, or your head drops from its resting position for 1 second while your eyes are closing. Both are signs of a microsleep. The alarm clears after 1.5 s with your eyes open.

**Warning** (amber): over the last minute, PERCLOS of 15% or more, two or more eye closures longer than 1 s, slow blinks (300 ms or longer on average), or a twin estimate of KSS 7 or more. Warnings repeat at most every 5 minutes.

These thresholds are sensible defaults drawn from the drowsiness literature, but they have not been validated for BlinkTwin. **Do not rely on BlinkTwin to keep you safe while driving or operating machinery.**

## Cognitive load

Workload is measured with the **NASA Task Load Index** (raw TLX: the mean of six 0 to 100 ratings; Hart & Staveland, 1988). Between check-ins the estimate relaxes towards the typical demand of what you are doing (focused work, reading, a meeting, a break), with a 20-minute time constant. Those typical demands start from defaults and move towards your own TLX ratings in each activity. Blink rate, which tends to fall during visually demanding work, adds weak evidence. Treat the workload estimate as approximate between check-ins.

## What-if scenarios

The twin re-runs its forecast with one input changed. **A 15-minute break** resets time on task. **Going to bed** lets sleep pressure recover during the sleep episode and starts a new day from the new wake time. **Keep going** continues the current activity. Everything else (your offset and its uncertainty) stays the same.

## Limits

- BlinkTwin is a research prototype, not a medical device. It does not diagnose anything.

- The Three-Process Model's constants describe an average person; the twin's offset corrects your level but not, for example, an unusual body-clock timing.

- The population formulas come from 14 people in a sleep laboratory with a near-infrared camera; ordinary webcams, lighting and glasses can change the eye measures.

- The simulation results depend on how the virtual people were built. A study with real users is planned.

## References

- Åkerstedt T, Folkard S. The three-process model of alertness and its extension to performance, sleep latency, and sleep length. *Chronobiol Int* 1997;14(2):115–123.

- Åkerstedt T, Gillberg M. Subjective and objective sleepiness in the active individual. *Int J Neurosci* 1990;52:29–37.

- Basner M, Mollicone D, Dinges DF. Validity and sensitivity of a brief psychomotor vigilance test (PVT-B) to total and partial sleep deprivation. *Acta Astronaut* 2011;69:949–959.

- Caffier PP, Erdmann U, Ullsperger P. Experimental evaluation of eye-blink parameters as a drowsiness measure. *Eur J Appl Physiol* 2003;89:319–325.

- Dinges DF, Grace R. PERCLOS: a valid psychophysiological measure of alertness as assessed by psychomotor vigilance. FHWA-MCRT-98-006, 1998.

- Hart SG, Staveland LE. Development of NASA-TLX (Task Load Index). *Adv Psychol* 1988;52:139–183.

- Ingre M, Åkerstedt T, Peters B, Anund A, Kecklund G. Subjective sleepiness, simulated driving performance and blink duration: examining individual differences. *J Sleep Res* 2006;15:47–53.

- Kaida K, Takahashi M, Åkerstedt T, et al. Validation of the Karolinska sleepiness scale against performance and EEG variables. *Clin Neurophysiol* 2006;117:1574–1581.

- Kalman RE. A new approach to linear filtering and prediction problems. *J Basic Eng* 1960;82:35–45.

- Kartynnik Y, Ablavatski A, Grishchenko I, Grundmann M. Real-time facial surface geometry from monocular video on mobile GPUs. arXiv:1907.06724, 2019.

- Massoz Q, Langohr T, François C, Verly JG. The ULg multimodality drowsiness database (called DROZY) and examples of use. IEEE WACV 2016.

- Schleicher R, Galley N, Briest S, Galley L. Blinks and saccades as indicators of fatigue in sleepiness warnings: looking tired? *Ergonomics* 2008;51:982–1010.

- Wierwille WW, Ellsworth LA. Evaluation of driver drowsiness by trained raters. *Accid Anal Prev* 1994;26:571–581.

