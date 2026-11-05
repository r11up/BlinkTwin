# Round 1 review: Reviewer B

**Manuscript:** "BlinkTwin: a browser-based personal digital twin of sleepiness and cognitive load, calibrated with validated questionnaires" (working draft, 21 pages)

**Reviewer expertise:** sleep science, fatigue risk management, human factors (driver drowsiness, PVT, KSS, PERCLOS, biomathematical fatigue models)

---

## Summary

The manuscript describes BlinkTwin, a browser application that estimates subjective sleepiness (on the KSS scale) and perceived workload (on the raw NASA-TLX scale) for one person. A Three-Process Model (TPM) prior plus a time-on-task term is corrected by a Kalman filter. The filter state holds a personal offset and separate bias states for a PVT-B channel and a webcam channel (PERCLOS and blink duration from MediaPipe blendshapes), so that KSS check-ins set the level and passive signals mainly track change. Population mappings were fitted on DROZY (14 people, 36 sessions), where the blink-counting logic was compared with EOG. OpenNeuro ds004902 was used to look at how objective and subjective sleepiness are coupled, and a 300-person simulation compared six filter variants. The main empirical findings are honest and partly negative: check-ins carry most of the information, the webcam adds almost nothing to the sleepiness estimate, personal slopes hurt, and in DROZY calibration from one or two check-ins did worse than the population mapping. A prospective validation study is specified but has not been run.

## Overall assessment and recommendation

**Recommendation: major revision.**

The engineering is careful and the author reports negative results openly, which I appreciate. The design idea of keeping a separate bias state for each passive channel, so that a channel that misreads a person cannot pull the estimate away from that person's ratings, is sensible and well explained. In its current form, though, the paper does not support its main claims for a Q1 journal:

1. The central premise, a stable personal offset that check-ins can learn and passive signals can track, is not supported by the only real data analysed (DROZY), and the simulation that supports it is built on the same assumptions as the filter.
2. The TPM prior is not the published model. The sleep-recovery breakpoint, the ultradian component and any carry-over of sleep debt between days are missing, and the manuscript still contains a "to check" box admitting that the constants were not verified.
3. The ds004902 reaction-time results contradict the dataset's own descriptor paper in a way that points to mislabelled columns.
4. Making self-report the reference for a safety-relevant state conflicts with well-known evidence that subjective sleepiness underestimates objective impairment.
5. The "website's blink detector validated against EOG" and the "microsleep alarm" claims go beyond the evidence.

All five can be fixed. Two of them (the TPM implementation and the ds004902 reconciliation) are fixes to existing work, and two (running the actual twin on DROZY and ds004902, and adding misspecified simulation scenarios) need no new data collection. Without at least some real-person evidence for the anchoring premise, the paper would be better presented as a methods-and-protocol paper than as a validated system.

---

## MAJOR issues

### M1. The core premise is untested in real data, and the simulation is circular

**Location:** Abstract; Section 1 contributions 1–2; Section 5.1 "Personal calibration did not help here"; Section 6; Section 9 "Principal findings" and "What is new".

**Problem.**
- In DROZY, shifting a person's intercept to match their first rating made predictions worse (MAE 2.36 for a full shift, 1.90 for a shrunk shift, against 1.68 for the population model). This is direct evidence against the stable-offset idea. The reasons the author lists are plausible, but they are not tested.
- The simulation then shows that anchoring helps. But the virtual participants are generated from:
  - the same TPM prior;
  - a constant additive offset, which is exactly the state the filter estimates;
  - the same time-on-task structure, with the simulator's mean γ equal to the twin's γ;
  - linear signal mappings;
  - Gaussian rating noise (SD 0.7) close to the filter's assumed σ_K (0.75).

  This is a check that the filter works when its model is correct. It is not evidence that anchoring helps real people.
- The simulation also assumes a far better signal-to-noise ratio for personal calibration than DROZY shows. In DROZY the between-person intercept SD (1.14) is smaller than the residual SD (1.57); in the simulation the offset SD (1.0) is larger than the combined rating noise and fluctuation (about 0.86).
- The DROZY calibration analysis does not use the twin at all. It predicts KSS from reaction time alone, with no TPM prior and no time-awake information.

**Fix.**
1. Run the actual twin (variants A–E) on the real data you already have:
   - In **DROZY**, replay the three sessions with the protocol's sleep and wake times so that the TPM prior is used.
   - In **ds004902**, for the 33 people with KSS in both sessions, test whether the offset from the TPM prior in the normal-sleep session predicts the offset in the sleep-deprivation session. This is a direct test of the stable-offset premise in real people. The sessions are 7–30 days apart, which is close to the multi-day use case.
2. Add misspecified scenarios to the simulation and report every variant under each:
   - a person-specific homeostatic rate (trait-like vulnerability; Van Dongen et al. 2004), so that the true offset grows with time awake;
   - a variance ratio matched to DROZY;
   - circadian phase errors larger than the one-hour SD;
   - a webcam bias that drifts within the day (daylight to lamp light, glasses on and off);
   - PVT practice effects;
   - serial dependence of KSS ratings (people anchoring on their last rating);
   - ceiling effects at KSS 9;
   - a simulator γ that differs from the twin's γ;
   - noisy self-reported sleep times.
3. Reword the contributions so that "shown to be necessary", "never worse" and "calibrated uncertainty" are clearly simulation results under the model's own assumptions.

### M2. The ds004902 reaction-time results contradict the dataset descriptor (probable column mislabelling)

**Location:** Section 5.2 "Results"; Figure 4; Abstract ("reaction time slowed in 90% of people … KSS rose in only 73% … ρ = 0.25").

**Problem.**
- Xiang et al. (2024, *Sci Data* 11:427, Technical Validation) report the following for the same n = 30 PVT pairs:
  - SD of RT: t(29) = −7.31, p < 0.001
  - lapses (RT > 500 ms): t(29) = −4.72, p < 0.001
  - **median RT: t(29) = 0.04, p = 0.97 (no change)**
