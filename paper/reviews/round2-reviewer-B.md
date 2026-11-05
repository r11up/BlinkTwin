# Round 2 review: Reviewer B

**Manuscript:** "BlinkTwin: Questionnaire-Anchored Estimation and Forecasting of Subjective Sleepiness From Webcam and Reaction-Time Signals in a Web Browser" (revised; IEEE two-column, 13 pages, plus a 3-page supplement)

**Reviewer expertise:** sleep science, fatigue risk management, human factors, biomathematical fatigue models (Three-Process Model), PVT, KSS, PERCLOS and ocular drowsiness measures.

**What I checked:** the revised PDF and its LaTeX sources, the supplement, the response to referees, `web/src/twin/tpm.ts` and `twin.ts`, `web/src/sensing/`, `web/src/insights/`, the scripts `simulate.ts`, `power.ts`, `drozy_twin.ts`, `openneuro_anchor.ts` and `openneuro_prior_check.ts`, every file in `results/` (including `sim_log.txt`), the OpenNeuro `participants.tsv` and `participants.json`, and `docs/`. I ran the prior in `tpm.ts` myself (Node 22) and recomputed the ds004902 paired statistics from `participants.tsv`. The DROZY raw data and the derived per-subject DROZY files were not available to me.

---

## Summary of the revision

The author has rebuilt the measurement model in generative form, implemented the published Three-Process Model (TPM) structure, replayed the released model on DROZY with leave-one-subject-out refitting, run the website's MediaPipe pipeline on the DROZY videos, tested the offset premise and the prior on OpenNeuro ds004902, rebuilt the simulation with misspecified scenarios and an oracle, moved workload out of the title, renamed the alerts, and redesigned the protocol with a simulated power analysis. The response is candid, and the numbers in the manuscript reproduce from the result files almost without exception (Section 5). This is a substantial and honest revision, and I thank the author for it.

The new evidence, however, changes what the paper is. On real data, the personalisation premise receives weak or negative support: offsets persist weakly across sessions, the sample-mean offset predicts better than the personal one, and on DROZY a second check-in made predictions worse. The method's distinctive element, anchored passive sensing, adds 0.03 KSS points in a simulation built largely on the model's own structure, and the author's own power simulation expects it to add nothing (+0.019) to the primary outcome of the planned study, which has less than 1% power to show a benefit. The webcam evidence comes from near-infrared Kinect video, where PERCLOS failed and blink duration is confounded with frame rate. The objective check that was introduced to answer my round-1 safety concern has not been evaluated, and as specified it is dominated by between-person and device differences.

The paper is now an honest methods-and-protocol paper with mostly null real-data results. In round 1 I wrote that, without real-person evidence for the anchoring premise, the work would be better presented in that form. The revision has gathered that evidence, and the evidence did not support the premise.

---

## 1. Status of my round-1 major issues

| Issue | Status | Main evidence |
|---|---|---|
| M1 Core premise untested; circular simulation | **Partly resolved** | Replay (Sec. V-C) and persistence test (Sec. V-D) were done as requested, and the results are weak or negative. The simulation truth is still TPM plus a constant offset in 7 of 9 scenarios. |
| M2 ds004902 reaction time against the descriptor | **Partly resolved** | The column mapping is verified from the data dictionary and value ranges. The lapse column is still physiologically implausible, and test times and hours awake are not reported. |
| M3 TPM departs from the published model | **Largely resolved** | Breakpoint, U and sleep history are implemented and reproduce. There is no chronotype phase, no reproduction of a published scenario, and an inappropriate "independent reviewer" sentence (Section 2). |
| M4 Self-report as the reference | **Partly resolved** | "Subjective" is now used throughout. The objective check is unevaluated (N3). The dissociation scenario is too mild and its objective-side results are not reported. Paper, response and code disagree on what the app does. |
| M5 Observation model | **Largely resolved** | Forward models, within-person slopes, no double counting, κ from autocorrelation. PVT-B transfer is still open, and κ is wrong for the deployed blink pipeline. |
| M6 Sensing validation overstated; alarms | **Partly resolved** | Renaming and wording are done, and MediaPipe was run on DROZY. There is still no RGB webcam data, no event-level metrics and no false-alarm data. Blink duration is frame-rate confounded (N4). The head-drop sign is unverified. |
| M7 Workload | **Resolved** | Out of the title, abstract and contributions; Supplementary S1 calls it unevaluated. |
| M8 Protocol | **Partly resolved** | Most items are added. Registration and ethics are still pending, and new design problems have appeared (N6). |
| M9 Positioning and Table I | **Largely resolved** | Named systems are in place, but Ahlström et al. (2013) is missing and the Sandberg and Wilkinson rows are incomplete. |
| M10 Overclaiming | **Largely resolved** | Some wording remains in the abstract, discussion, conclusion and app (N8). |

### M1. Core premise and circular simulation: partly resolved

**What was done.** The released model was replayed on DROZY with the real test times (`drozy_twin.ts`, `results/drozy_twin_summary.json`). The ds004902 persistence test I proposed was run (`openneuro_anchor.ts`). Eight scenarios that break the assumptions were added (Supplementary Table S2). The contributions no longer say "shown to be necessary" or "never worse".

**What the new evidence shows, and how the paper should read it.**

