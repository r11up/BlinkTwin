# Response to the round-1 referee reports

**Manuscript:** BlinkTwin (revised title: "BlinkTwin: Questionnaire-Anchored Estimation and Forecasting of Subjective Sleepiness From Webcam and Reaction-Time Signals in a Web Browser")

We thank both referees for detailed, careful and fair reports. They found real problems: a measurement model that was not valid for a Kalman filter, a prior that was not the published model, a simulation built on the filter's own assumptions, overstated claims about the blink validation and the alarms, and a misread OpenNeuro result. We rebuilt the model, evaluated the released configuration on real data, rebuilt the simulation and rewrote the paper in the IEEE two-column journal format. Where we could not do what was asked, we say so and explain why.

Two practical constraints shaped what we could do. First, no new human data have been collected; the prospective study is specified in Section VII. Second, the DROZY archive could not be re-downloaded in the environment used for this revision, so analyses that need DROZY's raw signals (manual EOG annotation, frame-rate downsampling, re-running the eye pipeline with the new blink-meter fix) could not be repeated. All DROZY numbers in the paper come from the committed result files, and the scripts reproduce them exactly.

Section and equation numbers below refer to the revised manuscript (`paper/main.pdf`) and its supplement (`paper/supplement.pdf`).

## Summary of the main changes

1. **Forward measurement models.** Each passive signal now has a generative model, feature = a + b (KSS - 3) + anchor + noise, in the signal's own units (Eq. 11). Slopes are within-person (subject fixed effects); the anchor's prior SD is the between-person SD of baselines; the noise is split into a within-session part and a slow anchor drift; the variance inflation comes from the empirical lag-1 autocorrelation. Nothing is tuned on simulated people. The inverse (calibration) regression, kappa = 160, personal slopes and the blink-rate workload channel are gone.
2. **The published Three-Process Model.** Breakpoint 12.2 with linear recovery below it, the 12-h ultradian component and sleep debt carried across days are implemented and unit-tested; every constant has a source (Table II and Supplementary Table S1).
3. **Real-data evaluation of the released model.** A leave-one-subject-out replay on DROZY with the real test times (Section V-C); the website's MediaPipe pipeline run on all 36 DROZY videos against EOG (Section V-B), which revealed that PERCLOS fails on near-infrared video and led to a guard in the model; tests of offset persistence and of the prior on OpenNeuro ds004902 (Section V-D).
4. **Simulation rebuilt** following Morris et al. (2019): the released defaults, an oracle bound, common random numbers across the number of check-ins, nine scenarios including eight that break the model's assumptions, and a sensitivity analysis of the filter settings (Section VI, Supplementary Section S5).
5. **Claims reduced.** The estimate is called subjective sleepiness throughout; an unanchored objective check is shown beside it; workload moved to the supplement and out of the title; alarms renamed "long eye-closure" and "head-drop" alerts and described as unvalidated; the comparison table rebuilt around named systems with reported accuracies.
6. **Software defects fixed** (with tests): zero-blink minutes, alerts that cleared during closures longer than about 24 s, alerts that cleared when the face left the frame, head drop in either direction, eye closure while looking down, the 1-minute test feeding the model, untouched workload sliders, time on task after short breaks. The app now asks for the rating before the reaction test and hides the estimate while the person rates.

---

## Reviewer A

### M1. Mis-specified measurement model
**Done.** The inverse regression E[KSS | feature] is replaced by forward models (Section IV-C, Eq. 11). The observation is linear in the state with h = [b_j, ..., 1, ...]; between-person differences in baseline go into the anchor state, not into R, so they are no longer counted twice. Slopes are within-person (fixed effects; `analysis/drozy_forward.py`), so the regression-dilution problem the referee described no longer applies: the reaction-time slope is 18.85 ms per KSS point. kappa is now (1 + rho)/(1 - rho) from the lag-1 autocorrelation in DROZY (1.93 for PERCLOS, 1.04 for blink duration), not a tuned constant; we also report that the MediaPipe pipeline's blink-duration autocorrelation is 0.39, which implies a larger kappa (Section V-B, Limitations). An oracle that knows each virtual person's true forward parameters gives the upper bound the referee asked for (Section VI). All comparisons were re-run.