- The manuscript reports the opposite: median RT slowed (d_z = 1.33, which corresponds to t(29) ≈ 7.3, the same size as the descriptor's RT-SD statistic) and lapses did not change (p = 0.92).
- The subjective measures, by contrast, match the descriptor exactly:
  - manuscript KSS d_z = 1.00 with n = 33 ↔ descriptor t(32) = −5.72
  - manuscript SSS d_z = 0.80 with n = 35 ↔ descriptor t(34) = −4.73
- The descriptor also states that the protocol involved 24–30 h of sleep deprivation, and no change in PVT lapses after that would be physiologically surprising (Basner & Dinges 2011).

Either the column labels in the release differ from the descriptor, or `analysis/openneuro_pvt_kss.py` maps the columns wrongly. Until this is resolved, the ds004902 PVT results and the coupling analysis cannot be interpreted.

**Further problems in the same section.**
- KSS and PVT overlap for only 2 people. So "reaction time slowed in 90% … but KSS rose in only 73%" compares different people; it is not a within-person dissociation.
- "KSS rose" counts ties on an integer scale as "did not rise".
- The coupling (ρ = 0.25) is with the SSS, not the KSS, yet the abstract places it right after the KSS sentence.
- Change scores from two single sessions have low reliability, which attenuates any correlation.

**Fix.**
- Reconcile the column mapping using `participants.json` and the descriptor, and contact the dataset authors if needed.
- State which dataset version was analysed. v1.0.4 is cited, but v1.0.5 to v1.0.8 exist on DataCite up to April 2025; check whether `participants.tsv` changed.
- Report sleep-deprivation duration (24–30 h) and testing time of day.
- Remove the 90%/73% contrast or present it as a between-subset comparison.
- Name the SSS in the abstract.
- Cite Leproult et al. (2003), who showed that individual differences in subjective and objective alertness during sleep deprivation are stable but unrelated; that is the stronger prior evidence for your point.

### M3. The TPM implementation departs from the published model in ways that matter for the target users

**Location:** Section 4.1, Eq. 1–6 and Table 2; `web/src/twin/tpm.ts` (`sAtWake`, `alertness`); the "To check before submission" box in Section 4.1; Limitations.

**What is right.** All ten constants match the published parameterisation (see the constants table below). The prior values quoted in Section 4.1 (KSS 6.9, 2.6, 5.3 and 7.5) reproduce exactly from the stated equations.

**Problem.** Three structural elements are missing, and the second and third are not small.

1. **Breakpoint in sleep recovery.**
   - Åkerstedt, Folkard & Portin (2004, p. A76) cap the speed of recovery below a critical value of S′ (provisionally 12.5) and describe it as a "sleep break" that makes recovery linear.
   - Åkerstedt et al. (2008, *Chronobiol Int* 25(2):309–319) fitted the breakpoint at 12.2 on the 1–21 scale, with linear recovery below it. Ingre et al. (2014) use b_l = 12.2.
   - Without it, recovery from a short sleep is too fast. By my calculation (breakpoint 12.2, linear rate equal to the exponential slope at the breakpoint, about 0.80 units/h), S at waking after one 4-h night is 12.99 in BlinkTwin against 11.47 with the breakpoint. That makes the prior about **0.9 KSS too low** at waking. After 6 h of sleep the difference is 0.34 KSS; after 8 h it is 0.11 KSS.
2. **No sleep history across days.**
   - `sAtWake` assumes the previous waking period started at the upper asymptote (14.3), so every day starts fully recovered.
   - Cumulative sleep restriction therefore cannot be represented. By my calculation, after five consecutive 4-h nights the published model with the breakpoint gives S at waking of about 8.9, against 12.99 in BlinkTwin: a gap of about **2.5 KSS points**.
   - Shift workers and Defence personnel, whom the Introduction names as users, are exactly the people with multi-day sleep debt.
3. **Ultradian component U omitted.**
   - The published model adds a 12-h component: amplitude 0.5, mesor −0.5 (Ingre et al. 2014), phase set 3 h before the acrophase of C (2004, p. A77). Its dip falls at about 13:48 and 01:48.
   - Leaving it out makes the prior up to **0.6 KSS too low** at those times and about 0.3 KSS too low on average.
   - The constant part is absorbed by the offset; the time-varying part is not.

**Other points on the prior.**
- The 2004 paper lists sleep inertia as W_Init = 5.7 and W_Decay = 0.65692, while Ingre et al. (2014) give W_c = −5.72 and W_d = −1.51. Note that 0.65692 × ln 10 ≈ 1.51, so the 2004 value may be a base-10 rate. State which form you use and its time unit.
- Ingre et al. (2014) found that their best model for airline data was S (with breakpoint) + C + U, that adding W made the fit worse, and that the KSS mapping refitted to those data was a = 9.68, b = −0.46. This should be discussed.
- The 2004 model already offers simple individualisation: a 1–2 h phase shift for diurnal type, a habitual sleep need that changes the recovery time constant, and a 1 h/day phase adjustment for time-zone shifts. BlinkTwin uses none of these, although a one-question chronotype adjustment is cheap and evidence-based (Ingre et al. 2014).
- The constant-offset filter cannot correct phase errors, which produce errors that vary with time of day.

**Fix.**
- Implement the breakpoint (b_l = 12.2) with the published linear rate, the U process and a multi-day sleep history.
- Add a unit test that reproduces the 2004 Figure 1 scenario (waking at 07:00 after 8 h of sleep, then awake for 24 h).
- Cite Åkerstedt & Folkard (1995), Åkerstedt et al. (2008) and Ingre et al. (2014) as the sources of the parameter values.
- Add an optional chronotype phase shift.
- Remove the "To check" box.
- Rerun all simulation and DROZY results with the corrected prior.

### M4. Making self-report the reference is a safety-relevant design choice that needs explicit justification

**Location:** Sections 1, 4.2 "Why anchoring", 5.2 "Interpretation" ("the person's own ratings should stay the reference"), and 9.

**Problem.**
- Under chronic sleep restriction, PVT lapses keep increasing while sleepiness ratings level off, so people are largely unaware of their growing deficits (Van Dongen et al. 2003). Subjective and objective vulnerability to sleep loss are also unrelated across individuals (Leproult et al. 2003).
- With questionnaire anchoring, a check-in pins d. A PVT deterioration that follows is then explained mainly by the PVT bias state β_P, so the twin keeps reporting the person's subjective level. In other words, the design treats the most informative warning sign, objective decline beyond what the person reports, as sensor bias.
- That may be acceptable for a tool that estimates "how sleepy you feel". But the Introduction motivates the tool with drivers, shift workers, clinicians and Defence personnel who "judge their own state poorly". The design then makes that poor judgement the reference.

**Fix.**
- State plainly in the abstract, the model section and the app that s(t) is *subjective* sleepiness.
- Report an unanchored estimate of objective impairment alongside it, for example expected PVT-B lapses from the prior plus the PVT channel alone.
- Treat a persistent or growing learned bias, especially in β_P, as a signal to show the user, not something to hide.
- Simulate the dissociation scenario (objective decline with flat ratings) and report what each variant shows.
- Discuss this in the Limitations.

### M5. Problems with the observation model

**Location:** Section 4.2 "Observations", Table 2, Section 5.1 "Population mappings for the twin".

**Problems.**
1. **The mappings regress KSS on the features and then use the prediction as a measurement of KSS.**
   - E[KSS | RT] is shrunk towards the DROZY mean, and its slope on the true state is less than 1. The filter, with h = [1, 1, 0], treats it as an unbiased measurement with gain 1.
   - A constant bias state cannot absorb a multiplicative error.
   - The standard state-space form is generative: feature = a + b·KSS + e, with h = b and R = σ_e². The simulator already uses this form to generate the signals, but the filter does not use it to read them.
2. **Possible double counting of between-person variance.**
   - v = σ² + uᵀΣu includes the intercept variance (SD 1.136), which you describe as the between-subject SD. That is the same quantity the bias state β_P (prior SD 1.2) represents.
   - It also enters R as if it were independent noise on each test, when in fact it is constant within a person.
   - This would explain why the variants without bias states (C and D) are overconfident.
   - If the code does this, remove Σ₀₀ from R whenever a bias state is present.
3. **Between-person and within-person associations are mixed.**
   - The pooled random-intercept slope of KSS on reaction time (2.22 per 100 ms) is *below every* individual slope reported (2.5 to 7.5 per 100 ms).
   - This suggests that between-person differences in reaction time are weakly related to KSS and pull the pooled slope down.
   - Because anchoring uses within-person change, the within-person slope is the one that matters. Fit person-mean-centred models that separate within and between effects, and report both.
4. **The reaction-time mapping does not transfer cleanly to the app's test.**
   - The mapping was fitted on a 10-minute PVT on dedicated hardware but is applied to a 3-minute browser PVT-B. The shorter test has lower sensitivity and a different reaction-time level, so the slope and the intercept both differ; only the intercept difference is absorbed by the bias state.
   - Median reaction time is also one of the less sensitive PVT outcomes (Basner & Dinges 2011). Response speed (1/RT) or lapses plus false starts would be better.
   - Use a PVT-B-specific mapping, or at least show that the conclusions do not change.
5. **κ = 160 is a crude fix for autocorrelation.** It gives about one hour of webcam data the weight of less than half an independent observation. Model the autocorrelated error explicitly, for example as an AR(1) state, or aggregate the windows.

### M6. The sensing validation is overstated, and the "microsleep" alarms are unvalidated and likely to misfire at a laptop

**Location:** Abstract ("we also validated the website's blink detector against the EOG"); contributions 4 and 6; Section 3.1–3.2; Section 5.1 "Blink detection agrees with EOG"; Figure 3; `science.ts` "alarms" section ("Both are signs of a microsleep").

**What was validated.** The DROZY comparison used the eye aspect ratio from 68 landmarks on near-infrared Kinect video, rescaled within each test between its 90th and 1st percentiles. It did not use MediaPipe blendshapes from an RGB webcam. So it tests only the shared detection logic (thresholds and timing rules), not the website's sensing pipeline. Beyond that:
- The comparison is at session level (blink rate, n = 36). It says nothing about event-level detection (sensitivity and positive predictive value within a matching tolerance).
- Blink duration and PERCLOS, the two features the twin actually uses, were not validated against EOG.
- The EOG reference is itself an automatic peak detector. Vertical EOG also picks up vertical saccades, and the detector was not checked against manual annotation.
- The limits of agreement (−19.1 to +8.3 blinks/min against a mean of about 31/min) are wide.
- Rescaling within each test partly normalises away the very between-session differences in eye closure the analysis is trying to measure.
- Tests recorded at 15 fps measure blink duration with 67-ms resolution.

**Alarms.**
- A continuous eye closure of ≥ 1.0 s on a normalised blendshape score is a *long eye closure*, not a microsleep. Microsleeps are defined with EEG (for example the BERN criteria; Hertig-Godeschalk et al. 2020).
- At a laptop, looking down at the keyboard, a phone or papers lowers the upper lids. That raises the `eyeBlink` blendshape and changes head pitch, which is exactly the "head drop with eyes half closed" rule.
- The alarm rules are therefore likely to produce many false alarms. Equally, the absence of an alarm does not show alertness.
- "PERCLOS" here is the fraction of frames with a normalised blendshape score ≥ 0.8, which is not the P80 eyelid measure. The 15% warning threshold borrowed from the P80 literature therefore has no defined meaning on this scale.

**Fix.**
- Rename the alarms "long eye-closure alert" and "head-drop alert" throughout the paper and the app.
- Remove "signs of a microsleep" and "validated the website's blink detector".
- On DROZY, manually annotate a subset of EOG and video, and report event-level sensitivity and positive predictive value plus Bland–Altman agreement for blink duration and PERCLOS.
- Run a small new recording with simultaneous EOG and an RGB webcam to validate the actual MediaPipe pipeline. Include deliberate downward-gaze, reading and typing segments to measure false-alarm rates.
- Give a source for each threshold, or say it is ad hoc.
- Relevant evidence on ocular drowsiness measures against ground truth: Wilkinson et al. (2013) and Anderson et al. (2013).

### M7. The workload ("cognitive load") component is unsupported but appears in the title and claims

**Location:** Title; Abstract; Section 4.4; Table 2 (workload block); Section 9.

**Problem.**
- Workload "was not evaluated in this paper".
- The blink-rate mapping (m̄ = [50, −1.0], σ = 18) is not derived from any data.
- The context demands are defaults.
- Blink rate falls during visual tasks but rises with talking, so in the "meeting" context the mapping points the wrong way.
- NASA-TLX measures perceived workload for a specific completed task. It is not a measure of "cognitive load" in the sense of Paas et al. (2003).
- Because a check-in follows every reaction test, a TLX "for the task just done" will often rate the 3-minute PVT rather than the work.

**Fix.** Either evaluate the workload component (it could be added to the validation study, with the TLX prompt referring explicitly to the work block) or remove it from the title and contributions and describe it as an unevaluated feature. Use "perceived workload" rather than "cognitive load".

### M8. The validation protocol needs several changes before registration

**Location:** Section 8.

1. **Contamination of the reference.**
   - Each check-in follows a PVT that shows the reaction time for 600 ms after every response. People will rate KSS partly from how they think they did.
   - The dashboard shows the twin's own KSS estimate, which may anchor the next rating.
   - Both inflate agreement between the twin and the ratings it is scored against. Take the KSS *before* the PVT (or suppress feedback), and hide the twin's estimate until after the rating, at least on prompted check-ins.
2. **Hypotheses and power.**
   - H1 (twin better than rhythm-only at predicting the person's own ratings) is almost guaranteed by construction.
   - The informative comparison is E versus B. It is framed as non-inferiority but has no margin and no power calculation. Specify the margin (for example 0.1 KSS) and compute n for it, along with a calibration criterion for H2.
3. **Objective outcome.** Add prediction of the next PVT-B lapses (or response speed) as a co-primary or key secondary outcome. Predicting future ratings alone cannot show usefulness for fatigue risk management (see M4).
4. **Event rates.**
   - KSS ≥ 7 will be rare in healthy day workers at prompted daytime check-ins. Estimate the expected number of events per person, and power the Brier score and AUROC analyses, or rely on the extended-wakefulness subset.
   - Specify the size of that subset.
5. **Microsleep ground truth.**
   - Use EEG plus EOG plus video, scored by two blinded raters with stated criteria (for example BERN), and report inter-rater agreement.
   - Size the subset from the expected number of events and a target confidence-interval width for sensitivity, and analyse per event with clustering by participant.
   - In the 10-day field phase, report alarms per hour and have participants label false alarms.
6. **Inputs.**
   - Self-reported sleep drives the prior. Add wrist actigraphy plus a sleep diary.
   - Measure chronotype (MEQ or MCTQ).
   - Log caffeine and naps.
   - Report device and browser latency per participant.
7. **Ethics and safety.**
   - Name the ethics committee and the registry.
   - For extended wakefulness, exclude epilepsy, bipolar disorder and relevant cardiovascular conditions, screen for undiagnosed sleep apnoea (the current criterion only excludes *diagnosed* disorders), provide medical cover, and arrange supervised transport home.
   - Address storage and de-identification of exported logs.
8. **Population.** The study excludes night-shift workers, but the paper motivates the tool with shift workers and drivers. State the intended-use population and keep claims within it.

### M9. Positioning and the comparison table

**Location:** Sections 1, 2 and 9 "What is new"; Table 1.

**Missing prior work.** The paper must cite and position itself against:

- **Bayesian and online individualisation of fatigue models, with uncertainty:**
  - Van Dongen et al. 2007 (*Sleep* 30:1129–1143)
  - Olofsen et al. 2004 (*Aviat Space Environ Med* 75(3 Suppl):A134–A140)
  - Ramakrishnan et al. 2016 (*Sleep* 39:1827–1841), the Unified Model of Performance
  - Liu et al. 2017 (*J Sleep Res* 26:820–831), real-time individualisation of that model
  - 2B-Alert App: real-time, on a smartphone, learning from each PVT. Its finding that about 12 PVTs were needed to reach peak accuracy is directly relevant to the DROZY negative result with one or two check-ins.
- **TPM individual differences:** Ingre et al. 2014 (*PLoS ONE* 9:e108679). They estimated a between-person random intercept in KSS around the TPM prediction (SD 0.84), derived reference limits and adjusted circadian phase from a single question. This is close to BlinkTwin's "personal offset" and could inform σ_d (currently 1.2).
- **TPM structure and validation:** Åkerstedt & Folkard 1995 (*Sleep* 18:1–6); Åkerstedt et al. 2008 (breakpoint).
- **Fusing a biomathematical model with live sensing:** Sandberg et al. 2011 (*IEEE Trans Intell Transp Syst* 12:97–108) combined the TPM-based Sleep/Wake Predictor with driving-behaviour indicators and found the combination better than either alone. This bears directly on contribution 3.
- **Bias-augmented filtering** is a classic technique (Friedland 1969, *IEEE Trans Autom Control* 14:359–367). The novelty lies in applying it here, not in the method; say so.
- **Fatigue model reviews:** Mallis et al. 2004; Dawson et al. 2011.
- **Face-video drowsiness on DROZY:** Massoz et al. 2018 (*Sensors* 18:2801).
- **Short and mobile PVTs and browser timing:** Grant et al. 2017 (3-min smartphone and tablet PVT); Anwyl-Irvine et al. 2021 and Bridges et al. 2020 (browser timing).
- **KSS:** Åkerstedt et al. 2014 (*J Sleep Res* 23:240–252) review; Miley et al. 2016 (KSS versions).
- **Origin of PERCLOS:** Wierwille et al. 1994, NHTSA report DOT HS 808 247; Dinges et al. 1998, NHTSA report DOT HS 808 762.

**Table 1 is not fair.**
- "Uncertainty ×" for biomathematical models is wrong: Van Dongen et al. (2007) give Bayesian prediction uncertainty, and Ingre et al. (2014) give population reference limits.
- "Personal calibration ×" ignores the TPM's diurnal-type and sleep-need options.
- Many camera systems normalise to a driver's own baseline, so "×" for personal calibration in that row is too strong.
- "On-device, open" mixes two separate properties.
- BlinkTwin's ✓ for personal calibration is contradicted by DROZY, and its ✓ for uncertainty rests on simulation alone.
- The columns are chosen to favour the proposed system.

**Fix.** Rebuild the table around specific named systems with citations. Split "on-device" from "open source". Add columns where BlinkTwin is currently weaker: prospective human validation, objective ground truth, cumulative sleep restriction, caffeine. Mark BlinkTwin's entries that rest on simulation only.

### M10. Overclaiming and safety-relevant wording

| Location | Statement | Problem | Suggested change |
|---|---|---|---|
| Abstract (Methods); Contribution 6; Conclusion | "we also validated the website's blink detector against the electro-oculogram"; "blink detector agrees with EOG" | Different camera, landmarks and closure score; session-level blink rate only (M6) | "The blink-counting logic, run on DROZY landmarks, agreed with EOG blink rates at session level" |
| Abstract (Conclusions) | "forecast sleepiness with calibrated uncertainty" | Calibration shown only in a correctly specified simulation | "…with uncertainty that was calibrated in simulation" |
| Contribution 2 | "Bias-augmented fusion, shown to be necessary" | Simulation under the filter's own assumptions | "…beneficial in simulation" |
| Section 3.2; Contribution 4; app text | "Microsleep and head-drop alarms"; "these are signs of a microsleep" | No EEG ground truth; frequent downward gaze at a laptop | "Long eye-closure and head-drop alerts (not validated)" |
| Introduction, paragraph 1 | Motivation from drivers, Defence and clinicians; "judge it poorly" | Implies safety use; the twin then anchors to self-judgement (M4) | Keep the motivation, but add a clear intended-use statement and a not-for-driving statement in the abstract |
| Section 5.1, last sentence | "the simulation … shows the conditions in which it helps" | The conditions are assumed, not shown | "…under the assumption of a stable personal offset" |
| Section 9 "What is new" | "the first open tool…" | Ingre 2014, 2B-Alert and Sandberg 2011 are close (M9) | Qualify, and position against them |
| Title | "cognitive load" | Not evaluated (M7) | "perceived workload", or drop it |
| Introduction, first sentence | "Sleepiness and cognitive overload are common causes of error" | No citation | Add a citation |

The not-for-driving statement in the Limitations is good. Move a short version into the abstract, and state that the absence of an alert does not indicate fitness.

---

## MINOR issues

1. **Length and redundancy (21 pages).**
   - The abstract is about 500 words; most Q1 journals allow 250–300.
   - The contribution list appears three times (Introduction, "What is new", Conclusion), and the DROZY negative result is restated five times.
   - Section 7 could be folded into Section 3. The full-page Figure 6 and Table 2 could move to supplementary material.
   - A target of about 14 pages is realistic.
2. **Draft artefacts.** Remove the "To check before submission" box (Section 4.1), "Working draft" and the unused `\RESULT` macro. Make the repository public before submission, as the data statement promises.
3. **KSS version.** "Original verbal anchors" is ambiguous. The 1990 scale labelled every other step; later versions label all nine (see Kaida et al. 2006; Miley et al. 2016). State which version, the exact wording and the instruction ("the last 5 minutes"), and cite Miley et al. (2016) on differences between versions.
4. **KSS observation model.** The ratings are integers bounded at 1–9, but the filter treats them as continuous Gaussian measurements and only clips the estimate afterwards. Discuss the bias near the ceiling at night, or use a censored or ordinal observation model. Justify σ_K = 0.75 and σ_d = 1.2 (Ingre et al. 2014 reports a between-person SD of 0.84).
5. **Time on task.**
   - γ = 0.4 KSS/h and the reset after a 10-minute break have no source; `science.ts` admits this, but the paper does not.
   - The 2004 TPM paper states the model was built for "average sedentary workload", so adding γT may double count.
   - Cite evidence on time-on-task effects on KSS (for example Åkerstedt et al. 2010, driving simulator) or present γ as an assumption, and test sensitivity to it.
6. **PVT-B implementation.**
   - The 1-minute version should not feed the twin.
   - Report how stimulus onset is timed: frame-locked rendering quantises onset to about 16.7 ms at 60 Hz.
   - Report lapses plus false starts as Basner et al. (2011) recommend.
   - "A delay of a few milliseconds that is roughly constant" understates browser and keyboard latency, which varies by tens of milliseconds between devices and browsers (Anwyl-Irvine et al. 2021; Bridges et al. 2020). A constant 40–60 ms latency would also change lapse counts at the 355 ms threshold non-linearly. Measure latency on representative devices.
7. **Thresholds.** For the 12°/2.5 s nod rule, the 15% PERCLOS warning, the two-closures rule and the 300 ms mean blink duration rule, give a source for each or say it is ad hoc. Blink duration measured between the 0.5 and 0.3 hysteresis crossings is not the same quantity as the blink durations in Caffier et al. (2003).
8. **DROZY details.**
   - State time awake and clock time at each test; across the tests, time awake is confounded with time of day.
   - List which tests were at 15 fps and give a sensitivity analysis without them.
   - Give the method for degrees of freedom in the mixed models.
   - "No between-person variance left" in slopes from 9 people × 3 points is uninformative; say so, or use a Bayesian random-slope model with weakly informative priors instead of the non-converged fits.
   - Give confidence intervals for the calibration MAEs.
9. **Simulation reporting.**
   - Show an example trajectory (truth, estimate, band, check-ins).
   - Add a reliability diagram for the one-hour forecast.
   - Report error against simulated noisy ratings as well as against the latent truth, since only ratings are observable in practice.
   - "Never worse" refers to point estimates; at k = 8 the CI includes zero.
   - Check-ins only over-covers (0.947 against a nominal 0.90), so "close to nominal" also needs that context.
   - Consider reporting the CRPS.
10. **Attribution.** The additive split is an accounting identity of linear updates. It also depends on the order of updates, because a check-in moves d and β together. It is useful in the interface but should not count as a separate contribution.
11. **Clock and phase.** C uses local clock time with no phase adaptation, so after travel, during shift work and across daylight-saving changes the prior will be wrong in a time-varying way the offset cannot fix. Say this in the Limitations.
12. **Defaults.** Assuming waking at 07:00 after 7.5 h of sleep when nothing is entered is risky for shift workers. Require the entry, or flag estimates made with defaults. Naps and caffeine are not modelled.
13. **"Digital twin".** Three states around a population model is a thin twin. Either justify the term against a definition of a human digital twin or use "personalised state-space model".
14. **Figures.**
    - Figure 3: add a Bland–Altman panel.
    - Figure 4: KSS points overlap heavily on the integer scale; use jitter or counts.
    - Figure 5A: the legend sits over the data.
    - Figure 6: crop it and move it to the supplement.
    - Figures are pulled from `../results` and `../docs`; copy them into the paper folder for submission.
15. **App text inconsistent with the paper.** `science.ts` ("anchoring") says three check-ins cut the error "by about a third … (MAE 0.625 vs 0.930)". 0.625 is the BlinkTwin variant; check-ins alone gave 0.645 (about 31%). The "alarms" text says "Both are signs of a microsleep" (see M6).
16. **Dawson & Reid (1997).** Give the actual equivalences (about 17 h awake ≈ 0.05% BAC; 24 h ≈ 0.10%) rather than "many legal driving limits".
17. **MediaPipe citation.** Kartynnik et al. (2019) describes the face mesh, not the blendshapes. Add Grishchenko et al. 2023 (arXiv:2309.05782) for the `eyeBlink` blendshapes.
18. **Bibliography completeness.** See the reference table: missing article numbers, issues and DOIs, and one misattribution.

---

## Three-Process Model constants

Sources checked:
- Åkerstedt, Folkard & Portin 2004, *Aviat Space Environ Med* 75(3 Suppl):A75–A83 (full text read).
- Ingre et al. 2014, *PLoS ONE* 9(10):e108679 (full text read), which states the default parameter values and attributes them to Åkerstedt & Folkard 1990, Åkerstedt, Axelsson & Kecklund 2007, and Åkerstedt et al. 2008.
- Åkerstedt et al. 2008, *Chronobiol Int* 25(2):309–319 (abstract read).
- I could not access the full text of Åkerstedt & Folkard 1997.

"My calculation" marks numbers I derived; the authors should confirm them against the 2008 full text.

| Constant | Value used (tpm.ts / Table 2) | Published value | Source | Verdict |
|---|---|---|---|---|
| L, lower asymptote of S | 2.4 | 2.4 | 2004, p. A76 ("L = lower asymptote (2.4)"); Ingre 2014 (l_a = 2.4) | Confirmed |
| H, upper asymptote of S | 14.3 | 14.3 | 2004, p. A76 ("upper asymptote (14.3)"); Ingre 2014 (h_a = 14.3) | Confirmed |
| δ_w, decay of S while awake | 0.0353 h⁻¹ | 0.0353 h⁻¹; S = (S_a − L)e^(−0.0353t) + L | 2004, p. A76; Ingre 2014 (d = −0.0353) | Confirmed |
| δ_s, recovery of S while asleep | 0.381 h⁻¹ | 0.381 (2004); g = ln((14.3 − 14.0)/(14.3 − 7.96))/8 ≈ 0.3813 (Ingre 2014), i.e., recovery from 7.96 to 14.0 in 8 h | 2004, p. A76; Ingre 2014 | Confirmed (rounding) |
| Breakpoint in sleep recovery | **Not implemented** | 2004: critical S′ = 12.5, provisional ("presently being evaluated"); recovery speed capped below it (a "sleep break" that makes recovery linear). 2008: best-fitting breakpoint **12.2** on the 1–21 scale, linear recovery below it. Ingre 2014: b_l = 12.2 | 2004, pp. A76, A78; Åkerstedt et al. 2008 (abstract); Ingre 2014 | **Missing; must be added** |
| Linear recovery rate below the breakpoint | Not implemented | Not stated as a number in the texts I could read. The 2004 formula gives a rate equal to the exponential's slope at the breakpoint: 0.381 × (14.3 − 12.5) ≈ 0.69 units/h with 12.5, or ≈ 0.80 units/h with 12.2 (my calculation) | Derived from 2004, p. A76; confirm against Åkerstedt et al. 2008 and Ingre 2014 Eq. 1.3 | **To be confirmed by the authors** |
| S at waking, default | Computed; 14.06 after 8 h of sleep, assuming the previous day started at 14.3 | Default S_a = 14 (2004); in the full model S carries over between days | 2004, p. A76 | Structural difference: no multi-day sleep history (M3) |
| M, circadian amplitude | 2.5 | 2.5, mesor 0, period 24 h | 2004, p. A76 ("M = amplitude (2.5)"); Ingre 2014 (C_a = 2.5, C_m = 0) | Confirmed |
| φ, circadian acrophase | 16.8 h | 16.8 h | Ingre 2014 (p = 16.8). The 2004 text gives the formula C = M cos((t − p)π/12) but not the number | Confirmed (via Ingre 2014) |
| U, ultradian component | **Not implemented** | 12-h period, amplitude 0.5, mesor −0.5, phase 3 h before the acrophase of C; dip at about 13:48 and 01:48 | 2004, pp. A76–A77; Ingre 2014 (U_a = 0.5, U_m = −0.5), citing Åkerstedt, Axelsson & Kecklund 2007 | **Missing.** Prior up to 0.6 KSS too low at about 13:48 and 01:48, and 0.3 too low on average (my calculation) |
| W₀, sleep inertia at waking | −5.72 | −5.72 (Ingre 2014: W_c = −5.72); the 2004 text lists W_Init = 5.7 | Ingre 2014; 2004, p. A76 | Confirmed against Ingre 2014; the 2004 value is rounded |
| δ_i, inertia decay | 1.51 h⁻¹ | 1.51 (Ingre 2014: W_d = −1.51); the 2004 text lists W_Decay = 0.65692 (0.65692 × ln 10 ≈ 1.51, so possibly a base-10 rate) | Ingre 2014; 2004, p. A76 | Confirmed against Ingre 2014; the 2004 value differs and needs explaining. Note that W was not used in the 2004 simulations, and adding W made the fit worse in Ingre 2014 |
| a_K, KSS intercept | 10.6 | 10.6 | Ingre 2014 (a = 10.6, attributed to Åkerstedt & Folkard 1990) | Confirmed |
| b_K, KSS slope | 0.6 (KSS = 10.6 − 0.6A) | b = −0.6 in KSS = a + bA (the same equation) | Ingre 2014 | Confirmed. Ingre 2014 refitted these to a = 9.68, b ≈ −0.46 in airline data |
| Components summed into A | S + C + W | S + C (+U), with W optional; the best field model in Ingre 2014 was S (with breakpoint) + C + U | 2004, p. A77; Ingre 2014 | Partial: U and the breakpoint are missing |

---

## Reference check

All 34 cited keys are present in `refs.bib`, and every entry is cited. Entries were checked against Crossref, Europe PMC/PubMed, DataCite, arXiv, or the article PDF.

| Key | Status | Correction |
|---|---|---|
| akerstedt1990subjective | Verified (Int J Neurosci 52(1–2):29–37, 1990) | None |
| hart1988development | Verified (Adv Psychol 52:139–183, 1988) | None |
| hart2006nasa | Verified (Proc HFES Annu Meet 50(9):904–908, 2006) | None |
| basner2011validity | Verified (Acta Astronaut 69(11–12):949–959) | None |
| basner2011maximizing | Verified (Sleep 34(5):581–591) | None |
| dinges1985microcomputer | Verified (Behav Res Methods Instrum Comput 17(6):652–655) | None |
| akerstedt1997three | Verified (Chronobiol Int 14(2):115–123; doi 10.3109/07420529709001149) | None |
| akerstedt2004predictions | Verified from the article PDF (Aviat Space Environ Med 75(3, Suppl):A75–A83) | Optional: add PMID 15018267 |
| borbely1982two | Verified (Hum Neurobiol 1(3):195–204) | None |
| hursh2004fatigue | Verified (Aviat Space Environ Med 75(3 Suppl):A44–A53; 9 authors) | None; optionally list all authors |
| rajaraman2008individualized | Verified (J Appl Physiol 104(2):459–468) | Add doi 10.1152/japplphysiol.00877.2007 |
| reifman2019twobalert | Verified but incomplete | J Sleep Res 2019;**28(2):e12725**, doi **10.1111/jsr.12725** (online July 2018). Authors: Reifman J, Ramakrishnan S, Liu J, Kapela A, Doty TJ, Balkin TJ, Kumar K, Khitrov MY. Add number, article number and DOI |
| dinges1998perclos | Exists (FHWA/FMCSA Tech Brief FHWA-MCRT-98-006, 1998) | None. Add Dinges et al. 1998, NHTSA DOT HS 808 762, for the PVT-lapse finding |
| wierwille1994evaluation | Details verified (Accid Anal Prev 26(5):571–581) but **misattributed** | This paper is about trained observers rating drowsiness from video. The P80 PERCLOS measure comes from the 1994 NHTSA report (Wierwille et al., DOT HS 808 247). Cite that report for PERCLOS |
| caffier2003experimental | Verified (Eur J Appl Physiol 89(3–4):319–325) | None |
| stern1994blink | Verified (Hum Factors 36(2):285–297) | None |
| schleicher2008blinks | Verified (Ergonomics 51(7):982–1010) | None |
| ingre2006subjective | Verified (J Sleep Res 15(1):47–53) | None |
| kaida2006validation | Verified (Clin Neurophysiol 117(7):1574–1581) | None |
| vandongen2004systematic | Verified (Sleep 27(3):423–433) | Add doi 10.1093/sleep/27.3.423 |
| hoddes1973quantification | Verified (Psychophysiology 10(4):431–436) | Add doi 10.1111/j.1469-8986.1973.tb00801.x |
| dawson1997fatigue | Verified (Nature 388(6639):235) | Add issue 6639 and doi 10.1038/40775 |
| soukupova2016real | Exists (CVWW 2016, Rimske Toplice); not machine-verified | None |
| kartynnik2019real | Verified (arXiv:1907.06724) | Correct, but covers the face mesh, not blendshapes; add Grishchenko et al. 2023, arXiv:2309.05782 |
| lugaresi2019mediapipe | Verified (arXiv:1906.08172) | None |
| kalman1960new | Verified (J Basic Eng 82(1):35–45) | None |
| grieves2017digital | Verified (pp. 85–113; chapter online 2016, book 2017) | Add the book editors (Kahlen, Flumerfelt, Alves) |
| corralacero2020digital | Verified (Eur Heart J 41(48):4556–4564) | None |
| paas2003cognitive | Verified (Educ Psychol 38(1):63–71) | None |
| massoz2016ulg | Verified (WACV 2016) | Add pages 1–7 |
| xiang2024resting | Verified but incomplete | Sci Data **11:427** (2024), doi 10.1038/s41597-024-03268-2, PMID 38658675. Add the article number (`pages = {427}`). See also M2: this paper reports median RT unchanged and lapses increased |
| xiang2024ds004902 | Verified on DataCite (v1.0.4, created 31 Mar 2024; this is the version the descriptor cites) | Versions v1.0.5 to v1.0.8 (to Apr 2025) also exist; state which version was analysed and whether `participants.tsv` differs |
| ghoddoosian2019realistic | Verified (CVPRW 2019) | Add pages 178–187 and doi 10.1109/CVPRW.2019.00027 |
| brooke1996sus | Exists (Usability Evaluation in Industry, Taylor & Francis, pp. 189–194); not machine-verified | None |

**References to add.** All verified to exist with these details unless noted.
- Åkerstedt T, Ingre M, Kecklund G, Folkard S, Axelsson J. *Chronobiol Int* 2008;25(2):309–319. doi 10.1080/07420520802110613 (breakpoint).
- Ingre M, Van Leeuwen W, Klemets T, et al. *PLoS ONE* 2014;9(10):e108679. doi 10.1371/journal.pone.0108679 (parameter values, individual differences).
- Åkerstedt T, Folkard S. *Sleep* 1995;18(1):1–6. doi 10.1093/sleep/18.1.1.
- Van Dongen HPA, Mott CG, Huang JK, et al. *Sleep* 2007;30(9):1129–1143. doi 10.1093/sleep/30.9.1129.
- Olofsen E, Dinges DF, Van Dongen HPA. *Aviat Space Environ Med* 2004;75(3 Suppl):A134–A140.
- Ramakrishnan S, Wesensten NJ, Kamimori GH, et al. *Sleep* 2016;39(10):1827–1841. doi 10.5665/sleep.6164.
- Liu J, Ramakrishnan S, Laxminarayan S, Balkin TJ, Reifman J. *J Sleep Res* 2017;26(6):820–831. doi 10.1111/jsr.12535.
- Van Dongen HPA, Maislin G, Mullington JM, Dinges DF. *Sleep* 2003;26(2):117–126. doi 10.1093/sleep/26.2.117.
- Leproult R, Colecchia EF, Berardi AM, et al. *Am J Physiol Regul Integr Comp Physiol* 2003;284(2):R280–R290. doi 10.1152/ajpregu.00197.2002.
- Åkerstedt T, Anund A, Axelsson J, Kecklund G. *J Sleep Res* 2014;23(3):240–252. doi 10.1111/jsr.12158.
- Miley AÅ, Kecklund G, Åkerstedt T. *Sleep Biol Rhythms* 2016;14(3):257–260. doi 10.1007/s41105-016-0048-8.
- Sandberg D, Åkerstedt T, Anund A, Kecklund G, Wahde M. *IEEE Trans Intell Transp Syst* 2011;12(1):97–108. doi 10.1109/TITS.2010.2077281.
- Friedland B. *IEEE Trans Autom Control* 1969;14(4):359–367. doi 10.1109/TAC.1969.1099223.
- Mallis MM, Mejdal S, Nguyen TT, Dinges DF. *Aviat Space Environ Med* 2004;75(3 Suppl):A4–A14.
- Dawson D, Noy YI, Härmä M, Åkerstedt T, Belenky G. *Accid Anal Prev* 2011;43(2):549–564. doi 10.1016/j.aap.2009.12.030.
- Massoz Q, Verly JG, Van Droogenbroeck M. *Sensors* 2018;18(9):2801. doi 10.3390/s18092801.
- Hertig-Godeschalk A, Skorucak J, Malafeev A, et al. *Sleep* 2020;43(1):zsz163. doi 10.1093/sleep/zsz163.
- Wilkinson VE, Jackson ML, Westlake J, et al. *J Clin Sleep Med* 2013;9(12):1315–1324. doi 10.5664/jcsm.3278.
- Anderson C, Chang AM, Sullivan JP, Ronda JM, Czeisler CA. *J Clin Sleep Med* 2013;9(9):907–920. doi 10.5664/jcsm.2992.
- Grant DA, Honn KA, Layton ME, Riedy SM, Van Dongen HPA. *Behav Res Methods* 2017;49(3):1020–1029. doi 10.3758/s13428-016-0763-8.
- Anwyl-Irvine A, Dalmaijer ES, Hodges N, Evershed JK. *Behav Res Methods* 2021;53(4):1407–1425. doi 10.3758/s13428-020-01501-5.
- Bridges D, Pitiot A, MacAskill MR, Peirce JW. *PeerJ* 2020;8:e9414. doi 10.7717/peerj.9414.
- Åkerstedt T, Ingre M, Kecklund G, et al. *J Sleep Res* 2010;19(2):298–309. doi 10.1111/j.1365-2869.2009.00796.x (time on task in a driving simulator).
- Grishchenko I, et al. "Blendshapes GHUM: Real-time monocular facial blendshape prediction." arXiv:2309.05782, 2023.
- Wierwille WW, et al. NHTSA report DOT HS 808 247, 1994. Report number and year confirmed; full author list not verified.
- Dinges DF, et al. NHTSA report DOT HS 808 762, 1998. Not machine-verified; check the details.