1. **DROZY, within a day.** With check-ins at tests 1 and 2, both "check-ins only" (MAE 1.90) and "all sources" (1.78) under-predicted every test-3 rating: in the summary file the bias equals minus the MAE (−1.904 and −1.778). I ran `tpm.ts` at the protocol's approximate test times (10:11, 03:51 and 12:11, waking at 07:00 after 7.5 h) and obtained a prior of 3.60 at test 1, 7.82 at test 2 and 6.72 at test 3. The observed means were 3.25, 5.58 and 7.33. The prior expects partial recovery from the night test to noon; these participants became sleepier. An offset learned at test 2 is therefore carried into a change of the wrong sign, and the more recent the check-in, the worse the prediction. This is direct evidence that the error of the prior is not an additive constant even within 8 h. It belongs in the Results and Discussion as evidence on the premise, not as a one-line aside.
2. **ds004902, across weeks.** The prior plus the person's shrunk offset gave 1.52 against 1.53 for the prior alone. The result file also contains `rhythm_model_plus_group_offset` = 1.45 (the sample-mean offset), which beats the personal offset and is not reported. The mean offset was +1.38 after normal sleep and +0.47 after deprivation. What one rating teaches the model in this dataset is mainly a population-level miscalibration of the prior, not a personal trait. Please report this result; it is in-sample, but a leave-one-out version will hardly differ.
3. **Interpretation.** The test compares a rested session with a deprived one. Low persistence is therefore also what trait-like differential vulnerability predicts (Van Dongen et al. 2004): the personal deviation grows with sleep pressure. Rating noise also attenuates r. With offset SDs of 1.56 and 1.83 and σ_K = 0.75, the reliabilities of single-rating offsets are about 0.77 and 0.83, so the disattenuated correlation is about 0.37 (my calculation). The sentence "An offset learned on one day therefore carries little information to a day weeks later" generalises from a rested-against-deprived comparison to ordinary day-to-day use, which has not been tested. Rephrase it, and see N2.

**Simulation.** Seven of the nine scenarios still generate the truth as TPM plus a constant offset plus time on task, which is the filter's own structure. The offset-to-noise ratio is about 1.0 (offset SD 0.84 against √(0.7² + 0.5²) = 0.86 for rating noise and fluctuation). In DROZY the ratio is about 0.72 (intercept SD 1.14 against residual SD 1.57). The weak ds004902 persistence implies a lower ratio still. PVT practice effects and serial dependence of ratings were not simulated, and every simulated person lives a single day (see N1). Please add a scenario whose offset persistence across days is calibrated to ds004902.

### M2. ds004902 reaction time against the descriptor: partly resolved

I accept the column mapping. `participants.json` labels item1 as the number of lapses, item2 as median RT and item3 as SD of RT. The value ranges are 0 to 8, 256 to 423 ms and 35.8 to 107.9 ms. From `participants.tsv` I recomputed paired t = −0.04, 7.31 and 4.72 (n = 30) and the KSS split of 73% rose, 18% unchanged and 9% fell. The value ranges settle that item2 is a reaction time and item1 a count, so the descriptor's text, not the data, must be wrong.

Points that remain:

- **The lapse column is implausible.** A 41-ms rise in median RT (d_z = 1.33) with no change in lapses (mean 2.47 against 2.43) is atypical after a night without sleep, because lapses are among the most sensitive PVT outcomes (Basner & Dinges 2011). So is a correlation of only 0.19 between item1 and median RT across sessions (my calculation). Item1 may use another threshold or may count false starts. Contact the dataset authors, state the PVT duration and lapse threshold, and do not interpret item1 until this is settled.
- **Test times and hours awake are still not reported**, as I asked in round 1. For the 33 people with KSS in both sessions, 31 had their eyes-open EEG (the time used for the KSS) between 13:23 and 18:03 in the deprivation session. The analysis assumes waking at 07:00 the previous day, which gives about 30 to 35 h awake. The diary's mean wake time in this young sample was 08:20 (`openneuro_prior_summary.json`). The prior's over-prediction of the deprivation effect (2.90 against 2.04) may therefore partly reflect the assumed hours awake and circadian phase, not only the KSS mapping. Report the times, and add a sensitivity analysis of the assumed previous-day wake time, as was done for DROZY.
- Say whether `participants.tsv` changed in the later versions (1.0.5 onwards).

### M3. TPM implementation: largely resolved

See Section 2 for the full check. The breakpoint, the ultradian component and the multi-day sleep history are implemented correctly and reproduce my round-1 numbers. Remaining items:

- the chronotype phase option;
- a unit test against a published scenario (the current tests check orderings, not published values);
- quoting the source equations verbatim;
- removing the "independent reviewer" sentence in Supplementary Section S2.

### M4. Self-report as the reference: partly resolved

**Done.** "Subjective" is used in the title, abstract, model and app. The objective check is described (Sec. IV-D). A dissociation scenario is simulated. The Limitations discuss the design choice.

**Open.**

1. The objective check has not been evaluated, and as specified it is mostly noise (N3).
2. The paper, the response and the code disagree. The response says that a growing anchor is "not done" and is future work. The paper describes only the latest-test reading. `web/src/insights/divergence.ts`, however, already reports the 24-h and 7-day growth of the reaction-time anchor and tells the user "take this seriously" (thresholds in `DIVERGENCE_RULES`: gap 1.5 KSS, growth 1.0 KSS-equivalent). The paper must describe what the application actually does.
3. The dissociation scenario is too mild to test the problem. Ratings compress only above KSS 5 within a single day, and most check-ins fall before that point. Its objective-side results are not in the manuscript, although the response says they are. In `sim_log.txt`, the passive-only estimate was worse than the anchored twin (twin_k0 − twin_k3 = +0.225, 95% CI 0.181 to 0.270) and worse than check-ins only (+0.196), even in this scenario. The scenario that matters is Van Dongen et al. (2003): 7 to 14 days of 4 to 6 h in bed, with ratings that plateau while PVT lapses keep rising.

### M5. Observation model: largely resolved

The generative forward models (Eq. 11), the within-person slopes, the removal of double counting and κ from the measured autocorrelation are correct and clearly explained. Remaining items:

- **PVT-B transfer.** The slope comes from a 10-min PVT on laboratory hardware (the standard PVT uses 2 to 10 s inter-stimulus intervals). It is applied to a 3-min browser test with 1 to 4 s intervals and device latency. The response says lapses and response speed would need the raw data, but `results/drozy_summary.json` already holds lapses (> 500 ms) per test, with a within-person r = 0.73. A lapse-based forward model can therefore at least be compared.
- **κ for the deployed blink pipeline.** The paper reports a lag-1 autocorrelation of 0.39 for MediaPipe blink duration, which implies κ ≈ 2.3. The released value remains 1.04, so the website runs a setting the paper itself calls too small. Change it, or justify keeping it.
- **What the slope measures.** The within-person slope was estimated across a sleep-deprivation protocol in which KSS, hours awake and circadian phase all move together. In rested day workers (the intended use), the daytime relation between RT and KSS may be much flatter, and the PVT-B is least sensitive in that range. Say so.

### M6. Sensing validation and alerts: partly resolved

**Done.** The alerts are renamed in the paper, `science.ts`, `SCIENCE.md` and `HOW_IT_WORKS.md`. "Microsleep" is gone. The MediaPipe pipeline was run on all 36 DROZY videos against EOG, which exposed the PERCLOS failure. Thresholds are called ad hoc. Bland–Altman limits are given for blink rate.

**Not done.** Event-level sensitivity and PPV, manual annotation, RGB webcam data, and any measurement of false alerts during downward gaze, reading or typing. The last was replaced by a rule (`LookDownGate`) whose effect has not been measured.

**New problems.**

1. Blink duration is confounded with frame rate (N4).
2. The head-drop direction depends on `PITCH_DOWN_SIGN = 1` in `head.ts`. The code comment and `docs/HOW_IT_WORKS.md` (line 663) both say that this "still needs to be checked on a real device". The paper (Sec. III-B) states that only forward pitch counts, as if this had been verified.
3. The blink meter's open-eye baseline (20th percentile over 30 s) and the head-pose rest (median over 20 s) both adapt to slow change. A gradual eyelid droop or head sag, the typical drowsy pattern, is partly absorbed into the baseline. PERCLOS is defined on absolute lid position, so this limits PERCLOS by design, not only on near-infrared video.
4. `LookDownGate` suppresses closures that follow a mainly downward gaze. Downward eye drift and lid lowering often precede drowsy closures, so the rule trades false alarms for misses at unknown rates.

### M7. Workload: resolved

### M8. Protocol: partly resolved

**Added.** Rating before the PVT with the estimate hidden; a non-inferiority margin; a simulated power analysis; an objective secondary outcome; BERN scoring by two blinded raters; actigraphy, diary, MEQ, caffeine, naps and device latency; exclusions (epilepsy, bipolar disorder, cardiovascular disease, STOP-Bang); a physician on call; transport home; a statement of the intended-use population.

**Still open.**

- The ethics committee and the registry are not named.
- The laboratory subset (n = 12) is not sized from expected event counts.
- New design problems are listed under N6.

### M9. Positioning: largely resolved

Table I now lists named systems, and the related work covers the individualisation literature. Remaining items:

- **Ahlström et al. (2013)** is missing: Ahlström C, Nyström M, Holmqvist K, et al. "Fit-for-duty test for estimation of drivers' sleepiness level: eye movements improve the sleep/wake predictor." *Transp Res Part C* 2013;26:20–32. It combined a TPM-based predictor with an eye-movement test to forecast KSS ≥ 8 within 2 h. According to the author's own `docs/LITERATURE_COMPARISON.md` (line 48), the AUC was 0.86 with the eye data against 0.64 for the model alone (please verify against the paper). It is the closest published model-plus-eyes forecast, and it reports a far larger gain from ocular data than this paper finds. It must be cited and discussed.
- **Sandberg row.** It reports only the best single indicator; add the result of the combination, which is the point of citing it.
- **Wilkinson row.** It gives no n, and the outcome "≥3 or ≥5 lapses min⁻¹" should be checked against the paper.

### M10. Overclaiming: largely resolved

Most of my suggested wording is in place. The remaining items are listed in N8.

---

## 2. Re-check of the Three-Process Model in `web/src/twin/tpm.ts`

I ran the code. The values quoted in Sec. IV-A reproduce: KSS 7.04 at waking, 3.69 at 09:00, 3.14 at 16:00, 5.68 at 23:00 and 7.66 at 03:00. S at waking is 11.16 after one 4-h night and 8.87 after five, matching my round-1 estimate of 8.9.