### M2. Circular simulation, minimal misspecification
**Done in part.** The study is now reported with aims, data-generating mechanisms, estimands, methods and performance measures (Section VI-A). Scenarios that break the model's assumptions: circadian phase and misreported sleep; nonlinear signals with heavy-tailed noise; personal rating bias and extra rating noise; strongly autocorrelated webcam noise; person-specific Three-Process Model parameters (trait vulnerability); unrecorded multi-day sleep debt; an ordinary 16-h workday; and ratings that level off at high sleepiness. A sensitivity analysis varies sigma_d, q_d, gamma, sigma_K, the anchor drift and the slope spread. The offset SD of the virtual people is now 0.84, the between-person SD reported by Ingre et al. (2014), rather than an assumed 1.0. **Not done:** a generator from a different model family, missing webcam windows (coverage is fixed at 0.9) and device latency. These are listed in the Limitations.

### M3. Comparisons not on equal terms; variant F confounded
**Done.** No parameter is tuned for any variant; all variants use the same DROZY-derived settings, so the tuning asymmetry is gone. Variant F (personal slopes by Bayesian regression) was removed from the code and the paper, since its implementation had the problems the referee identified and the forward models make it unnecessary. **Not done:** a literature baseline such as Bayesian individualisation of the two-process model. Those methods predict PVT performance from repeated PVTs, not self-rated sleepiness, so they are not a like-for-like baseline for the KSS; the oracle bound plays the role of a ceiling, and the prospective study includes the prior and check-ins-only baselines.

### M4. Overstated simulation claims, selective reporting
**Done.** Every k is reported with MAE and, at k = 3, 90% coverage and mean interval width (Table III); night-time MAE, per-person shares and quantiles, scenarios and sensitivity are in the text and Supplementary Tables S2 and S3. Per-person paired differences are summarised by the share of people better and by quantiles. The one-hour forecast reports the Brier score with a person-level bootstrap CI for the difference, the Brier skill score against the rhythm model, AUROC and reliability (Supplementary Fig. S4). Simulator seeds no longer depend on k (common random numbers). "Never worse", "best forecasts" and "calibrated uncertainty" are gone from the abstract, contributions and conclusion. A non-inferiority margin (0.10 KSS) is pre-specified for the prospective study. Simulation comparisons are labelled exploratory.

### M5. DROZY confounding, slopes, and a LOSO design that did not test the twin
**Done in part.** (d) The released model is now replayed on DROZY with the Three-Process-Model prior from the real test times, a check-in at test 1, the anchors, and forward models refitted leaving one subject out (Section V-C). The referee's indicative re-analysis was right: the structure helps (MAE 1.73 prior, 1.47 passive only, 1.51 check-in only, 1.38 all sources), although the intervals are wide and a protocol-aware naive baseline reaches 1.39; we report both. (c) Slopes are within-person. (b) The frame-rate confound is reported (16 of 36 tests at about 15 fps, all in tests 2 and 3), and the MediaPipe agreement is also reported for the 20 tests at 30 fps; **not done:** downsampling the 30-fps recordings, which needs the raw data. (a) The shared time trend is stated where the correlations are reported. (e) Bootstrap CIs over subjects are used for the replay; the old Wald-based mixed models are moved to the supplement with the referee's caveat and are no longer used by the model; the non-converged blink-rate model is reported. (f) The deconvolved slope variance claim is removed. (g) Eye features out of sample: the webcam's contribution is now measured in the replay (1.46 to 1.38 with a check-in; 1.51 to 1.47 without).

### M6. Blink validation overclaimed and incomplete
**Done in part.** The text now says the landmark comparison tests the blink-counting logic. The website's actual pipeline (MediaPipe model file, eyeBlink blendshapes, unchanged blink meter) was run on all 36 DROZY videos (Section V-B, Fig. 2): blink rate against EOG rho = 0.71 (within person r = 0.65), blink duration against the landmark pipeline rho = 0.72, and PERCLOS failure on near-infrared video, now guarded against. The EOG reference is described as an automatic detector without manual annotation. **Not done:** manual annotation, event-level sensitivity and PPV, and validation of long closures against EOG; these need the raw data and are outcomes of the prospective study's laboratory phase, which records EEG, EOG and video.

### M7. Zero-blink defect
**Done.** A minute with fewer than three blinks is not used for blink duration (`minBlinksForDuration`), with a unit test. In the MediaPipe run, 4.3% of minutes had no blinks. Long closures are not in the model; their within-person association with KSS on the MediaPipe pipeline (r = 0.51) is reported as a candidate signal.

