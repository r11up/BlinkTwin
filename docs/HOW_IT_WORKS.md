# How BlinkTwin works, in plain language

This document explains everything BlinkTwin does, from the camera to the numbers on the screen, in words a non-specialist can follow. It is written so that the author can answer any question about the system. Every rule, threshold and constant below is taken from the code, and the file is named next to each part. Worked examples were computed by running the real code with the app's own settings (a short version of the script is in the appendix).

Contents

1. [BlinkTwin in one paragraph](#1-blinktwin-in-one-paragraph)
2. [The big picture](#2-the-big-picture)
3. [What the camera measures, and how](#3-what-the-camera-measures-and-how)
4. [The alerts](#4-the-alerts)
5. [The reaction test (PVT-B)](#5-the-reaction-test-pvt-b)
6. [Check-ins: the questionnaires](#6-check-ins-the-questionnaires)
7. [How sleepiness is predicted, step by step](#7-how-sleepiness-is-predicted-step-by-step)
8. [How cognitive load (workload) is calculated](#8-how-cognitive-load-workload-is-calculated)
9. [Forecasts and what-ifs](#9-forecasts-and-what-ifs)
10. [The helper panels](#10-the-helper-panels)
11. [Where the numbers come from, and how the twin was tested](#11-where-the-numbers-come-from-and-how-the-twin-was-tested)
12. [Privacy and data](#12-privacy-and-data)
13. [How fast it runs](#13-how-fast-it-runs)
14. [Limits and open questions](#14-limits-and-open-questions)
15. [Questions people ask](#15-questions-people-ask)
16. [Glossary](#16-glossary)

---

## 1. BlinkTwin in one paragraph

BlinkTwin is a web page that keeps a running estimate of how sleepy you feel and how loaded you are while you work at a laptop. It combines four things: a published model of the body clock that predicts sleepiness from when you woke and how long you slept; the webcam, which measures your blinks and eyelids; a 3-minute reaction-time test; and short questionnaires that you fill in now and then (the "check-ins"). A small statistical model (a Kalman filter, explained in Section 7) joins these into one estimate with a range of uncertainty, forecasts when you are likely to become sleepy, and answers "what if" questions such as "what if I take a break now?". Everything runs inside your browser on your own computer. Video is never stored or sent anywhere.

What BlinkTwin is **not**:

- It is **not a medical device**. It does not diagnose anything.
- It estimates how sleepy you **feel**, on the scale you use when you rate yourself (subjective sleepiness). It does not measure brain activity, and how sleepy you feel is not the same as how impaired you are (Sections 7h and 10b).
- It is **not a tool for deciding whether you are fit to drive** or to operate machinery. Its alerts have not been validated, and the absence of an alert does not mean you are alert.
- It is a research prototype. Its predictions have been tested on public laboratory data and in computer simulations, but not yet in a study of real people using it in daily life.

---

## 2. The big picture

```
 WEBCAM (up to 24 frames per second)                 REACTION TEST           CHECK-INS             CONTEXT AND SLEEP
   |                                                   (3-minute PVT-B)        (KSS 1-9,             (what you are doing,
   v                                                        |                  NASA-TLX 0-100)       when you woke, hours slept,
 MediaPipe face model, inside the page                      |                       |                "I did not sleep")
   |  eye-closure score, head angles, gaze                  |                       |                       |
   v                                                        |                       |                       |
 Blink meter and head tracker (every frame)                 |                       |                       |
   |                 \                                      |                       |                       |
   |                  \---> REAL-TIME ALERTS (every frame: long eye closure, head drop; every second: warnings)
   v                                                        v                       v                       v
 One summary per minute  ---------------------------> EVENT LOG in the browser (numbers only, never images)
                                                            |
                                                            v
                                        THE TWIN (rebuilt by replaying the log every time)
                         body-clock prior + time on task + your personal offset  =  sleepiness now
                         one "anchor" per passive signal (reaction time, blink duration, eye closure)
                         workload: drifts towards the typical demand of your current activity
                                                            |
                                                            v
             ON SCREEN: sleepiness and workload now with a 90% range, "why the twin thinks so",
             forecast and time to KSS 7, what-if lines, your personal model, the objective check,
             check-in suggestions, sleep status, and "How well does the twin know you?"
```

Two paths run side by side:

- **The fast path** (Section 4) checks every camera frame for a long eye closure or a head drop and raises an alert at once. It does not use the twin.
- **The slow path** (Sections 7 to 10) stores one summary per minute, plus every reaction test and check-in, in an event log. The twin's estimate is recalculated from the whole log whenever something new arrives and at least once a minute (`web/src/main.ts`, `render()` and the 60-second timer). Because the twin is rebuilt from the log each time, any number on screen can be reproduced exactly from the stored events.

---

## 3. What the camera measures, and how

Code: `web/src/sensing/camera.ts`, `web/src/sensing/blink.ts`, `web/src/sensing/head.ts`.

### Frames and the face model

When you press "Start camera", the browser asks for permission and opens the webcam at about 640 by 480 pixels. Up to 24 times a second, the current frame is passed to **MediaPipe Face Landmarker**, a face-tracking model from Google that runs inside the page. For each frame it returns:

- 478 points on the face (the "face mesh"), used here only to draw the eye outlines and irises over your video so you can see what is being tracked;
- 52 **blendshapes**: numbers from 0 to 1 that describe facial movements, such as how closed each eye is (`eyeBlinkLeft`, `eyeBlinkRight`) and which way each eye is looking (`eyeLookDown...`, `eyeLookUp...`, `eyeLookIn...`, `eyeLookOut...`);
- a transformation matrix that gives the angle of the head.

The model can run on the graphics processor or on the main processor (CPU). The page first checks how the browser draws graphics: if it does so in software, because there is no usable graphics processor, the CPU mode is used, because on such machines the graphics mode is several times slower (Section 13). The frame itself is then discarded. Only numbers derived from it are kept, and only for the summaries described below.

### The eye-closure score, adapted to you

The raw **eye-closure score** for a frame is the average of the left and right `eyeBlink` blendshapes (0 = open, 1 = closed). Different people, cameras and lights give different "open" levels: one person's open eyes may score 0.05, another's 0.25. So the blink meter adapts to you. It keeps the last 30 seconds of raw scores and takes their 20th percentile as your current open-eye level (the "baseline"). The **normalised closure** of each frame is how far the score sits between that baseline and fully closed:

normalised closure = (score − baseline) / (1 − baseline), limited to the range 0 to 1.

**Long closures do not reset the baseline.** If the eyes stayed shut for most of the 30-second window, the 20th percentile would creep up to the closed level and the meter would wrongly decide the eyes had reopened. To prevent this, once a closure has lasted 2 seconds the baseline is frozen at its value from just before the closure began, and it stays frozen until the eyes reopen. When the closure ends, its closed-eye samples are removed from the baseline window so they cannot distort it. As a safety valve, the freeze is released after 60 seconds, so that a lasting change of posture or lighting can still be adapted to. Closures shorter than 2 seconds are processed exactly as before (`web/src/sensing/blink.ts`, options `freezeAfterMs` = 2000 ms and `releaseAfterMs` = 60 000 ms).

### Blinks, blink duration and long closures

A **blink** is detected with two thresholds, so that small flickers around one threshold do not count twice (this is called hysteresis):

- a closure **starts** when the normalised closure reaches **0.5**;
- it **ends** when the normalised closure falls to **0.3** or below.

The closure's length is the time between these two moments. Then:

| Closure length | Counted as |
|---|---|
| under 50 ms | ignored (too short to be a real blink) |
| 50 ms to 1000 ms | an ordinary **blink**; its length is its **blink duration** |
| over 1000 ms | a **long closure** |

The meter also records each blink's **peak**: the highest normalised closure it reached.

### The one-minute summary

Every second the meter summarises the last 60 seconds for the live display and the warnings. Every full minute it stores one summary in the event log. A summary contains:

| Number | Meaning |
|---|---|
| blink rate | ordinary blinks per minute |
| mean blink duration | average length of the minute's ordinary blinks, in ms (0 if there were none) |
| long closures | number of closures longer than 1 second |
| **PERCLOS** | the share of frames (with a face) in which the normalised closure was **0.8 or more**, that is, the eyes were at least 80% closed |
| coverage | the share of frames in which a face was found |
| peak closure | the median peak closure of the minute's ordinary blinks (only stored if there were at least 3 blinks) |
| frame rate | frames analysed per second in the minute, with or without a face; blink durations are measured in whole frames, so they are less precise at low frame rates |
| nods | head nods in the minute (see below) |
| head movement | how much the head moved over the last 10 seconds (spread of pitch and yaw angles, in degrees) |

**PERCLOS** ("percentage of eye closure") is one of the oldest camera measures of drowsiness: sleepy people spend more time with their eyes nearly shut. **Blink duration** also grows with sleepiness: sleepy people close and reopen their eyes more slowly.

**When PERCLOS cannot be measured.** PERCLOS only works if a full blink actually pushes the normalised closure above 0.8. On some cameras it does not. When we ran the website's own pipeline on the near-infrared videos of the DROZY dataset (Section 11), MediaPipe's raw closure score rarely went above about 0.7, so PERCLOS stayed below 0.5% in all 36 recordings, whatever the person's state (`results/drozy_mediapipe_summary.json`). A PERCLOS that is stuck near zero would wrongly tell the twin "no change". So the **peak closure** number is used as a check: if the median peak of the minute's blinks is **below 0.85**, PERCLOS is shown as "n/a" on screen and the twin ignores it for that minute (`web/src/twin/twin.ts`, `perclosMinPeakClosure`; `web/src/main.ts`, `perclosMeasurable`). Blink duration is still used.

### Looking down

When you look down at a keyboard, phone or papers, your upper eyelids lower and the closure score rises, even though you are wide awake. The page therefore also judges whether you are **looking down**, from the average of the two `eyeLookDown` blendshapes: above **0.45** counts as looking down (`web/src/sensing/head.ts`, `LookDownGate`; `web/src/sensing/camera.ts`).

There is a catch: when the eyes simply close, these "looking down" numbers can rise too, so judging during a closure could mistake a genuine long closure for looking down. The gate therefore makes its decision **from the half second (500 ms) before a closure began**: if in more than half of the frames in that half second you were looking down, the whole closure counts as "looking down"; otherwise it does not, however the numbers move while the eyes are shut. Outside a closure, the current frame decides.

### Head pose, nods and gaze

From the face's transformation matrix the page computes three head angles in degrees: **pitch** (nodding up and down), **yaw** (turning left and right) and **roll** (tilting towards a shoulder). These are expressed relative to your own resting position, which is the median of each angle over the last 20 seconds, so it does not matter how the camera is placed (`web/src/sensing/head.ts`).

- A **nod** is a pitch change of at least **12°** from rest (in either direction) that comes back to within 6° in **2.5 seconds** or less.
- A **head drop** is a **forward** (downward) pitch of at least 12° from rest. It ends when the forward pitch falls back below 6°. Only forward movement counts, because a sleepy head falls forward. (Which sign of pitch means "down" is set by a constant, `PITCH_DOWN_SIGN`, that still needs to be checked on a real device; see Section 14.)
- **Gaze** is estimated from the `eyeLook` blendshapes and shown as left, right or centre and up or down when the value passes ±0.15.

Nods and head movement are stored with each minute but are **not used by the twin**. The head drop is used only by the real-time alert.

### What is stored, and what is never stored

- **Never stored:** video frames, images, face points, blendshapes or any frame-by-frame trace. Frames exist in memory only for the time it takes the face model to process them.
- **Stored:** the one-minute summary numbers in the table above, in your browser's local storage on your own computer. Section 12 has the details.

---

## 4. The alerts

Code: `web/src/sensing/alerts.ts`; display in `web/src/main.ts` and `web/index.html`.

The alerts run on every camera frame and do not depend on the twin's estimate (except for one warning rule).

### The red alert (alarm with sound)

A red full-screen alert with a repeating beep is raised when **any** of these holds:

1. **Long eye-closure alert**: the eyes have been continuously closed (normalised closure has not fallen back to 0.3 since it passed 0.5) for **at least 1 second**, a face is visible, and the closure is not one that began while you were looking down (Section 3).
2. **Head-drop alert**: the head has been pitched **forward** by at least 12° from its resting position for **at least 1 second**, a face is visible, and the eyes are **at least half closed** (normalised closure 0.5 or more).
3. **Face lost while eyes were closed**: the face disappears from view while a red alert is already on, or after the eyes had been closed for at least 1 second (not while looking down). Someone who falls asleep may slump out of the camera's view; losing the face then keeps the alert on rather than clearing it.

The alert clears only when a face is seen **with the eyes open** for **1.5 seconds** in a row. The "I'm awake" button silences the sound. Each alert is also written to the event log (not in demo mode).

### Amber warnings

An amber banner is shown when, over the last minute, **any** of these is true (checked in this order):

| Rule | Threshold |
|---|---|
| PERCLOS | 15% or more |
| Long closures | 2 or more closures longer than 1 second |
| Slow blinks | mean blink duration 300 ms or more, with at least 5 blinks |
| Twin estimate | the twin's sleepiness estimate is KSS 7 or more |

The last rule, the only one driven by the model, is switched off while today's night is an assumed default one, that is, when no sleep has been entered or the last entry is more than 30 hours old (Section 7a); a warning from the model would then be a warning about a default, not about you. Filled-in earlier nights do not switch it off, but the estimate is still flagged. A new warning can appear at most once every **5 minutes**. If no face has been seen for **5 seconds** (and no alert is on), a small "Face not visible" notice is shown.

### Why these rules, and what they are not

- **Looking down is ignored** for the long eye-closure alert because at a laptop people look down all the time, and their eyelids lower when they do. Without this rule the alert would sound whenever you read your keyboard. The decision is taken from the half second before the eyes closed, so that closing the eyes cannot itself switch the alert off.
- **The head drop is forward only** because when a sleepy person's neck muscles relax the head falls forward. Turning or tilting the head sideways is not a sign of sleep.
- **These are not microsleep detectors.** A microsleep is a brief episode of sleep defined by brain activity (EEG). BlinkTwin cannot see brain activity. A 1-second eye closure or a dropping head is a behavioural sign that is often seen when people are very sleepy, but it can also happen when you rub your eyes, laugh or stretch.
- **The thresholds are ad hoc defaults.** They were chosen to be reasonable, not fitted to data, and they have not been tested for how often they miss real episodes or raise false alarms.
- **No alert does not mean you are fit to drive.**

---

## 5. The reaction test (PVT-B)

Code: `web/src/ui/dialogs.ts` (`runPvt`), `web/src/probes/pvt-score.ts`, `web/src/main.ts`.

The **psychomotor vigilance test (PVT)** is the standard test of sustained attention used in sleep research. Sleep loss slows reactions and causes "lapses" of attention. BlinkTwin uses the brief 3-minute version, **PVT-B** (Basner and colleagues, 2011):

- A red millisecond counter appears in a box after a random wait of **1 to 4 seconds** (drawn evenly from that range).
- You respond as fast as you can with the **space bar, a click or a tap**. The counter stops and shows your reaction time for **600 ms**, then the next wait begins.
- The test runs for **3 minutes**. Escape or "Stop" cancels it, and a cancelled test is not stored.
- Pressing "Reaction test" first opens a check-in (Section 6). If you cancel the check-in, no test is run.

Scoring:

| Term | Definition |
|---|---|
| reaction time | time from the counter appearing to your response, in ms |
| **false start** | a response with no counter on screen, or a reaction time under **100 ms** (too fast to be a real reaction) |
| **lapse** | a reaction time over **355 ms** (the PVT-B definition; the 10-minute PVT uses 500 ms) |
| median reaction time | the middle value of your valid reaction times |
| mean response speed | the average of 1000 / reaction time |

All of these are stored, together with the test's length in seconds. **The twin uses only the median reaction time** (Section 7e). The median is used because it is less affected by a few very slow or very fast responses.

**The 1-minute version.** A tick box offers a 1-minute test for convenience. Its result is shown to you, but it is **not used by the model** and not by the objective check (Section 10b): the twin's reaction-time noise was estimated from full-length tests, and a 1-minute test is noisier. Only tests of at least 180 seconds are used (`pvtMinSeconds` in `web/src/twin/twin.ts`; the stored event carries `durationS`).

**Timing in a browser.** A browser cannot time a screen and keyboard as precisely as dedicated laboratory equipment. The screen only redraws about 60 times a second, keyboards and mice have their own delays, and these differ between computers. Published studies of browser timing report lags of tens of milliseconds that vary by device. If the extra delay is the same for every test on your computer, the twin's reaction-time "anchor" (Section 7e) absorbs it once you have done a few check-ins. Results from different computers should not be compared.

---

## 6. Check-ins: the questionnaires

Code: `web/src/ui/dialogs.ts` (`openCheckIn`, `tlxFromItems`), `web/src/main.ts` (`checkIn`).

A check-in has two parts: a sleepiness rating, which is required, and a workload rating, which is optional.

### The Karolinska Sleepiness Scale (KSS)

The **KSS** (Åkerstedt and Gillberg, 1990) is the most widely used rating of momentary sleepiness. The question is *"How sleepy have you felt in the last 5 minutes?"*, and you choose one of nine levels:

| KSS | Wording on screen |
|---|---|
| 1 | Extremely alert |
| 2 | Very alert |
| 3 | Alert |
| 4 | Rather alert |
| 5 | Neither alert nor sleepy |
| 6 | Some signs of sleepiness |
| 7 | Sleepy, but no effort to keep awake |
| 8 | Sleepy, some effort to keep awake |
| 9 | Very sleepy, great effort to keep awake, fighting sleep |

In research, ratings of 7 and above go with more attention lapses, longer blinks and more EEG signs of sleepiness. BlinkTwin therefore calls KSS 7 "sleepy".

### NASA-TLX (workload)

The **NASA Task Load Index** (Hart and Staveland, 1988) measures how demanding a task felt. In BlinkTwin it sits in a closed, optional section of the check-in ("Also rate the workload of what you were just doing"). It refers to the stretch of work you have just finished, not to the reaction test, because the check-in always comes before the test. It asks the six standard questions, each on a slider from 0 to 100 in steps of 5:

| Scale | Question | Ends of the slider |
|---|---|---|
| Mental demand | How mentally demanding was the task? | Very low to Very high |
| Physical demand | How physically demanding was the task? | Very low to Very high |
| Temporal demand | How hurried or rushed was the pace of the task? | Very low to Very high |
| Performance | How successful were you in accomplishing what you were asked to do? | Perfect to Failure |
| Effort | How hard did you have to work to accomplish your level of performance? | Very low to Very high |
| Frustration | How insecure, discouraged, irritated, stressed and annoyed were you? | Very low to Very high |

The **raw TLX** is the plain average of the six numbers (0 to 100). The original method also weights the scales by asking 15 pairwise comparisons; the unweighted "raw" version is widely used and is what BlinkTwin stores.

**Workload is saved only when all six sliders have been moved.** Each slider shows "not rated" until you touch it, including one you would leave in the middle. If you move some but not all, the app asks you to rate the rest or to close the section to skip workload. This prevents the starting position of the sliders (50) from being stored as if it were a real rating.

### Why you rate before the test, and why the estimate is hidden

- **You rate before you test** because the test shows each reaction time on screen; a rating given after seeing slow reaction times would be coloured by them, and the rating would no longer be an independent measure of how you feel.
- The check-in window covers the whole page with a plain background, so **the twin's own estimate is hidden while you rate**. Otherwise you might simply copy the twin's number, and the twin would end up agreeing with itself.

---

## 7. How sleepiness is predicted, step by step

Code: `web/src/twin/tpm.ts` (the body-clock prior) and `web/src/twin/twin.ts` (everything else).

The twin's estimate of your sleepiness at time t is a sum of three parts, limited to the KSS range 1 to 9:

**sleepiness(t) = body-clock prediction(t) + time-on-task effect(t) + your personal offset(t)**

The sections below explain each part, then how measurements change the offset.

### 7a. The body-clock model (the "prior")

A **prior** is what a model expects before it has seen any of your data. BlinkTwin's prior is the **Three-Process Model of alertness**, a published model from Swedish sleep research (Åkerstedt and Folkard, 1997; Åkerstedt, Folkard and Portin, 2004; the sleep "breakpoint" from Åkerstedt and colleagues, 2008; the parameter values and the 12-hour component as listed by Ingre and colleagues, 2014). It was built from sleep-deprivation and shift-work studies. It adds four processes into one "alertness" number, A, on a scale of roughly 1 to 21:

| Process | What it is | How it behaves | Constants (`web/src/twin/tpm.ts`) |
|---|---|---|---|
| **S**, sleep pressure (homeostatic) | alertness that runs down the longer you are awake and is restored by sleep | while awake, S falls exponentially towards 2.4; during sleep it rises towards 14.3 | lower limit 2.4, upper limit 14.3, fall rate 0.0353 per hour awake, recovery rate 0.381 per hour asleep |
| **C**, body clock (circadian) | the 24-hour rhythm | a cosine wave peaking at 16:48 (16.8 h) and lowest 12 hours later, around 04:48 | amplitude 2.5 |
| **U**, 12-hour rhythm (ultradian) | a smaller second rhythm that produces the early-afternoon dip | a 12-hour cosine with its lowest points at 13:48 and 01:48 | amplitude 0.5, average −0.5 (so U ranges from −1.0 to 0) |
| **W**, sleep inertia | grogginess right after waking | starts at −5.72 at the moment of waking and fades exponentially; absent after a night without sleep | decay rate 1.51 per hour (about half gone in 28 minutes) |

**How sleep restores S.** Recovery is not the same at all levels. Below a "breakpoint" of **12.2**, S recovers in a straight line at a fixed speed (0.381 × (14.3 − 12.2) = 0.80 units per hour); above it, recovery slows down as S approaches 14.3. This means a short night restores less than a simple exponential would suggest.

**Sleep debt is carried across days.** S at waking depends on the whole recent history, not just last night. If you enter your sleep each day, the twin follows S through every night you entered. Nights before the first one you entered are assumed to be habitual nights of **7.5 hours**, starting ten days earlier. So a run of short nights builds up sleep debt.

**Conversion to KSS.** Alertness is converted to the sleepiness scale with **KSS = 10.6 − 0.6 × A**, limited to 1 to 9.

**Worked example 1 (computed with `alertness()` in `web/src/twin/tpm.ts`).** A person wakes at 07:00 after 8 hours of sleep, following habitual nights, and stays awake into the next morning:

| Clock time | Hours awake | S | C | U | W | A | Prior KSS |
|---|---|---|---|---|---|---|---|
| 07:00 | 0 | 13.80 | −2.10 | −0.04 | −5.72 | 5.94 | 7.04 |
| 08:00 | 1 | 13.40 | −1.67 | 0.00 | −1.26 | 10.46 | 4.32 |
| 10:00 | 3 | 12.65 | −0.52 | −0.30 | −0.06 | 11.77 | 3.54 |
| 13:48 | 6.8 | 11.36 | 1.77 | −1.00 | 0.00 | 12.13 | 3.32 |
| 16:00 | 9 | 10.69 | 2.45 | −0.70 | 0.00 | 12.44 | 3.14 |
| 20:00 | 13 | 9.60 | 1.67 | 0.00 | 0.00 | 11.27 | 3.84 |
| 23:00 | 16 | 8.88 | −0.13 | −0.55 | 0.00 | 8.20 | 5.68 |
| 03:00 | 20 | 8.03 | −2.23 | −0.90 | 0.00 | 4.89 | 7.66 |
| 06:00 | 23 | 7.46 | −2.38 | −0.21 | 0.00 | 4.88 | 7.67 |

Reading the table: right after waking the prior is high (KSS 7.0) because of sleep inertia; within an hour it falls to 4.3; it is lowest (most alert) in the afternoon, around 16:00; it rises in the evening and passes 7 during the night as sleep pressure and the body-clock low combine.

**Sleep debt, same example.** S at waking is 13.80 after 8 hours, 13.66 after 7.5 hours, 12.16 after 5 hours and 11.16 after 4 hours (each after habitual nights). After **five** consecutive 5-hour nights it is 10.69. At 10:00 on the fifth day, the prior is **KSS 4.42** if only the last night was entered, and **5.21** if all five nights were entered. Entering your sleep every day therefore matters.

**When sleep is not entered** (`fillMissingNights` and `filledSleep()` in `web/src/twin/twin.ts`; the app switches this on). People forget. The app fills gaps in a way that errs towards ordinary nights, and tells you when it has done so:

- **No sleep entered at all:** the twin assumes you woke at **07:00** after **7.5 hours**.
- **Your last entry is more than 30 hours old:** the twin does not assume you have been awake since then. It uses today's default night (woke 07:00 after 7.5 hours), with habitual 7.5-hour nights in between.
- **A gap of more than 30 hours between two entries:** the missing nights are filled with habitual 7.5-hour nights, waking at 07:00.
- **A real night without sleep** must be entered with **"I did not sleep last night"**. It is stored as a night of 0 hours, so no habitual night is filled in, and there is no sleep inertia that morning because you did not wake up.

Example (computed with `replay()`): with a single entry three days old, at 10:00 today the app's prior is **3.61**, using today's default night and two filled nights. Without filling, the model would treat the person as awake for three days and give 9.0. With "I did not sleep last night" after a 7.5-hour night ending at 07:00 the day before, the prior is **7.46** at 07:30 and **7.05** at 10:00 (the body clock's morning rise lowers it a little).

Whenever the estimate rests on a default or filled night, a note under the estimate says so, with a button to enter your sleep, and the model-driven warning is switched off while today's night is assumed (Section 4). The research analyses (DROZY replay and simulation) switch filling off, because their participants genuinely stayed awake all night.

### 7b. Time on task

Long stretches of continuous work make people sleepier. The twin adds **0.4 KSS points per hour** of continuous task (`totPerHour`). The clock for "time on task" starts when you mark an activity (focused work, reading, meeting or other task). During a break it is frozen. If the break lasts **10 minutes** or more, it is reset to zero; after a shorter break it **continues from where it was frozen**, so the break's own minutes are not counted as work. If you never mark what you are doing, time on task is zero.

Example (computed with `replay()`): working from 09:00, the term is +0.40 at 10:00 and +0.80 at 11:00. A 5-minute break from 11:00 keeps it at 0.80; work resumes from there, reaching +1.17 at 12:00. A 15-minute break from 11:00 instead resets it: it is 0 at 11:10 and +0.30 at 12:00 after resuming at 11:15.

The value 0.4 KSS per hour is an assumption of this project, not a published constant, and has not been validated.

### 7c. Your personal offset

People differ: at the same time of day and after the same sleep, one person feels a 3 and another a 5. The **offset** is how far *you* sit above or below the body-clock prediction right now, in KSS points. It starts at 0 with an uncertainty (a standard deviation) of **1.2 KSS points**, and it is allowed to drift slowly over time: its uncertainty grows by 0.3 KSS per square root of an hour (so after 4 hours without new information it has grown by the equivalent of 0.6 KSS). That drift lets the twin follow a day when you feel unusually tired or fresh (`offsetPriorSd`, `offsetDriftSdPerSqrtHour`).

### 7d. How a check-in updates the offset (the Kalman filter)

A **Kalman filter** (Kalman, 1960) is a standard method for tracking a quantity that you cannot see directly from noisy measurements. It keeps two things: a best guess and how uncertain that guess is. Each new measurement moves the guess towards the measurement, by an amount that depends on how much the filter trusts the measurement compared with its current guess.

For a KSS check-in:

1. The twin predicts what you would rate: body-clock prediction + time on task + current offset.
2. The **surprise** is your actual rating minus that prediction.
3. The **gain** is a number between 0 and 1: gain = P / (P + R), where P is the current uncertainty of the offset (as a variance, the square of the standard deviation) and R is the noise of a single rating. BlinkTwin assumes a rating is noisy by ±0.75 KSS points (standard deviation), so R = 0.75² = 0.5625.
4. The offset moves by gain × surprise, and its uncertainty shrinks: new P = P × R / (P + R).

**Worked example 2 (computed with `replay()`).** A person woke at 07:00 after 7.5 hours. At 10:00, before any check-in:

- body-clock prediction 3.61, time on task 0, offset 0, so the estimate is **3.61**;
- the offset's uncertainty has grown from 1.2 to 1.31 over 3 hours (P = 1.2² + 0.3² × 3 = 1.71), so the 90% range is ±2.15.

At 10:00 the person rates **KSS 6**.

- Surprise = 6 − 3.61 = 2.39.
- Gain = 1.71 / (1.71 + 0.56) = **0.75**.
- New offset = 0.75 × 2.39 = **+1.80**. New estimate = 3.61 + 1.80 = **5.41**.
- New uncertainty: standard deviation 0.65, so the 90% range shrinks to **±1.07**.

The offset then carries forward. With no new information, at 13:00 the estimate is 5.25 (body clock 3.45 + 1.80) with ±1.37; at 16:00, 5.00 with ±1.61; at 20:00, 5.69 with ±1.89. The range widens again as time passes without a new check-in. The twin does not simply copy your rating: it trusts it about 75% at this point, because one rating is noisy.

### 7e. How the reaction test and camera are read: forward models and anchors

The passive signals (median reaction time, blink duration, PERCLOS) are **not** converted into a KSS number. Instead, for each signal the twin has a **forward model**: a simple formula that says what value of the signal to expect from a person at a given sleepiness. Each formula was fitted on the DROZY laboratory dataset (Section 11), comparing each person with themselves across three sessions of increasing sleep deprivation:

**expected signal = (population value at KSS 3) + (change per KSS point) × (sleepiness − 3) + your anchor**

| Signal | Population value at KSS 3 | Change per KSS point | Noise of one reading | Spread of people's baselines |
|---|---|---|---|---|
| Median reaction time (one full test) | 339.2 ms | +18.85 ms | 36.4 ms | 48.7 ms |
| Mean blink duration (one minute) | 189.7 ms | +11.1 ms | 24.6 ms | 22.9 ms |
| PERCLOS (one minute) | 3.24 percentage points | +0.62 | 2.4 | 2.38 |

(Values from `DEFAULT_CONFIG` in `web/src/twin/twin.ts`; the fitting is in `analysis/drozy_forward.py` and `results/drozy_forward.json`. A comment in `twin.ts` shows how each constant follows from that file.)

**What an anchor is, and why it exists.** People differ in their baselines. Suppose your reaction times are always about 40 ms slower than average, because of your age, your mouse or your computer. A formula that only knows the average person would read you as about 2 KSS points sleepier than you are, all the time. The **anchor** is a number the twin keeps for each signal that says how far *your* baseline sits from the population's. Each signal has its own anchor, so a camera that reads you wrongly moves the camera's anchor, not your sleepiness estimate.

The anchors are part of the Kalman filter's state, next to the offset. Each anchor starts at 0 with an uncertainty equal to the spread of people's baselines in the table above, and it can drift slowly (reaction time 2 ms, blink duration 15 ms and PERCLOS 0.83 points per square root of an hour), because lighting, posture and devices change. The blink-duration and PERCLOS drift rates come from how much people's baselines wandered between DROZY sessions; the reaction-time drift is an assumption.

**How one reading is shared out.** When a reading differs from what the twin expected, the surprise is split between "you are sleepier or less sleepy than I thought" (the offset) and "this signal reads you differently" (the anchor), in proportion to how uncertain each one currently is. The filter also allows for the reading's own noise and for the fact that people differ in how steeply their signals change with sleepiness. Minute-by-minute camera noise is partly correlated from one minute to the next, so successive minutes are not fully independent pieces of evidence. To allow for this, the noise variance of a PERCLOS minute is counted 1.93 times larger than it would otherwise be (from the measured correlation of 0.32 between successive minutes in DROZY, using the factor (1 + 0.32) / (1 − 0.32)); for blink duration the factor is 1.04.

**Before any check-in**, the twin cannot tell "you are slow because you are sleepy" from "you are a slow person", so most of the surprise goes to the anchor and only a little to the offset. **After a check-in**, your level is pinned by your own rating, so a reading that disagrees is explained mostly by the anchor, and later readings move the estimate mainly when they *change*. In short: **check-ins set your level; passive signals track change between check-ins.**

**Worked example 3 (computed with `replay()`).** Same person, woke 07:00 after 7.5 hours.

- *No check-in.* At 10:00 they do a reaction test with a median of **380 ms**. For the body-clock prediction of 3.61, the average person would be expected at 339.2 + 18.85 × 0.61 = 350.7 ms, so the surprise is about 29 ms. The twin moves the offset by only **+0.22** KSS (estimate 3.83) and puts **16.1 ms** into the reaction-time anchor. It cannot yet tell sleepiness from a slow baseline.
- *Check-in first.* At 10:00 they rate **KSS 3** (offset −0.46), then do the test four minutes later with 380 ms. Now the anchor takes **23.5 ms** and the offset moves by only **+0.08**: the twin concludes that this person is simply a bit slow.
- *Later test.* At 15:00 the estimate is 2.89. A second test of **380 ms** (no change) moves it to **2.98**. A second test of **420 ms** (40 ms slower than before) moves it to **3.17**. One test is noisy (±36 ms is about two KSS points of noise), so a single slow test moves the estimate by a fraction of a point. Several consistent tests move it further.

**The camera's limits.** Because the camera anchors are allowed to drift (lighting and posture change during a day), the camera mainly informs about changes over minutes to a couple of hours. Slow changes over many hours are partly absorbed by the drifting anchor. A minute is used only if a face was found in at least **60%** of frames; blink duration is used only if the minute had at least **3 blinks**; and PERCLOS is skipped when the camera's blinks do not reach full closure (Section 3).

### 7f. Uncertainty and the 90% range

Every estimate on screen comes with a **90% range** (the "±" number and the shaded band). It is 1.645 times the standard deviation of the offset, which is the twin's uncertainty about where you are relative to the body-clock model. If the twin's assumptions held, the true value would fall inside this range 9 times out of 10. The range shrinks after each check-in and widens again over time. It covers the uncertainty of the offset only; it does not include the noise in your own next rating (the "How well does the twin know you?" panel adds that noise when it checks your ratings against the range; Section 10d).

### 7g. "Why the twin thinks so" (attribution)

The panel splits the current estimate into parts: the **daily rhythm model** (body-clock prediction), **time on task**, and how much your **check-ins**, **reaction tests** and **eyes (webcam)** have moved your offset. Because the twin never changes the offset except when a measurement arrives, the parts add up exactly to the estimate (before it is limited to 1 to 9). Each update's change to the offset is credited to the source that caused it. One caution: the split depends on the order of events. For example, a check-in that comes after a slow reaction test partly undoes that test's effect, and is credited with doing so.

The "Your personal model" panel shows what has been learned: how far your offset is from the body-clock model, and each anchor (for example "23 ms slower than the population at the same sleepiness"), with a bar showing how much of the starting uncertainty has been removed.

### 7h. The objective check, in one line

Because the twin is anchored to your own ratings, it estimates how sleepy you **feel**. The "Now" panel therefore also reads your last full reaction test on the population scale, ignoring your ratings: **objective KSS = 3 + (your median reaction time − 339.2 ms) / 18.85 ms**, limited to 1 to 9 (`objectiveKss()` in `web/src/insights/divergence.ts`). For example, a median of 400 ms corresponds to KSS 6.2 for an average person. Section 10b explains how the app compares this with your ratings.

---

## 8. How cognitive load (workload) is calculated

Code: `web/src/twin/twin.ts` (workload part of `replay()`); display in `web/src/main.ts`.

The page shows "Cognitive load" on the NASA-TLX scale of 0 to 100. Strictly, this is **perceived workload**: how demanding your work feels, as you would rate it on the NASA-TLX. It is calculated from two things only: **what you said you are doing**, and **your TLX ratings**. The camera, the reaction test and your sleepiness are **not** used for workload (blink rate was used in an earlier version but this was removed because it was not supported by data).

### Step 1: a typical demand for each activity

Each activity starts with a default typical demand:

| Activity | Default demand (TLX points) |
|---|---|
| Focused work | 65 |
| Meeting | 50 |
| Reading | 40 |
| Other task | 40 |
| Not set | 40 |
| Break | 15 |

These defaults are reasonable guesses, not measured values.

### Step 2: learning your own typical demand

Each TLX rating is filed under the activity you had marked when you rated. Your typical demand for that activity is then a blend of the default and your ratings, in which the default counts as two ratings:

**your demand for an activity = (2 × default + sum of your ratings in that activity) / (2 + number of your ratings in that activity)**

For example, with one rating of 80 during focused work, your focused-work demand becomes (2 × 65 + 80) / 3 = **70**. After many ratings your own average dominates.

### Step 3: between ratings, workload drifts towards that demand

Between ratings, the workload estimate moves smoothly towards the typical demand of your current activity, closing about 63% of the gap every **20 minutes** (a "mean-reverting" process). Its uncertainty settles at a spread of **18 TLX points** around that demand, so with no recent rating the 90% range is about ±30 points.

### Step 4: a TLX rating updates the estimate

A TLX rating is treated as a measurement with a noise of ±8 TLX points. It updates the estimate with the same Kalman rule as a KSS check-in: the gain is (current variance) / (current variance + 8²). A TLX is stored only when all six sliders were rated (Section 6).

**Worked example 4 (computed with `replay()`).** Someone marks "Focused work" at 09:00. The estimate starts at 40 (the "not set" level) and moves towards 65: 49.8 after 10 minutes, 55.8 after 20, 59.4 after 30 and 63.8 after an hour, with a 90% range of ±29.6 throughout. At 10:00 they give a TLX of **80**. The gain is about 0.84, so the estimate jumps to **77.3** with a range of ±12.0. Their focused-work demand is now 70, so the estimate drifts back towards 70 (71.6 at 10:30, 70.4 at 11:00) and its range widens again to about ±29. If they then take a break at 11:00, the estimate falls towards 15 and is 27.4 by 11:30.

The words under the number are: below 30 "Light", 30 to under 55 "Moderate", 55 to under 75 "High", 75 and above "Very high".

**Honest limitation.** The workload part has **not been validated**. The context defaults are guesses, the information from a TLX rating fades within about an hour, and NASA-TLX was designed to rate a whole task after it is done, not a moment.

---

## 9. Forecasts and what-ifs

Code: `forecast()` in `web/src/twin/twin.ts`; buttons in `web/src/main.ts`.

### The forecast

To look ahead, the twin takes the body-clock model forward in time, keeps your current offset, and lets its uncertainty grow at the same drift rate as before (0.3 KSS per square root of an hour). For time on task, the main forecast assumes **your usual rhythm: 50-minute work blocks with 10-minute breaks**. If you are working now, it lets you finish the current 50-minute block, then takes a 10-minute break (which resets time on task), and repeats. If you have not marked any activity, time on task stays at zero. The page forecasts 8 hours ahead, and the chart legend says "forecast (with usual breaks)".

- **Probability of KSS 7 or more** at a future time is computed from the forecast and its uncertainty, assuming a bell-shaped (normal) error. The page shows it for one hour from now.
- **"You will reach KSS 7 around ..."** is the first future time at which the middle of the forecast reaches 7. The same sentence gives the times at which the probability of KSS 7 or more first reaches 1 in 4 and 3 in 4, for example "around 00:00: a 1 in 4 chance by 23:10, 3 in 4 by 01:10". A single clock time would look more exact than it is: in the simulation study the predicted time missed by about 80 minutes on average. In that study (three check-ins, forecast at 17:00) the true time fell before the window for 30% of virtual people, inside it for 56% and after it for 15%, against the 25%, 50% and 25% the chances imply (`results/forecast_window.json`). A time that is already past, or later than the 8-hour horizon, is left out.

**Worked example 2, continued.** After the rating of 6 at 10:00 (no activity marked, so no time on task), the forecast made at 16:00 is:

| Time | Forecast KSS | Uncertainty (SD) | Probability of KSS ≥ 7 |
|---|---|---|---|
| 16:00 | 5.00 | 0.98 | 0.02 |
| 18:00 | 5.07 | 1.07 | 0.04 |
| 20:00 | 5.69 | 1.15 | 0.13 |
| 22:00 | 6.85 | 1.23 | 0.45 |
| 00:00 | 8.19 | 1.30 | 0.82 |

The predicted time of reaching KSS 7 is **22:20**. Without the check-in (offset 0), the same forecast would have said 01:10: the check-in told the twin that this person is sleepier than average today.

### What-if scenarios

The what-if buttons re-run the forecast with one assumption changed and draw it as an extra line, next to the main forecast with your usual breaks:

| Button | What changes | What it assumes |
|---|---|---|
| I take a 15-minute break | a 15-minute break now (which resets time on task), then the usual 50/10 rhythm | that you return to your usual rhythm afterwards |
| I go to bed at 23:00 (or in 30 minutes if 23:00 has passed) | a sleep of 7.5 hours is added; after waking, the body-clock model restarts from that sleep (with sleep debt carried over) and time on task is zero; before bedtime, the usual rhythm | your offset of today carries into tomorrow, with growing uncertainty |
| I keep working without breaks | time on task keeps growing at 0.4 KSS per hour for the whole 8 hours | continuous work with no break at all |

**Worked example 5 (computed with `replay()` and `forecast()`).** The same person has been doing focused work since 15:00. At 16:00 the estimate is 5.40 (body clock 3.20 + time on task 0.40 + offset 1.80). The predicted time of reaching KSS 7 is:

- **21:50** with the usual breaks (the main forecast);
- **22:00** with a 15-minute break now and then the usual breaks;
- **19:10** if they keep working without breaks;
- with bed at 23:00 for 7.5 hours, 21:50 (they reach KSS 7 before bedtime), and the next morning the forecast is KSS 7.20 at 07:00 (sleep inertia), 5.89 at 08:00 and 5.48 at 10:00.

---

## 10. The helper panels

Four panels help you use the twin well. All their thresholds are ad hoc defaults chosen to be sensible; none has been validated.

### 10a. Check-in suggestions ("Why does it ask me to check in now?")

Code: `web/src/insights/suggest.ts`.

Check-ins carry most of the information about how sleepy you feel, but each one costs a moment of attention. So the app suggests a check-in only when a rating is worth the most. It considers five reasons, in this order of importance, and shows only the most important one that applies:

| Priority | Reason | Rule |
|---|---|---|
| 1 | First of the day | no rating since you woke, and at least 30 minutes since waking (during the first half hour a rating would mostly measure sleep inertia) |
| 2 | Twin is unsure | the offset's uncertainty (standard deviation) is above 0.9 KSS, that is, the 90% range is wider than about ±1.5 |
| 3 | Sleepy soon | the forecast reaches KSS 7 within 2 hours and you are not there yet |
| 4 | Signals disagree | your last full reaction test (within the last 3 hours) is at least 1.5 KSS points away from what the twin expected for **you**, given your own reaction-time anchor, in either direction |
| 5 | Long gap | you are working and have not rated for more than 3 hours |

Two limits stop it from nagging: it never suggests more often than once every **45 minutes**, and never within **30 minutes** after a check-in. A suggestion stays on screen until you check in or press "Not now"; "Not now" counts as a suggestion for the 45-minute limit.

### 10b. The objective check and "reactions slower than your ratings"

Code: `web/src/insights/divergence.ts`.

The main estimate follows your ratings. That is right for how sleepy you feel, but it can hide the warning sign that matters most for safety: people who have slept too little for several days often keep rating themselves as only moderately sleepy while their reaction times keep getting worse (Van Dongen and colleagues, 2003). In the twin, that pattern shows up as a **growing reaction-time anchor**: your ratings stay flat while your reactions slow, so the twin keeps explaining the slowing as "this is just how this person responds". The objective check brings this into the open.

It shows two things:

1. **Your last full test on the population scale** (Section 7h), and the gap between it and the twin's estimate just before that test, drawn as a bar (limited to ±3 points for display). This answers "today, do my reactions match my rating?". A person who is always a slow responder will read high here every time, so on its own this is weak evidence.
2. **The trend of your reaction-time anchor**, converted into KSS points (anchor in ms / 18.85 ms), over the last 7 days, or over the last 24 hours if there is no anchor from 7 days ago yet. This answers "are my reactions drifting away from my ratings?", and it removes your constant level.

The verdict:

| Verdict | Rule | What it says |
|---|---|---|
| Not enough data | fewer than 2 full 3-minute tests, or no check-in yet | how many tests and check-ins are still needed |
| **Reactions slower than your ratings** | your reaction-time anchor has grown by **1.0 KSS point or more** over the last 24 hours or 7 days, so your own reactions have slowed while your ratings have not | that your reactions have slowed more than your ratings suggest, that this pattern is common after several short nights, and that the check is experimental; the panel turns red |
| Reactions quicker than your ratings | your anchor has shrunk by 1.0 KSS point or more over the window | that your reactions have become quicker than your ratings suggest |
| Agree | none of the above | that your reaction times agree with your ratings within the usual noise |

Only full 3-minute tests are used.

### 10c. Sleep status

Code: `web/src/insights/sleep.ts`; the "I did not sleep last night" box and one-tap buttons in `web/src/main.ts` and `web/index.html`.

Because the body-clock model carries sleep debt across days, the app checks your last **7 nights** (seven 24-hour windows ending now) and says, in one short message under the sleep form:

- if no sleep has been entered at all, that the estimate assumes waking at 07:00 after 7.5 hours;
- if your last entry is more than 30 hours old, that today's night is assumed, and how to fix it (enter last night, or tick "I did not sleep last night");
- how many of the last 7 nights have no entry and were filled with habitual 7.5-hour nights;
- if the night the twin is using ended more than 24 hours ago, that it assumes you have been awake since then unless you enter a newer night;
- how much your recorded sleep changes today's estimate compared with habitual 7.5-hour nights (shown when the effect is at least 0.3 KSS points), and how much of that comes from nights before last night.

For up to three missing nights it offers one-tap buttons such as "Last night: about 7.5 h", so a forgotten entry takes one click. The message is highlighted when something is assumed.

### 10d. "How well does the twin know you?"

Code: `web/src/insights/trackrecord.ts`.

This panel answers the most important question for any user: is the twin any good **for me**? For each of your check-ins (the most recent 30), the app replays the twin on everything that happened **before** that check-in, so the rating has not been seen, and compares its prediction with your rating. It does the same for the body-clock model alone, with the same sleep history but nothing personal. It then reports:

- the average error of the twin and of the body-clock model alone, in KSS points (lower is better);
- how many of your ratings fell inside the twin's 90% range for a **rating**. Because a rating is a noisy whole number, this range adds the rating noise to the twin's uncertainty and half a scale step for rounding: ±(1.645 × √(offset SD² + 0.75²) + 0.5);
- a chart of each prediction against your rating.

The verdict waits for at least **5 check-ins**, because with fewer any difference is mostly chance. After that it says that learning from your check-ins has helped if the twin's average error is more than **0.1** points lower than the body-clock model's, that the body-clock model alone has done better if it is more than 0.1 points higher, and that they are about equal otherwise. With 10 or more check-ins and fewer than 75% of ratings inside the range, it adds that the ranges have been too narrow for you. Below 20 check-ins it reminds you that the sample is small. The panel is computed only when you open it.

---

## 11. Where the numbers come from, and how the twin was tested

### Published models and scales

- The body-clock prior and all its constants: the Three-Process Model (Åkerstedt and Folkard, 1997; Åkerstedt, Folkard and Portin, 2004; Åkerstedt and colleagues, 2008, for the breakpoint; Ingre and colleagues, 2014, for the parameter list and the 12-hour component). The constants were checked one by one against these sources during the first internal review (`paper/reviews/round1-reviewer-B.md`).
- KSS (Åkerstedt and Gillberg, 1990), NASA-TLX (Hart and Staveland, 1988), PVT-B (Basner, Mollicone and Dinges, 2011), PERCLOS (Wierwille and colleagues, 1994, and Dinges and colleagues, 1998).
- Choices made for this project without a published source: time on task (0.4 KSS per hour, reset after a 10-minute break), the offset's starting uncertainty (1.2) and drift (0.3 per square root of an hour), the noise of a KSS rating (0.75), the reaction-time anchor drift, the 30-hour rule for missing nights, the workload defaults, the 50/10 work rhythm of the forecast, and all alert, suggestion and verdict thresholds.

### DROZY: the source of the forward models

**DROZY** (Massoz and colleagues, 2016) is a public laboratory dataset from the University of Liège: 14 adults each did three 10-minute PVTs over a period of increasing sleep deprivation (roughly 10:00 on day one, around 03:40 the next night and around 12:00 the next day, without sleep), rated their KSS each time, and were filmed with a near-infrared camera while electrodes recorded their eye movements (the **electro-oculogram, EOG**, the reference standard for blinks). Thirty-six tests are usable.

- **Forward models** (`analysis/drozy_forward.py`, `results/drozy_forward.json`): for each signal, the change per KSS point was estimated *within* each person (comparing each person with themselves), and the spread of people's baselines and the noise were estimated separately. The values are in the table in Section 7e.
- **Blink counting** (`results/drozy_summary.json`): the website's blink-counting logic, run on DROZY's face landmarks, agreed with EOG blink rates across the 36 tests (Spearman correlation 0.88), counting about 5.4 fewer blinks per minute on average.
- **The website's actual camera pipeline** (`results/drozy_mediapipe_summary.json`): MediaPipe was run on DROZY's videos with the website's unchanged blink meter. A face was found in 99.9% of frames. Blink rate agreed less well with EOG (Spearman 0.71; about 13 fewer blinks per minute), because on these near-infrared videos MediaPipe's closure score rarely reached high values. For the same reason PERCLOS stayed below 0.5% in all 36 tests and did not track sleepiness. Blink duration did track sleepiness within each person (correlation 0.58), and so did the number of long closures (0.51). This finding led to the PERCLOS check described in Section 3.
- **Replaying the released twin on real people** (`web/scripts/drozy_twin.ts`, `results/drozy_twin_summary.json`): each person was left out in turn, the forward models were refitted on the other 13, and the twin predicted each later KSS rating before seeing it. Mean absolute error (MAE, the average size of the error in KSS points), assuming waking at 07:00:

| What the twin was given | MAE (KSS points) | 95% range | Predictions |
|---|---|---|---|
| Body-clock model only | 1.73 | 1.17 to 2.36 | 24 |
| Reaction tests and webcam, no check-in | 1.47 | 1.09 to 1.91 | 24 |
| One check-in (test 1) only | 1.51 | 0.97 to 2.26 | 20 |
| **One check-in + reaction test + webcam (BlinkTwin)** | **1.38** | 0.93 to 2.04 | 20 |
| For comparison: the other people's average KSS for that test | 1.39 | 0.97 to 1.87 | 24 |
| For comparison: repeating the first rating | 3.45 | 2.82 to 4.05 | 20 |

The full twin had the lowest error of the model-based versions, and the result hardly changed when waking at 06:00 or 08:00 was assumed. But with only 14 people the ranges overlap widely, and a simple rule that knows the average rating of other people at each test did about as well. These numbers support "the twin works sensibly on real data", not "the twin is clearly better". The webcam features in this replay came from DROZY's face landmarks, not from MediaPipe.

### OpenNeuro ds004902: does a personal offset carry over?

**OpenNeuro ds004902** (Xiang and colleagues, 2024) contains 71 adults tested once after normal sleep and once after a night without sleep. For the 33 people with KSS in both sessions, we asked whether a person's offset from the body-clock model after normal sleep predicts their offset after sleep deprivation (`web/scripts/openneuro_anchor.ts`, `results/openneuro_anchor_summary.json`). The correlation was weak (0.29; 95% range −0.05 to 0.58). Carrying a person's normal-sleep offset over in full made predictions slightly worse (MAE 1.63) than the body-clock model alone (1.53); carrying over a shrunk offset, as the twin's update does, gave 1.52. In plain words: how much sleepier than the model someone was in one session said little about their offset in the other session, under very different conditions. (The sleep times were not recorded in this dataset, so normal sleep of 7.5 hours ending at 07:00, and waking at 07:00 the day before the sleep-deprivation session, were assumed.) This is one reason the offset is allowed to drift and check-ins are needed every day.

### Simulation

A simulation with virtual people, whose true sleepiness is known, tests what each source of information adds and how the twin behaves when its assumptions are wrong (`web/scripts/simulate.ts`, `web/src/sim/synth.ts`, `results/sim_summary.json`). Each scenario has **300** virtual people who wake at 07:00 and stay awake for 24 hours (16 hours in the "ordinary workday" scenario), working in 50-minute blocks with 10-minute breaks, with a webcam summary every minute, a reaction test every 2 hours and after each check-in, and k check-ins spread over the day. The twin uses its released settings; nothing was tuned on the virtual people. The error is the MAE between the twin's estimate and the true sleepiness, every 10 minutes.

Six versions are compared. "Rhythm model only" is the body-clock model with time on task. "Check-ins only" adds your ratings. "BlinkTwin" adds reaction tests and the webcam with anchors. "No anchors" adds them without anchors (the population formula taken as exact for everyone). "Consider-covariance" uses the reaction tests and webcam while allowing for each person's bias without estimating it, the fair test of whether learning the anchors matters. "Known-parameter filter" is a version that is told each virtual person's true signal parameters, which shows the most the passive signals could add.

MAE in the scenario that matches the twin's assumptions (95% ranges from resampling people):

| Version | 0 check-ins | 1 check-in | 3 check-ins | 8 check-ins |
|---|---|---|---|---|
| Rhythm model only | 0.819 (0.770 to 0.869) | | | |
| Check-ins only | | 0.744 | 0.659 | 0.571 |
| **BlinkTwin** | 0.861 (passive signals only) | **0.731** | **0.629** (0.608 to 0.650) | **0.557** |
| No anchors | | 1.782 | 1.741 | 1.655 |
| Consider-covariance (bias allowed for, not estimated) | 1.032 | 0.791 | 0.673 | 0.579 |
| Known-parameter filter | 0.724 | 0.639 | 0.586 | 0.536 |

What this shows, in plain words:

- **Check-ins carry most of the information.** Three check-ins cut the error from 0.819 to 0.659.
- **Passive signals help a little, but only with anchors.** With anchors, BlinkTwin's error at three check-ins was 0.030 KSS points lower than check-ins alone (95% range 0.016 to 0.042 lower). Without anchors, adding the same signals made the error more than twice as large, because the population formula misreads many individuals.
- **Passive signals alone did not beat the body-clock model** (0.861 against 0.819; the difference is within chance).
- **Coverage.** At three check-ins, 90% ranges contained the truth 90.1% of the time for BlinkTwin and 90.6% for check-ins only.

When the virtual world breaks the twin's assumptions on purpose, the gain of BlinkTwin over check-ins alone at three check-ins stayed small but in the same direction: lower error by 0.013 points when the webcam noise is far more correlated than assumed (95% range from 0.027 lower to 0.001 higher, so not clearly different), and by 0.021 to 0.055 points in the other scenarios (body clock off and sleep misreported; non-linear signals with heavy-tailed noise; people who rate themselves with a personal bias; person-specific body-clock parameters; unrecorded sleep debt; an ordinary 16-hour day; ratings that level off at high sleepiness). The forecast results of the simulation are being re-run and are not quoted here.

### Unit tests and checks

The code has automated tests (`web/tests/`, run with `cd web && npm test`) that check, among other things, the Three-Process Model's structure (the breakpoint, sleep debt, the 13:48 dip), the Kalman updates, the blink meter (including long closures), the look-down rule, the alert rules (including a lost face), the missing-night rules, the helper panels, and that the in-app science text matches the result files. Two automated browser checks measure network traffic and speed (Sections 12 and 13).

---

## 12. Privacy and data

Code: `web/src/store.ts`, `web/src/main.ts`, `web/src/sensing/camera.ts`, `web/index.html`; check in `web/scripts/privacy_check.mjs` and `results/privacy_check.json`.

- **Where data live.** Every event (sleep entries, activity changes, check-ins, TLX ratings, reaction-test summaries, one-minute camera summaries and alerts) is saved in your browser's local storage on your own computer, under the key `blinktwin.events.v1`. The time of the last check-in suggestion is kept under `blinktwin.lastSuggestedAt`. There is no server that receives your data and no account.
- **Video.** Frames are processed in memory and discarded. You can hide the video preview and keep tracking.
- **What the page may connect to.** A Content-Security-Policy in `web/index.html` tells the browser that the page may only connect to the site itself and to Google's model storage (`storage.googleapis.com`), from which the face model file is downloaded on first use if the site does not serve it. Any other connection is blocked by the browser.
- **The traffic check.** An automated check (`web/scripts/privacy_check.mjs`) loads the built app in a browser, turns the camera on, does a check-in and a reaction test, and records every network request and what is stored. It found that the MediaPipe library had been sending small usage-statistics requests (timing data, no images) to a Google logging address (`odml.pa.googleapis.com`) about every 60 seconds. The policy now blocks these: in the latest check (`results/privacy_check.json`) the page made **zero** network requests after loading, the blocked attempt is listed as blocked rather than sent, and the stored data contained only the expected numbers.
- **Export.** "Export CSV" and "Export JSON" download all your events as a file.
- **Delete.** "Delete my data" (click twice to confirm) erases all stored events.
- **Demo mode.** "Demo day" loads one simulated person's day (woke at 07:00 after 6.5 hours, four check-ins at 09:30, 12:30, 15:30 and 19:00, each followed by a reaction test, alternating 50-minute work blocks and 10-minute breaks, and one webcam summary per minute; `web/src/demo.ts`, `web/src/sim/synth.ts`). Demo data are kept under a separate key and never mixed with your own; a banner shows when demo mode is on.

---

## 13. How fast it runs

Measured by `web/scripts/benchmark.mjs` (`results/benchmark.json`) on a **4-core cloud server** with no graphics processor and a headless browser with a test camera. **A cloud server is not a typical laptop**: a laptop with a graphics processor should run the face model faster, so these numbers are a cautious reference, not a laptop result.

- **Camera:** about **20 frames per second** (the app's cap is 24), with about **26 ms** per face-model call on the CPU (95% of calls within 47 ms).
- **Graphics fallback:** on this server the browser draws graphics in software. Forcing the face model's graphics mode there gave only 9.2 frames per second and about 106 ms per call, which is why the app uses the CPU when graphics are software-rendered (Section 3).
- **The twin:** a 10-day event log (9,760 events, including 9,310 webcam minutes and 40 check-ins) replays in about **84 ms**. A full dashboard refresh on that log takes about 147 ms, the once-a-minute helper panels about 0.3 s, and the "How well does the twin know you?" panel about 1.3 s, which is why it is computed only when opened.

---

## 14. Limits and open questions

- **Not tested on real users in daily life.** The evidence is a small laboratory dataset (14 people), one dataset with two sessions per person, and simulation. A prospective study is planned.
- **Subjective, not objective.** The main estimate follows your own ratings. If your ratings understate your impairment, so will the estimate; the objective check (Section 10b) is a partial guard.
- **Camera differences.** The forward models were fitted on near-infrared laboratory video. Ordinary webcams, lighting, glasses, camera angle and screen glare all change the eye measures. Anchors absorb constant differences but not every effect. On the DROZY videos, PERCLOS from MediaPipe did not work at all.
- **Body clock is fixed to local clock time.** After travel across time zones, during shift work, or for strong morning or evening types, the body-clock model will be wrong in a way that changes through the day, which a single offset cannot fully correct. Naps and caffeine are not modelled.
- **Assumed nights.** Missing nights are filled with habitual 7.5-hour nights. If you actually slept much less, the estimate will be too low until you enter it.
- **Workload** is unvalidated and only reflects your activity and TLX ratings. A TLX rating is used both to update the estimate and to shape the typical demand it drifts back to, so it counts twice.
- **The forecast's work rhythm** (50 minutes on, 10 off) is an assumption; your real breaks will differ.
- **Uncertainty.** The 90% range on the main estimate covers the offset only, not the noise of your next rating.
- **Alerts** are unvalidated defaults. The direction of "head down" (`PITCH_DOWN_SIGN` in `web/src/sensing/head.ts`) still needs to be checked on a real device: nodding down should make the displayed pitch positive.

---

## 15. Questions people ask

**How does it know I am sleepy if I never fill in a check-in?**
It starts from the body-clock model, which uses your sleep and the time of day, plus time on task. Reaction tests and the camera then move the estimate a little, but without a check-in the twin cannot tell whether a slow reaction time means you are sleepy or just a slow person, so it moves cautiously and shows a wide range (about ±2 KSS points).

**Why do you trust my rating over the camera?**
Because the twin's job is to estimate how sleepy you feel, and your rating is the most direct measure of that. Cameras and reaction times read different people differently (glasses, lighting, eye shape, age, computer), so each passive signal gets its own anchor. A signal that reads you wrongly moves its anchor, not your estimate. The twin does not copy your rating, though: one rating is treated as noisy (±0.75 points), so it moves the estimate about three quarters of the way.

**What happens if I lie on the check-in?**
The twin will believe you, up to the noise it allows. It will learn anchors that make your reaction times and blinks consistent with what you said. The objective check does not use your ratings, and if your reactions keep drifting away from your ratings it says so (Section 10b).

**How accurate is it?**
On the DROZY laboratory data, the full twin with one check-in predicted later KSS ratings with an average error of 1.38 points (the body-clock model alone: 1.73), but with only 14 people the difference is uncertain, and knowing the average rating of other people at each test did about as well. In simulation, with three check-ins a day the average error was 0.63 points against 0.82 for the body-clock model alone. In daily life it has not been tested yet; the "How well does the twin know you?" panel tells you how it is doing for you.

**How do I know if the twin is any good for me?**
Open "How well does the twin know you?". After at least 5 check-ins it shows how far its predictions, made just before each of your ratings, were from your ratings, compared with the body-clock model alone, and how many of your ratings fell inside its range. If the twin's error is clearly lower, learning from you has helped; if the body-clock model alone does better, the panel says so (Section 10d).

**How is cognitive load calculated?**
From your activity and your NASA-TLX ratings only. Each activity has a typical demand (focused work 65, meeting 50, reading 40, other 40, break 15) that moves towards your own ratings in that activity. Between ratings the estimate drifts towards the typical demand of what you are doing, with a 20-minute time constant. A TLX rating pulls it strongly towards the rating. The camera is not used. See Section 8.

**Why does it ask me to check in now?**
Because a rating is worth the most right now, for one of five reasons: it is your first of the day; the twin has become unsure about you; you are forecast to reach KSS 7 within two hours; your last reaction test differs from what the twin expected for you by 1.5 points or more; or you have worked for more than 3 hours without rating. It never asks more than once every 45 minutes or within 30 minutes of a check-in, and "Not now" dismisses it (Section 10a).

**What does "reactions slower than your ratings" mean?**
Your reaction times have slowed more than your ratings suggest: your reaction-time anchor has grown by at least one KSS point over the last week (or day), meaning your reactions have been slowing while your ratings stayed the same. A single test is never judged on its own, because people's usual reaction times differ by about 2.6 KSS points and devices add their own delay. This pattern is common after several short nights, when people under-rate their impairment (Van Dongen et al., 2003). The check is experimental and has not been validated, so treat it as a prompt to think about your sleep, not as a measurement.

**Why not machine learning?**
There are very few labelled examples for any one person (a handful of ratings a day), and the largest suitable public dataset has 14 people. A model with many parameters could not be trained or checked reliably. The Kalman filter is a form of learning that works with very little data, says how uncertain it is, can be explained number by number, and runs instantly in a browser. Its structure comes from published sleep science.

**What is a "digital twin" here?**
A small personal model kept in step with your data: a published body-clock model plus your personal offset and three anchors, updated with every measurement, that can be asked about now, the future and "what if" choices. It is a modest twin: most of its behaviour comes from population-level science, and only four numbers are personal.

**What if I forget to enter my sleep?**
The app assumes ordinary nights and tells you. With nothing entered it assumes waking at 07:00 after 7.5 hours. If your last entry is more than 30 hours old it uses today's default night rather than assuming you stayed awake, and it fills missing nights between entries with 7.5-hour nights. A note under the estimate and the sleep status message say when this happens, with one-tap buttons to add the missing nights, and the twin's own KSS warning is switched off while today's night is assumed. If you really did not sleep, tick "I did not sleep last night" (Sections 7a and 10c).

**What happens if I enter the wrong sleep time?**
The body-clock prediction will be shifted. Your check-ins correct the level through the offset, but an error in timing changes the shape of the day's curve, which a single offset cannot fully fix. Entering every night also matters for sleep debt: after five 5-hour nights the morning prediction is about 0.8 KSS points higher when all nights are entered than when only the last one is (Section 7a).

**Does anything get sent to Google or anyone else?**
No personal data. The page's security policy allows connections only to the site itself and to Google's model storage, from which the face model file is downloaded on first use if the site does not provide it. The MediaPipe library itself tried to send small usage statistics (timing data, no images) to a Google logging address about once a minute; the policy blocks this, and an automated traffic check found zero requests after loading (Section 12).

**Can my employer see my data?**
No. There is no server and no account. Data stay in your browser unless you export them yourself. Webcam monitoring at work raises real surveillance concerns, and BlinkTwin is designed for self-monitoring only.

**Does it work with glasses, or in the dark?**
It needs to see your face. In the dark, or if the face is not found in at least 60% of a minute's frames, that minute is not used. Glasses can cause reflections that change the eye-closure score; the anchors absorb constant differences, but this has not been tested. If your camera's closure score does not reach full closure during blinks, PERCLOS is switched off automatically.

**Can it detect microsleeps?**
No. Microsleeps are defined by brain activity, which a camera cannot see. BlinkTwin detects long eye closures (1 second or more), forward head drops, and the face disappearing while the eyes were closed, which are behavioural signs that often accompany severe sleepiness.

**Why does it say I am sleepy right after I wake up?**
Sleep inertia. The body-clock model includes the grogginess just after waking; at the moment of waking it adds enough to put the prediction around KSS 7, and this fades within an hour or two. After a night without sleep there is no such effect, because you did not wake up.

**Why did my slow reaction test barely change the estimate?**
One 3-minute test is noisy: its median varies by about ±36 ms from test to test, which is about two KSS points. After a check-in, the twin also attributes a constant difference to your personal anchor. A single slow test therefore moves the estimate by a fraction of a point; several consistent tests move it more (Section 7e). The 1-minute test is not used at all.

**Why is the workload range so wide?**
Without a recent TLX rating, the twin only knows your activity, and people's workload within an activity varies a lot. The range is about ±30 TLX points until you rate, about ±12 just after a rating, and it widens again within the hour.

**Why is my TLX not saved?**
Workload is saved only when all six sliders have been moved, so that an untouched slider (which starts at 50) is never stored as a rating. Move every slider, or close the workload section to skip it.

**Does it account for caffeine, naps, alcohol or medication?**
No. These change sleepiness but are not modelled. Check-ins will partly correct for them through the offset.

**Does it work for night shifts or jet lag?**
Poorly. The body-clock part assumes your rhythm follows local clock time.

**What does "KSS 7" mean, and why that threshold?**
KSS 7 is "Sleepy, but no effort to keep awake". In studies, ratings of 7 and above go with more attention lapses, longer blinks and EEG signs of sleepiness, so it is a common threshold for "sleepy".

**What does the 90% range mean?**
If the twin's assumptions are right, the true value lies inside the range 9 times out of 10. It reflects the twin's uncertainty about your personal offset, which shrinks after a check-in and grows with time.

**Why does the forecast assume breaks?**
Because most people take breaks, and continuous work adds 0.4 KSS per hour in the model. The main forecast assumes 50-minute work blocks with 10-minute breaks; the "I keep working without breaks" button shows what happens without them.

**Why rate before the reaction test?**
So that seeing your reaction times does not influence your rating. The twin's own estimate is also hidden while you rate.

**What do the camera numbers on screen mean?**
Blinks per minute, average blink duration in ms, PERCLOS (share of the last minute with eyes at least 80% closed, or "n/a" if your camera cannot measure it), long closures (over 1 second), nods per minute and the share of frames in which your face was seen.

**Is it fast enough for an ordinary laptop?**
On a 4-core cloud server without a graphics processor, which is slower for this than a typical laptop, the camera ran at about 20 frames per second and a 10-day history was recalculated in about 84 ms (Section 13).

**Is any of this validated?**
Partly. The blink-counting logic agreed with eye-movement recordings in DROZY; the twin was replayed on DROZY and on OpenNeuro data; and a simulation tested it under its own and broken assumptions. The alerts, the workload model, the helper panels' thresholds and use in daily life have not been validated.

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **Anchor** | A number the twin keeps for each passive signal (reaction time, blink duration, PERCLOS) saying how far your baseline is from the population's, so that a signal that reads you differently does not distort your estimate. |
| **Attribution** | The split of the current estimate into body clock, time on task and what each source (check-ins, reaction tests, webcam) has contributed. |
| **Blendshape** | A number from 0 to 1 produced by the face model for one facial movement, such as how closed an eye is or how far it looks down. |
| **Blink duration** | How long one blink lasts, from closing past the 0.5 level to reopening past the 0.3 level, in ms. Longer blinks are a sign of sleepiness. |
| **Brier score** | A score for probability forecasts: the average squared difference between the forecast probability and what happened (1 or 0). Lower is better; 0 is perfect. |
| **Check-in** | A KSS rating, optionally with a NASA-TLX rating, entered by you. |
| **Content-Security-Policy** | A rule in a web page that tells the browser which addresses the page may connect to; anything else is blocked. |
| **Coverage** | The share of frames in a minute in which a face was found. In the simulation, also the share of times the truth fell inside the 90% range. |
| **DROZY** | A public laboratory dataset of 14 adults under increasing sleep deprivation, with video, eye-movement recordings, reaction tests and KSS ratings. |
| **EOG (electro-oculogram)** | A recording of eye movements and blinks with electrodes near the eyes; the reference standard for blinks. |
| **Forward model** | A formula giving the expected value of a signal for a person at a given sleepiness, plus their anchor. |
| **Kalman filter** | A standard method for tracking a hidden quantity from noisy measurements. It keeps a best guess and its uncertainty, and moves the guess towards each measurement by an amount that depends on how much it trusts the measurement. |
| **KSS (Karolinska Sleepiness Scale)** | A 9-point rating of how sleepy you have felt in the last 5 minutes, from 1 (extremely alert) to 9 (fighting sleep). |
| **Lapse** | A reaction time longer than 355 ms in the 3-minute PVT-B: a brief failure of attention. |
| **Long closure** | An eye closure longer than 1 second. |
| **MAE (mean absolute error)** | The average size of prediction errors, ignoring their sign. An MAE of 1.4 KSS means predictions were off by 1.4 points on average. |
| **MediaPipe Face Landmarker** | A face-tracking model from Google that runs in the browser and gives face points, blendshapes and head angles for each frame. |
| **NASA-TLX** | NASA Task Load Index: six 0 to 100 ratings of how demanding a task was. The raw TLX is their average. |
| **Normalised closure** | The eye-closure score rescaled between your own open-eye level (0) and fully closed (1). |
| **Objective check** | Your last full reaction test read on the population scale, ignoring your ratings. It is shown as context; a possible gap with your ratings is flagged only from change in your own reaction times over a day or a week. Experimental. |
| **Offset** | How far your sleepiness sits above or below the body-clock model's prediction, in KSS points. |
| **Known-parameter filter** | In the simulation, a version of the twin told each virtual person's true signal parameters but using the twin's own noise model; a reference, not a strict upper bound. |
| **Consider-covariance filter** | A comparison filter that allows for each signal's personal bias in its uncertainty but never estimates it; it was no better than check-ins alone. |
| **Study mode** | A setting for research use (`?study=1`) that hides every estimate, forecast and suggestion while still recording, so that what people see cannot change their ratings. |
| **Peak closure** | The highest normalised closure a blink reaches; its median over a minute's blinks is used to check whether PERCLOS can be measured. |
| **PERCLOS** | Percentage of eye closure: the share of time the eyes are at least 80% closed. |
| **Prior** | What the model expects before seeing your data; here, the body-clock model's prediction. |
| **PVT / PVT-B** | Psychomotor vigilance test: a reaction-time test of sustained attention. PVT-B is the 3-minute version. |
| **Sleep debt** | The build-up of sleep pressure over several short nights, carried from day to day by the body-clock model. |
| **Sleep inertia** | Grogginess just after waking. |
| **Three-Process Model** | A published model of alertness made of sleep pressure (S), the body clock (C), a 12-hour rhythm (U) and sleep inertia (W). |
| **Time on task** | Hours of continuous work since the last break of 10 minutes or more (short breaks pause it). |
| **Twin** | BlinkTwin's personal model: the body-clock prior plus your offset and three anchors, updated from your data. |
| **Uncertainty / 90% range** | How unsure the twin is. The 90% range is the interval that should contain the true value 9 times out of 10 if the model's assumptions hold. |
| **Workload** | How demanding your current work feels, on the NASA-TLX scale of 0 to 100. Shown as "Cognitive load" in the app. |

---

## Appendix: how the worked examples were computed

The numbers in the worked examples were produced by calling the twin's own functions (`alertness`, `sAtWake`, `sAtLastWake` from `web/src/twin/tpm.ts`; `replay` and `forecast` from `web/src/twin/twin.ts`) with the app's settings (`DEFAULT_CONFIG` with `fillMissingNights: true`) and a fixed time zone (UTC). A minimal version, runnable from `web/` with Node 22.6 or later:

```ts
import { alertness } from './src/twin/tpm.ts';
import { DEFAULT_CONFIG, replay, forecast, type TwinEvent } from './src/twin/twin.ts';

const H = 3_600_000;
const day = Date.UTC(2026, 0, 6);
const at = (h: number) => day + h * H;
const cfg = { ...DEFAULT_CONFIG, tzOffsetMinutes: 0, fillMissingNights: true };
const usualBreaks = { breaksEveryMinutes: 50, breakMinutes: 10 };

// Example 1: the body-clock prior at 16:00 after waking at 07:00 from 8 h of sleep
console.log(alertness(at(16), { wake: at(7), hours: 8 }, cfg.tpm, 0).kss); // 3.14

// Example 2: a KSS 6 check-in at 10:00, then the estimate and the forecast at 16:00
const events: TwinEvent[] = [
  { t: at(7), type: 'sleep', wake: at(7), hours: 7.5 },
  { t: at(10), type: 'kss', value: 6 },
];
const now = replay(events, cfg, { until: at(16), from: at(7) });
console.log(now.now.kss, forecast(now, cfg, { hours: 12, scenario: usualBreaks }).sleepyAt); // 5.00, 22:20
```