| Element | Published structure | `tpm.ts` | Verdict |
|---|---|---|---|
| S while awake | L + (S_a − L)e^(−0.0353t), L = 2.4 | `sAfterWake` | Correct |
| S during sleep, breakpoint | Linear below 12.2; exponential towards 14.3 at 0.381 h⁻¹ above it (Åkerstedt et al. 2008; Ingre et al. 2014) | `sAfterSleep`; linear rate 0.381 × (14.3 − 12.2) = 0.800 h⁻¹, continuous slope at the breakpoint | Correct under the derivative-continuous construction. Quote the source equation (Ingre et al. 2014, Eq. 1.3, or the 2008 paper) verbatim in the supplement. |
| Sleep history | S carried across days | `sAtLastWake`: ten 7.5-h habitual nights starting from 14.3, then the recorded nights. Research mode treats an unrecorded night between two recorded wake times as wakefulness; the app fills gaps over 30 h | Implemented. State which mode the prospective analysis will use; with missing diary nights, research mode creates spurious deprivation. |
| Recovery after debt | Not specified beyond the S equations | After five 4-h nights, one 8-h night restores S at waking to 12.46 and two to 13.60 (habitual 13.80) | Consistent with the model. Say that objective performance recovers more slowly after chronic restriction (Belenky et al. 2003; Banks et al. 2010); this matters for the objective check. |
| C | 2.5 cos(2π(h − 16.8)/24) | Same | Correct |
| U | 12-h period, amplitude 0.5, mesor −0.5, trough at about 13:48 and 01:48 (my round-1 reading) | −0.5 − 0.5 cos(2π(h − 13.8)/12): range −1 to 0, minimum at 13.8 h and 01.8 h | Consistent with my reading. A sign convention error would move the trough by 6 h, so reproduce the source equation with its page number. |
| W | −5.72 e^(−1.51τ) (Ingre 2014); 2004 lists 0.65692, plausibly a base-10 rate | Same; no inertia after an entered night without sleep | Correct. W is kept although Ingre et al. found that it worsened the fit; worth a sensitivity analysis. |
| KSS mapping | 10.6 − 0.6A; refitted 9.68 − 0.46A | Default kept | See N2: the refitted mapping barely changes DROZY's main error. |
| Individualisation | Phase shift for diurnal type; sleep need; 1 h/day re-entrainment | None | Not done. Defensible for now, but see N2. |
| Clock | Local time | Browser time zone, no adaptation | Limitation stated |
| Test against a published scenario | Requested in round 1 | Tests check inequalities (`twin.test.ts`, `more.test.ts`) | Partly done. Add a numerical test against a value printed in a source. |

**Remove the sentence "All were checked by an independent reviewer against [4] and [5]"** (Supplementary Section S2). A referee's report is not a citable verification. My round-1 table also flagged the linear recovery rate and the U phase as needing confirmation from texts I could not read in full. The author must verify the constants against the primary sources and quote them.

---

## 3. New major issues

### N1. The offset is a random walk, which the data contradict and which misbehaves over days

The offset is never pulled back towards a population value:

- `twin.ts` line 254 adds q_d·Δ to P_dd and leaves the mean unchanged;
- the forecast (line 476) does the same.

With √q_d = 0.3, the variance 16 h after a check-in equals the prior variance, and it keeps growing. My calculation: after a check-in, P_dd ≈ 0.40; after 48 h without check-ins the SD is about 2.2 KSS; after a week it is about 3.9 KSS. The point estimate keeps the last learned offset indefinitely.

Consequences:

1. **The intervals become uninformative.** The prior-alone 90% interval averages 5.2 KSS points wide on a 9-point scale (Table III).
2. **One unusual rating persists.** It keeps shifting the estimate on later days.
3. **The data point the other way.** ds004902 suggests that the best predictor weeks later is the population mean offset, which a mean-reverting process approaches automatically.
4. **The multi-day behaviour of the released model has never been tested.** Every simulated person lives one day. The power simulation replays each day separately (header of `power.ts`), while the protocol's primary outcome uses "all events before that rating".

**Fix.** Model the offset as an Ornstein–Uhlenbeck process that reverts to an estimated population mean (not fixed at 0, given +1.38 in ds004902) with stationary SD σ_d. Possibly use a fast within-day component plus a slow between-day component. Calibrate the time constants on ds004902 and DROZY, then re-run the replay, a multi-day simulation and the power analysis.

### N2. An additive offset cannot represent the main between-person difference that sleep science predicts

Trait-like vulnerability (Van Dongen et al. 2004) means that the personal deviation scales with homeostatic pressure and differs by circadian phase. The "trait" scenario generates exactly this, and BlinkTwin can follow it only by frequent check-ins. The ds004902 result (rested against deprived) and the DROZY result (an offset learned at test 2 fails at test 3) are both consistent with it.

**The refitted mapping will not fix DROZY.** With the refitted mapping (9.68 − 0.46A), the prior at the three DROZY tests becomes 4.31, 7.55 and 6.70, against 3.60, 7.82 and 6.72 with the default (my run of `tpm.ts` at the approximate test times given in M1). The night-test prediction moves by only −0.27, against an over-prediction of about 2.2 points. The test-1 prediction moves away from the observed 3.25, which will affect every condition with a check-in. DROZY's main error is in the time course, not in the slope of the mapping. Sec. VIII-D(i) ("the first change to test") and the Conclusion ("the clearest route to a better prior") therefore rest on one dataset and are contradicted by the other.

**With existing data:**

- fit a two-parameter personal state (offset plus a gain on S or on hours awake, or a phase shift) on ds004902, where two sessions at different sleep pressure identify a personal gain, and in the DROZY replay;
- compare it with the additive model;
- test a chronotype phase shift using diary wake time as a proxy (mean 08:20 in ds004902);
- check the DROZY test clock times from the PVT file headers against the protocol, and examine whether the night test was unusual.

### N3. The objective check is unvalidated and, as specified, mostly noise

The latest test is read as ŝ_obj = 3 + (RT − 339.2)/18.85. Table II gives a between-person SD of the RT baseline of 48.7 ms, which is 2.6 KSS-equivalents, and test noise of 36.4 ms, which adds 1.9 more. For a person whose reactions and ratings agree perfectly, the gap therefore has an SD of about 3.3 KSS points once the estimate's own error is included. With the 1.5-point rule (`DIVERGENCE_RULES.gapKss`), roughly one third of such people would be told after any test that they are "slower" and one third "faster" (my normal approximation, ignoring clipping).

Two further sources of error make it worse:

- **Device latency.** A latency of 40 to 60 ms, well within the range in refs. [38] and [39], adds 2 to 3 KSS-equivalents.
- **PVT version.** The level shift between the 10-min PVT and the browser PVT-B is unknown.

The message "you may be more impaired than you feel" will therefore reach many rested people. That risks alarm fatigue in exactly the feature that was meant to address the safety concern.