### M8. OpenNeuro misreported; invalid comparison; argument points the other way
**Done.** The abstract no longer reports the RT-SSS coupling. The 90%/73% comparison is removed; KSS changes are reported with ties (rose 73%, unchanged 18%, fell 9%). The coupling estimate has its CI (-0.17 to 0.59). The column mapping is verified: our paired t statistics (0.04, 7.31, 4.72) equal the descriptor's, which attaches them to different measures, and the released data dictionary and value ranges support our assignment (Section V-D). The argument is rewritten: instead of arguing from heterogeneity, we test the premise directly. A person's offset from the prior was only weakly correlated between the two sessions (r = 0.29, 95% CI -0.05 to 0.58), which we report as evidence that offsets carry little information across weeks, consistent with the model's offset drift.

### M9. Unevaluated components
**Done.** Workload is moved to the supplement and out of the title, abstract and contributions. The alerts are renamed and described as unvalidated, with their exact rules (head drop now counts only forward pitch; eye closure while looking down is ignored; the baseline no longer climbs during long closures; a face lost during a closure keeps the alert on). The "exact explanation" is called an additive decomposition of filter updates whose split depends on their order. The time-to-KSS-7 forecast is evaluated in simulation (absolute error of the predicted crossing time).

### M10. Unverified constants, draft artefacts, unevaluated released configuration
**Done.** Constants verified (Reviewer B's table), breakpoint and U implemented, sources in Table II and Supplementary Table S1. Hyperparameters without a data source are labelled as assumptions and their sensitivity is reported. The simulation and the DROZY replay both use the released defaults. Draft boxes, "Working draft" and placeholder macros are removed.

### M11. Validation protocol
**Done.** The power analysis now simulates the actual primary outcome, the error of predicting each observed (noisy, rounded) rating, for 1000 virtual people over 10 workdays (Section VII). It changed the design: BlinkTwin minus check-ins averaged +0.019 KSS (SD 0.10), so superiority over check-ins is not a realistic aim. H1 is non-inferiority of BlinkTwin against check-ins only with a 0.10 KSS margin (power above 0.99 with 40 people); H2, superiority over the prior alone, sets the sample size (power 0.77 with 60 and 0.89 with 80; we plan 65 analysed, 75 recruited); superiority over check-ins is tested last. The KSS is rated before the PVT and with the estimate hidden. The analysis plan will be registered on OSF before recruitment.

### M12. Novelty and related work
**Done.** The contribution is positioned as an application and evaluation of known techniques (Friedland 1969 is cited for bias states). Table I compares named systems with their reported accuracies, datasets and validation schemes. Related work now covers individualised fatigue models (Olofsen 2004; Van Dongen 2007; Rajaraman 2008; Ramakrishnan 2016; Liu 2017; Reifman 2019), TPM validation (Akerstedt and Folkard 1995; Akerstedt et al. 2008; Ingre et al. 2014), model-plus-sensor fusion (Sandberg et al. 2011), ocular measures against ground truth (Wilkinson 2013; Anderson 2013) and browser timing (Anwyl-Irvine 2021; Bridges 2020). "Digital twin" is defined in the Introduction and the technical sections use "state-space model".

### Minor issues
1. kappa grid: obsolete (kappa is no longer tuned).
2. Test count: now stated from the test suite.
3. Check-in times are given exactly (Section VI-A).
4. Webcam windows: the text says they are generated every minute after 07:30, breaks included.
5. Time-on-task mismatch: the simulated breaks are 10 min, which reset T in both the simulator and the model; the model's handling of shorter breaks was also fixed.
6. Head-drop threshold and direction are stated (forward pitch of at least 12 degrees).
7. Browser timing: rewritten with citations; the protocol measures device latency.
8. Random-slope wording: removed; the non-converged model is reported in the supplement.
9. Mapping fitted on 15-min averages applied to 1-min windows: obsolete; forward models for the webcam are fitted on one-minute windows.
10. Coverage: computed for the latent state on the model's interval; for predicting ratings the protocol includes the rating noise in the interval.
11. Bootstrap: 2000 resamples (simulation and DROZY replay).
12. Figures: paired differences are plotted for the scenarios; subjects in Fig. 2C are drawn in one neutral colour.
13. EAR rescaling within test: stated as a limitation of the landmark pipeline; the MediaPipe analysis uses the website's own normalisation.
14. Frame rates: stated exactly.
15. Workload initial state and the unset demand: in Supplementary Section S1.
16. "Break now" what-if: described (T stays zero for the horizon); the forecast now also offers a regular-break schedule.
17. Forecast target: defined as latent sleepiness of at least 7.
18. Simulator truncations: listed in the supplement.
19. DROZY derived files: `results/drozy_*.csv` (per subject and per test) are git-ignored and not distributed; only aggregate JSON summaries and figures are in the repository.
20. Reproducibility: Node.js >= 22.6 and Python 3.13 stated; a DOI-archived snapshot will be made on submission.
21. "Did worse" wording: obsolete (the analysis was replaced).
22. Blink-agreement CI: within-person correlations are reported alongside.
23. Simulation mappings: the simulation now uses the released DROZY defaults.
24. Formatting: IEEE two-column journal template.

---

## Reviewer B

### M1. Core premise untested in real data; circular simulation
**Done.** (1) The released model was replayed on DROZY with the protocol's real test times so that the prior is used (Section V-C). (2) On ds004902 we tested exactly the analysis the referee proposed: whether a person's offset from the prior after normal sleep predicts the offset after sleep deprivation. It does so only weakly (r = 0.29; shrunk-offset MAE 1.52 against 1.53 for the prior), and we report this as a limitation of the stable-offset idea across weeks (Section V-D). (3) Misspecified scenarios: trait-like homeostatic vulnerability, larger phase errors and misreported sleep, webcam drift and autocorrelation, ratings that level off, rating bias, unrecorded sleep debt and an ordinary workday (Section VI). The virtual people's offset SD is now 0.84 (Ingre et al., 2014). **Not done:** PVT practice effects and serial dependence of ratings.

### M2. ds004902 reaction-time results vs the descriptor
**Done.** We checked the release's data dictionary (`participants.json`): PVT_item1 is the number of lapses, item2 the median RT and item3 the SD of RT. The value ranges agree (item1 0-8; item2 256-423 ms; item3 36-108 ms). Our paired t statistics are 0.04 (lapses), 7.31 (median RT) and 4.72 (SD of RT); the descriptor reports the same three values but attaches 7.31 to the SD of RT, 4.72 to lapses and 0.04 to median RT. Because a median RT cannot take values of 0-8, we follow the data dictionary and report the discrepancy (Section V-D). The analysed version (1.0.4) is stated. The 90%/73% contrast is removed and the SSS is named wherever it is used. Leproult et al. (2003) is cited.

### M3. TPM departs from the published model
**Done.** Breakpoint (12.2, linear recovery at the exponential's slope at the breakpoint), the U process (amplitude 0.5, mesor -0.5, dip at 13:48 and 01:48) and multi-day sleep history (ten habitual nights before the recorded history) are implemented and unit-tested, including sleep-debt accumulation over consecutive short nights and the ultradian dip. The sleep-inertia form is stated (Supplementary Section S2, including the base-10 reading of W_Decay). Ingre et al.'s refitted mapping (9.68, 0.46) is not only discussed but tested on ds004902: it reduced the prior's error (MAE 1.46 vs 1.69, difference -0.22, 95% CI -0.33 to -0.09) and predicted the size of the deprivation effect better (2.23 vs 2.90 against an observed 2.04). **Not done:** the chronotype phase shift; it needs a chronotype question in the app and data to test it, and the prospective study collects the MEQ for this purpose.

### M4. Self-report as the reference
**Done.** The estimate is called subjective sleepiness in the title, abstract, model and app. The app shows an objective check (the latest reaction test on the population scale, not anchored) with a note that a reading well above the person's rating may mean under-rated impairment (Section IV-D). The dissociation scenario (ratings that level off while the true state rises) is simulated and reported, including what the objective channel shows (Section VI). The Limitations discuss the design choice. **Not done:** showing a growing anchor as a warning in the app; this is listed as future work.

### M5. Observation model
**Done.** (1) Forward, generative models with h = b. (2) No double counting: between-person variance is the anchor's prior, not part of R. (3) Within-person slopes. (4) PVT-B transfer: the mapping still comes from a 10-min PVT; this is stated as a limitation, the anchor absorbs a level difference but not a slope difference, and the prospective study will re-estimate the slope on the PVT-B. Response speed and lapses were not tested as alternative features because that needs the raw DROZY data. (5) kappa now derives from the measured autocorrelation.

### M6. Sensing validation overstated; alarms
**Done in part.** Alerts are renamed "long eye-closure alert" and "head-drop alert" in the paper and the app; "signs of a microsleep" is removed; every threshold is called an ad hoc default; eye closure while looking down no longer raises an alert, and head drop counts only forward pitch. The MediaPipe pipeline itself was validated on DROZY video against EOG (Section V-B), including the PERCLOS failure. PERCLOS is described as a normalised blendshape measure, not the P80 eyelid measure. **Not done:** manual annotation, event-level metrics and a new recording with EOG and an RGB webcam including downward gaze, reading and typing; these are in the protocol's laboratory phase.

### M7. Workload component
**Done.** Removed from the title, contributions and abstract; described in Supplementary Section S1 as an unevaluated feature using "perceived workload"; the blink-rate workload channel is removed; the TLX prompt now refers to the work block, not the test.

### M8. Protocol
**Done.** (1) KSS before the PVT, estimate hidden. (2) Non-inferiority margin 0.10, power simulated on the primary outcome, fixed-sequence testing, sample size raised to 65 analysed (75 recruited). (3) Objective outcome: prediction of the next PVT-B as a key secondary outcome. (4) Event rates: KSS >= 7 forecasting is evaluated in the laboratory phase. (5) Microsleep ground truth with EEG, EOG and video, two blinded raters, BERN criteria, inter-rater agreement; alerts per hour and participant-labelled false alarms in the field. (6) Actigraphy plus diary, MEQ, caffeine and naps, device latency. (7) Exclusions and safety for extended wakefulness, sleep-apnoea screening, physician cover and transport. (8) Intended-use population stated. The ethics committee and registry will be named once approval is obtained.

### M9. Positioning and comparison table
**Done.** See Reviewer A, M12. Table I lists named systems with dataset, outcome, validation and reported accuracy; its BlinkTwin rows show only results on public data, and simulation results are kept separate (Section VI).

### M10. Overclaiming and safety wording
**Done.** Every suggested change is applied: "blink-counting logic" for the landmark comparison; no "calibrated uncertainty" claim; "beneficial in simulation"; alerts renamed and described as unvalidated; intended-use and not-for-driving statements in the Introduction and Conclusion, including that the absence of an alert does not indicate alertness; "first open tool" removed; "cognitive load" removed from the title; the first sentence is cited and gives the Dawson and Reid equivalences.

### Minor issues
1. Length: the main text is now an IEEE two-column paper with a separate supplement; the abstract is about 250 words; contributions appear once.
2. Draft artefacts removed; the repository will be public with an archived snapshot on submission.
3. KSS version: the version with all nine steps labelled, "the last 5 minutes"; Miley et al. (2016) cited.
4. KSS observation model: the Gaussian treatment of integer ratings is listed as a limitation; sigma_d and sigma_K are labelled assumptions and their sensitivity is reported; the simulation's offset SD is 0.84 (Ingre et al., 2014).
5. Time on task: gamma presented as an assumption, the possible double counting with the TPM is discussed, Akerstedt et al. (2010) cited, and sensitivity reported.
6. PVT-B: the 1-minute version no longer feeds the model; stimulus-onset timing is described; lapses and false starts are reported; browser latency is cited and will be measured.
7. Thresholds: all called ad hoc defaults.
8. DROZY details: test times, frame rates by test, the shared time trend and bootstrap CIs are given.
9. Simulation reporting: reliability diagram, error against noisy ratings in the power analysis, CRPS is planned for the prospective study.
10. Attribution: called an additive decomposition that depends on update order.
11. Clock and phase: stated in the Limitations.
12. Defaults: the app says when it uses the default sleep assumption.
13. "Digital twin": defined in the Introduction; technical sections use "state-space model".
14. Figures: Fig. S1 to S3 use aggregates; Fig. 2 replaces the old blink figure; the dashboard screenshot is in the supplement; figures are produced by scripts and pulled from `results/`, and will be copied into the submission package.
15. App text: updated to the new results and wording.
16. Dawson and Reid equivalences given.
17. Grishchenko et al. (2023) cited for the blendshapes.
18. Bibliography: every correction in the referee's table is applied (Xiang 2024 article 427; 2B-Alert 28(2):e12725 with DOI; PERCLOS source is the NHTSA report DOT HS 808 247; DOIs and pages added).