The 7-day anchor-growth rule is more sensible, because it removes the person's trait and any constant latency. It is, however, confounded by PVT practice effects (which work in the opposite direction), by changes of device, browser or keyboard, and by the anchor's own drift. Its false-alarm rate and its detection delay are unknown.

**Fix:**

1. Evaluate both rules in simulation:
   - the false-alarm rate per week in people without dissociation, with realistic latency, device changes and practice effects;
   - sensitivity and detection delay in a chronic-restriction scenario modelled on Van Dongen et al. (2003).
2. Prefer a within-person, same-device reference period, and response speed or lapses over median RT.
3. Until it is validated, present the check as unvalidated and remove "take this seriously" from the app.

### N4. The blink-duration evidence is confounded with frame rate

Mean MediaPipe blink duration rose from 158.7 ms at test 1 to 242.3 and 225.7 ms at tests 2 and 3 (`drozy_mediapipe_summary.json`, `means_by_test`). The landmark pipeline went from 179.6 to 224.8 and 242.9 ms.

For the KSS rise of 2.33 points, the forward model predicts about 26 ms (11.1 × 2.33). The observed MediaPipe rise of 84 ms is three times that. It coincides with the drop to about 15 frames per second in 8 of the 12 second tests.

In the 20 tests recorded at 30 frames per second, the within-person association of blink duration with KSS is r = 0.46 (p = 0.25, 5 subjects), and for long closures it is r = 0.33 (p = 0.42) (`excluding_15fps`). The paper reports only blink-rate agreement for this subset (ρ = 0.83). The abstract's "blink duration tracked KSS within person (r = 0.58)" must be qualified, and the 30-fps results reported.

The forward model for blink duration was fitted on the same 36 tests, 16 of them at 15 fps, so the website inherits the confound. In deployment, frame rate will also vary between devices and with CPU load: the benchmark gave 20 fps on the CPU delegate and 9.2 fps with the GPU delegate forced. Frame rate is not stored in the minute summaries. Store it, and exclude or model low-rate minutes. When the DROZY data can be re-obtained, downsampling the 30-fps tests to 15 fps is the decisive analysis.

### N5. The no-anchor comparator is a straw man, so "only with their own anchors" is overstated

In the no-anchor variant, the between-person baseline variance is added to R for every observation (`twin.ts` line 298). A bias shared by all minutes is therefore treated as independent noise. With about 60 webcam minutes per hour, the filter becomes overconfident (coverage 0.24) and is dragged to the population baseline. That failure is the textbook consequence of ignoring correlated error (the reason bias states exist; Friedland 1969). It does not show that anchoring is the only safe way to use passive signals.

Fair comparators include:

- a Schmidt–Kalman ("consider") filter that accounts for the bias without estimating it;
- passive features aggregated per hour or per session, with a population mapping and an R that reflects the shared bias;
- anchors that are frozen after a calibration period.

This comparison was also not run on DROZY. Until it is, the abstract's "passive signals can be added safely only with their own anchors" is not supported.

### N6. The protocol has design problems that would limit what the study can show

1. **"Pre-specified" needs a registration.** A pre-specified protocol requires a time-stamped registration before data collection, cited by DOI. As written, Section VII is a plan. Name the ethics committee (an independent researcher will need an institutional sponsor) and the registry, or retitle the section "Planned validation study".
2. **The power simulation does not mirror the planned analysis.** It replays each day separately, while the outcome uses the full log. Each virtual person keeps the same offset for 10 days, whereas ds004902 suggests weak persistence. Given N1, the claim that this is "conservative for BlinkTwin" is unverified.
3. **The hypotheses are mis-weighted.**
   - H2 (BlinkTwin against the prior alone) is close to certain by construction: a rating at 09:30 predicts the 12:00 rating. Yet H2 sets the sample size.
   - H3, the only test of passive sensing, has power below 0.01 at every n. The study therefore cannot show a benefit of the paper's methodological core.
   - Either power a design in which passive signals can matter (sparse check-ins, for example one per day, with the gaps between check-ins as the evaluation target), or make the objective outcome (lapses or response speed on the next PVT-B) co-primary. The paper's own motivation calls for the latter.
4. **The 0.10 KSS margin needs a rationale.** For example, relate it to the test–retest SD of KSS (about 0.7) or to a minimal important difference. With an expected difference of +0.019 (SD 0.10), H1 is nearly guaranteed.
5. **The display can contaminate the outcome.** The estimate is hidden only while the person rates. For the rest of the day they see the estimate, the forecast, the warnings and the objective check. These can anchor later ratings and change behaviour (breaks, caffeine) in ways that favour the variant on display. Use a silent-mode field phase (logging only), or randomise the display on and off by day.
6. **The laboratory phase is not sized.** Give the expected number of long closures and EEG-defined microsleeps per person over 26 h, and the target width of the confidence intervals for sensitivity and PPV, and analyse per event with clustering by participant. Specify the task: the alerts must be tested during desk work (typing, reading, phone use), not during the PVT or a resting EEG.
7. **Screening and safety.**
   - Add the Epworth Sleepiness Scale (Johns 1991) and an insomnia screen.
   - Require a stable sleep schedule verified by actigraphy for at least 7 days before the laboratory session.
   - Add rules on caffeine and alcohol, and exclude recent transmeridian travel and pregnancy.
   - Give guidance for participants who drive during the field phase.
   - Describe the storage and retention of the identifiable laboratory video, and how bystanders captured by the webcam at work, and the employer, give consent.
8. **The pilot cannot update the power figures.** A pilot of 5 people cannot meaningfully re-estimate a variance. Pre-specify a blinded sample-size re-estimation rule, or drop the update.

### N7. The forecasting and simulation results rest on a scenario outside the intended use

The intended use is desk work by day workers who do not work night shifts (Sec. VII). Table III, Fig. 4 and the forecast results use 24 h of continuous wakefulness, in which 27.5% of outcomes are KSS ≥ 7. In the workday scenario, which matches the intended use:

- KSS ≥ 7 occurred in 1.4% of outcomes;
- the Brier difference against check-ins was −0.000 (95% CI −0.001 to 0.001);
- time-to-KSS-7 crossings were scored for only 18 (check-ins only) and 20 (BlinkTwin) of 300 people, and for none with the prior alone.

The title's "Forecasting" therefore rests on the laboratory scenario. Make the workday the primary scenario, and present the 24-h scenario as relevant to the laboratory phase.

Two further points on the forecast:

- The app states a clock time ("you will reach KSS 7 around HH:MM"). The simulated miss was about 80 min, and the forecast has never been tested on real people. Show a window or a probability instead.
- The time-to-crossing comparisons were computed on different subsets of people (n = 288, 255 and 257 in `sim_log.txt`). Compare the methods on the common subset.

### N8. Remaining overclaiming and safety wording

| Location | Statement | Problem | Suggested change |
|---|---|---|---|
| Abstract (Results); VIII-A; IX | "Webcam blink rates agreed with EOG (ρ = 0.71)"; "counted blinks in agreement with EOG"; "measured blinks in agreement with EOG" | Near-infrared Kinect video, not a webcam; mean undercount 13 blinks/min (about 35%), limits of agreement −35.8 to +9.8 | "On DROZY's near-infrared video, the website's pipeline correlated with EOG blink rate (ρ = 0.71) but undercounted blinks by 13 per minute" |
| Abstract (Results) | "blink duration tracked KSS within person (r = 0.58)" | Frame-rate confound (N4) | Add the 30-fps result and the caveat |
| Abstract (Conclusion) | "passive signals can be added safely only with their own anchors" | Simulation only; straw-man comparator (N5); "safely" is loaded in a safety context | "In simulation, passive signals improved on check-ins only with their own anchors, by 0.03 KSS points" |
| VIII-A; IX | "each source of information reduced the error a little" | Intervals overlap; a naive baseline did as well | "Point estimates were lower with each source; intervals overlapped" |
| IX | "a field-refitted KSS mapping was the clearest route to a better prior" | One dataset; barely changes DROZY (N2) | Qualify |
| Title | "...From Webcam and Reaction-Time Signals" | Most information comes from the prior and check-ins | For example, "...Combining a Three-Process Model, Self-Ratings and Passive Signals..." |
| Abstract (Significance) | "pre-specified protocol" | Not registered | "planned protocol", until registered |
| III-B | head drop "pitched forward" | Sign unverified on any device | Verify, or say so |
| App, Now card and `SCIENCE.md` | "If it reads well above how sleepy you feel, take that seriously" | Objective check unvalidated (N3) | Remove until validated |
| App (`main.ts` line 129); III-E | Model-driven KSS ≥ 7 warnings are switched off without a sleep entry | Also suppresses the warning when the person's own check-in puts the estimate at 8 | Suppress only warnings driven by the prior |

---

## 4. Minor issues

1. **The response does not match the code** on the anchor-growth message (M4). Check the whole response against the final code.
2. **KSS version.** Sec. III-D cites [21] (Åkerstedt & Gillberg 1990, every other step labelled) for the version with all nine steps labelled. Cite the source of the exact wording used, and give the wording and the instruction in the supplement.
3. **ds004902 hours awake.** See M2: give the clock times and the assumed hours awake, with a sensitivity analysis.
4. **Late sample.** The default 07:00 wake time is an hour early for the ds004902 sample (diary mean 08:20); say so when interpreting the prior's error.
5. **Privacy check.** The automated check used a fake camera with no face (`privacy_check.json`), so the code paths that run when a face is found were not exercised. Repeat it with a face video. Also note that the browser's local storage is unencrypted on shared work computers.
6. **Figure files.** Figures are still pulled from `../results` and `../docs/img` (`\graphicspath` in `main.tex`); copy them into the paper folder.
7. **Length.** At 13 pages the paper is long for a regular paper; check the journal's page limits. The DROZY descriptive mixed models (Supplementary S3) could go.
8. **Wording.** "maximum 0.79" in Sec. V-B is the mean of the per-test maxima; say so, or give the overall maximum.
9. **Two autocorrelation values for one pipeline.** Sec. V-A gives 0.02 for landmark blink duration and Sec. V-B gives 0.05 (Section 5, row 1). Use one definition.
10. **Simulator slope spreads.** The supplement says the simulator uses "the DROZY values of Table II", but its slope SDs for blink duration and PERCLOS are half of Table II's (Section 5, row 3). Either the filter assumes too much slope spread or the simulator too little; say which, and why.
11. **Undisclosed per-person harms in simulation.** Passive signals without check-ins made 41% of people worse by more than 0.1 KSS, and 5% worse by about 1 point (`sim_log.txt`, twin_k0 − prior_k0, p95 = 0.96). Three check-ins made 29% of people worse by more than 0.1 than the prior alone. Users who never check in receive the first of these. Report both.
12. **The replay did not use the website's camera features.** The DROZY replay used landmark-based webcam features, not the MediaPipe features the website produces. The abstract's "replayed the released model" should say so, or the replay should be repeated with MediaPipe blink duration and the PERCLOS guard, since those per-minute features exist.

---

## 5. Numbers in Sections V and VII and Table I against the result files

I checked every number in Sections V, VI and VII, Tables I and III, and Supplementary Tables S2 and S3 against the files.

**Numbers that match (to rounding):**

- DROZY correlations, slopes and Table II constants (`drozy_summary.json`, `drozy_forward.json`);
- EOG agreement and all MediaPipe statistics (`drozy_mediapipe_summary.json`);
- all replay MAEs, biases and the wake-time sensitivity (`drozy_twin_summary.json`);
- the ds004902 group effects, t statistics, value ranges, KSS split, persistence and prior comparisons (`openneuro_*.json`, and my recomputation from `participants.tsv`);
- every entry of Tables III, S2 and S3 and the forecast metrics (`sim_log.txt`);
- the power figures (`power_summary.json`);
- the benchmark (`benchmark.json`).

The discrepancies and omissions are these:

| # | Location | Manuscript value | File and field | File value | Comment |
|---|---|---|---|---|---|
| 1 | Sec. V-A against Sec. V-B | Landmark blink-duration lag-1 autocorrelation "0.02" (V-A, sets κ) and "0.05 for the landmark pipeline" (V-B) | `drozy_forward.json` `lag1_autocorrelation.blink_ms`; `drozy_mediapipe_summary.json` `lag1_autocorrelation_per_minute.ear_mean_blink_ms` | 0.018; 0.053 | Same pipeline, two values. PERCLOS likewise: 0.318 against `ear_perclos` 0.389. |
| 2 | Sec. V-B | "maximum 0.79" | `drozy_mediapipe_summary.json` `raw_score_percentiles_mean.score_max` | 0.792 | A mean of the per-test maxima, not the maximum |
| 3 | Suppl. S5 | "using the DROZY values of Table II (… blink-duration slope SD 7 ms, PERCLOS slope SD 0.3%)" | Table II and `drozy_forward.json` `slope_sd_raw` (blink, PERCLOS); `web/src/sim/synth.ts` `POPULATION` | 14.26 and 0.473; simulator 7 and 0.3 | Not the Table II values |
| 4 | Sec. IV-C; Suppl. S3 | Slope spread "from the subjects with three sessions"; "9 subjects with three tests" | `drozy_forward.json` `n_subjects_slope`; `drozy_summary.json` `per_subject_slopes.*.n_subjects` | 8; 9 | Which subjects define σ_b? |
| 5 | Abstract | "ds004902 (33 adults) … lowered the prior's error from 1.69 to 1.46" | `openneuro_prior_summary.json` `n_with_diary` | 28 | The comparison uses 28 people |
| 6 | Sec. V-D | Prior 1.53; shrunk offset 1.52; full 1.63; carry forward 2.33 | `openneuro_anchor_summary.json` `rhythm_model_plus_group_offset` | 1.45 | Omitted; the best predictor in the file |
| 7 | Sec. V-B, 30-fps subset | Only "ρ = 0.83" (blink rate) | `drozy_mediapipe_summary.json` `excluding_15fps.rmcorr_mp_blink_ms_kss`, `rmcorr_mp_long_per_min_kss` | r = 0.46 (p = 0.25), r = 0.33 (p = 0.42); 5 subjects | Omitted; these are the results that bear on the frame-rate confound |
| 8 | Sec. VI (dissociation); response to M4 | Objective-side results said to be reported | `sim_log.txt` "compare dissociation twin_k0 - twin_k3", "twin_k0 - checkins_k3" | +0.225 [0.181, 0.270]; +0.196 [0.147, 0.248] | Not in the manuscript |
| 9 | Sec. VI-B | "Passive signals alone did not help" (mean only) | `sim_log.txt` "compare matched twin_k0 - prior_k0" | worse > 0.1: 0.413; p95 = 0.960 | Per-person harm omitted |
| 10 | Sec. VI-B, forecasts | Time to KSS 7 "prior 79, check-ins 84, BlinkTwin 81 min" | `sim_log.txt` forecast matched, `cross` | n = 288, 255, 257 | Different subsets of people |

---

## 6. References

Each cited claim is plausible for its source as stated. Specifically:

- Dawson & Reid (tracking task, 0.05% and 0.10%);
- Van Dongen et al. 2003 (lapses rise while ratings plateau);
- Leproult et al. 2003;
- Ingre et al. 2006 (individual differences between blink duration and KSS);
- Kaida et al. 2006 and Åkerstedt et al. 2014;
- Wierwille et al. 1994 (NHTSA DOT HS 808 247) and Dinges et al. 1998 (DOT HS 808 762) for PERCLOS;
- Basner, Mollicone & Dinges 2011 (PVT-B parameters);
- Basner & Dinges 2011;
- Grant et al. 2017;
- the two browser-timing papers;
- Miley et al. 2016;
- Hertig-Godeschalk et al. 2020 (BERN);
- Åkerstedt et al. 2008 (breakpoint);
- Ingre et al. 2014 (0.84; refitted mapping);
- Sandberg et al. 2011;
- Reifman et al. 2019 (about 12 PVTs);
- Ghoddoosian et al. 2019 (65.2% against 57.8%);
- Morris et al. 2019;
- Bakdash & Marusich 2017;
- Bland & Altman 1986;
- Brier 1950;
- Van Dongen et al. 2004.

Items to correct or check:

| Item | Problem | Action |
|---|---|---|
| [21] in Sec. III-D | Cited for the all-nine-labelled KSS, but it is the original version with every other step labelled | Cite the source of the wording actually used (see minor item 2) |
| Table I, Wilkinson et al. [41] | n missing; outcome "≥3 or ≥5 lapses min⁻¹" unusual | Verify against the paper; add n |
| Table I, Ingre et al. [28] | "Residual SD 1.46 with model-generated sleep"; the author's notes give 1.42 and 1.46 for two model variants, and the cohort size as 106 or 136 | Verify and state which model and n |
| Table I, Maior et al. [54], Massoz et al. [47], Subramaniyan et al. [53], Knock et al. [52] | Values plausible; I could not verify them line by line | Authors to confirm each number against the full text |
| Supplementary Table S1 | "KSS mapping 10.6 − 0.6A: [5]"; Ingre et al. attribute it to Åkerstedt & Folkard (1990) | Cite the original as well |

References to add:

- Ahlström C, Nyström M, Holmqvist K, et al. *Transp Res Part C* 2013;26:20–32 (M9).
- Belenky G, Wesensten NJ, Thorne DR, et al. *J Sleep Res* 2003;12(1):1–12.
- Banks S, Van Dongen HPA, Maislin G, Dinges DF. *Sleep* 2010;33(8):1013–1026.
- Johns MW. *Sleep* 1991;14(6):540–545 (Epworth Sleepiness Scale, for screening).
- For the comparator in N5, a standard reference for the Schmidt–Kalman ("consider") filter (Schmidt 1966, *Advances in Control Systems* 3:293–340).

---

## 7. Readiness for a Q1 venue

**Where the paper stands.** It is a careful, reproducible and honest methods paper:

- an open on-device implementation;
- small, mostly null real-data evaluations (14 and 33 people);
- a simulation in which the method's distinctive element adds 0.03 KSS points;
- a planned study that, by the author's own simulation, cannot show that element's benefit.

It is not ready to be a full research paper in IEEE JBHI. A paper whose title promises webcam-based estimation and forecasting needs, at minimum, validation of the webcam pipeline on webcam video and evidence that the model works on real people in the intended setting.

### A. Analyses with existing data, in order of priority

1. **Offset dynamics (N1).** Replace the random walk with a mean-reverting offset, add multi-day simulations, and make the power simulation mirror the planned full-log analysis.
2. **Fair comparator (N5).** Add a non-anchored comparator that handles the shared bias properly, in both the simulation and the DROZY replay.
3. **Objective check (N3).** Characterise the false-alarm rate and the detection delay in simulation, with device latency, practice effects and chronic restriction. Report the existing dissociation results.
4. **DROZY:**
   - report the 30-fps results for blink duration and long closures (N4);
   - replay with the website's MediaPipe features and the PERCLOS guard;
   - add no-anchor and refitted-mapping variants;
   - analyse the two-check-in failure and the test timing (N2);
   - fit a lapse-based PVT forward model (M5).
5. **ds004902:**
   - report the sample-mean offset result;
   - centre and disattenuate the persistence estimate;
   - fit a personal gain (vulnerability) model;
   - report test times, with sensitivity analyses for hours awake and wake time (M2).
6. **Other public data.** These two datasets are listed in the author's own `docs/LITERATURE_COMPARISON.md`.
   - UTA-RLDD: 60 people, consumer RGB webcams and phones. Use it to test the MediaPipe pipeline, the PERCLOS guard and the blink-duration association on RGB video.
   - The Liège multi-timescale dataset: 29 people, with PVT. Use it to test the link from eye measures to the PVT out of sample.
7. **Housekeeping.** Correct the inconsistencies in Section 5 and the wording in N8, and add the references.

### B. New data

1. **A short laboratory validation of the website pipeline.** Use consumer RGB webcams at their native frame rate, with simultaneous EOG (ideally EEG), during desk work (typing, reading, phone use), after normal sleep and after one night of restriction or extended wakefulness. Report:
   - event-level blink and long-closure detection;
   - agreement of blink duration with EOG;
   - how the PERCLOS guard behaves;
   - false alerts per hour.

   About 15 to 20 people would suffice for agreement and false-alarm rates.
2. **Browser PVT-B latency.** Measure it on at least 10 combinations of laptop, browser and keyboard. Derive a PVT-B-specific forward model, for example in the pilot.
3. **The prospective study**, registered and redesigned as described in N6.

### C. Journal and article type

**Now:**

- The protocol, once ethics approval and registration exist, fits a protocol article (*JMIR Research Protocols*; *BMJ Open* protocol).
- The system, the public-data evaluation and the simulation fit a methods or formative-evaluation article in a venue that values transparent null results: *JMIR Formative Research*, *PLOS Digital Health*, *Frontiers in Digital Health*, *IEEE Open Journal of Engineering in Medicine and Biology* or *Sleep Advances*.
- With item B2 added, the browser PVT-B and its timing would suit *Behavior Research Methods*.
- The software alone suits a software journal.

**After items A and B1–B2:** a JBHI regular paper becomes realistic as a methods-and-validation paper.

**After the prospective study:**

- *IEEE JBHI* or *IEEE TBME* (system plus validation);
- *npj Digital Medicine* (if real-world validation is strong);
- *SLEEP* or *Journal of Sleep Research* (if objective outcomes and sleep-science findings, for example subjective–objective dissociation in daily life, are central);
- *Accident Analysis & Prevention* (if the alerts are validated against scored events).

I would also consider splitting the work into a protocol paper and a methods paper now.

---

## 8. Recommendation

**Reject and resubmit.**

**Justification.** The revision is thorough, transparent and reproducible, and most of my round-1 requests were met. The remaining problems are not wording problems:

- the real-data evidence for the personalisation premise is weak or negative;
- the method's distinctive contribution shows a benefit of 0.03 KSS points only in simulation, against a comparator that fails by construction;
- the webcam evidence comes from near-infrared video with a frame-rate confound;
- the objective check that answers the safety concern is unvalidated;
- the offset model behaves poorly over days;
- the planned study cannot show the benefit it is meant to test.

Several of these can be fixed with existing data (Section 7A). A full paper in this journal, however, needs at least the RGB-webcam validation, and ideally the prospective data. I would be glad to see the work again in that form, and I would support publishing the present material now as a methods or protocol article in one of the venues listed above.

Reviewer B
