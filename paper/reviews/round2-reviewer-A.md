# Referee report, round 2: Reviewer A

**Manuscript:** BlinkTwin: Questionnaire-Anchored Estimation and Forecasting of Subjective Sleepiness From Webcam and Reaction-Time Signals in a Web Browser (revised version; IEEE two-column format, 13 pages, with a 3-page supplement)

**Journal:** IEEE Journal of Biomedical and Health Informatics

**Reviewer expertise:** biomedical signal processing, Bayesian state-space modelling and Kalman filtering, statistics and simulation methodology (author of round-1 report A)

**Materials checked:**
- the compiled PDFs (`paper/main.pdf`, `paper/supplement.pdf`; pages rendered and read) and their sources (`paper/main.tex`, `paper/sections/*.tex`, `paper/supplement.tex`);
- my round-1 report, Reviewer B's round-1 report and the author's response;
- the code: `web/src/twin`, `web/src/sensing`, `web/src/insights`, `web/src/sim/synth.ts`, `web/src/main.ts`, and the scripts `simulate.ts`, `power.ts`, `drozy_twin.ts`, `openneuro_anchor.ts` and `openneuro_prior_check.ts`;
- every result file in `results/` (JSON, CSV and `sim_log.txt`) and `docs/LITERATURE_COMPARISON.md`.

I ran the unit tests (105 pass) and evaluated the released `tpm.ts` at a few time points. The DROZY raw data and the derived per-subject DROZY tables were not available to me. Where I infer something from the aggregates, I say so.

---

## 1. Summary of the revision

The revision is substantial:
- The inverse calibration regression is replaced by forward measurement models in each signal's own units, f = a + b(s - 3) + anchor + e, with within-person slopes and an anchor state per channel.
- The Three-Process Model now has the sleep-recovery breakpoint, the ultradian component and sleep debt carried across days.
- The released model structure is replayed on DROZY, leaving one subject out.
- The website's MediaPipe pipeline is run on the DROZY near-infrared video against EOG. This showed that PERCLOS fails on that video, and a guard was added.
- OpenNeuro ds004902 is used to test offset persistence and two changes to the prior.
- The simulation is rebuilt under the Morris et al. framework, with common random numbers, an "oracle", eight misspecified scenarios and a sensitivity analysis.
- Workload moves to the supplement, the alerts are renamed and described as unvalidated, and the validation study now has a simulated power analysis.

The headline results are:
- On DROZY, the MAE is 1.73 for the prior and 1.38 for all sources, with overlapping intervals and different prediction sets; a protocol-aware naive baseline gives 1.39.
- In simulation, BlinkTwin beats check-ins only by 0.03 KSS points at three check-ins.
- In the power simulation of the planned study, BlinkTwin did not predict ratings better than check-ins only.

## 2. Overall assessment

**Strengths.** The author has taken the round-1 reports seriously and answered most points with real work rather than rewording. The text agrees with the code and result files to a degree I rarely see: almost every number I checked matches (Section 6). Common random numbers are implemented and verified (`sim_summary.json`, `crn_check`: zero truth difference across k in all nine scenarios). The forward models remove the regression-dilution problem of round 1 and stop between-person variance from entering R. The MediaPipe-on-DROZY analysis is a useful and honestly reported negative finding. The ds004902 checks of offset persistence and of the KSS mapping are the kind of real-data test I asked for. Negative results are reported.

**Weaknesses.** The paper's central conclusion is that passive signals "can be added safely only with their own anchors". It is still not supported, for six reasons:
1. The comparator without anchors treats a persistent person-level bias as white noise, so its failure is built in (N1). The "oracle" is not a bound (N2).
2. The real-data evidence for the passive channels is weak. It comes from an unpaired comparison on different prediction sets of 20 and 24 predictions, from 11 to 13 people, using webcam features from a different pipeline than the website runs. In that comparison a naive protocol-aware baseline equals the full model. The gain arises at the one test where the prior is biased, through intercepts learnt in the same laboratory (N3).
3. The author's own power simulation shows that adding the passive signals made rating predictions slightly but reliably worse (N3).
4. A code path bypasses the new PERCLOS guard (N4).
5. The random-walk offset is at odds with the weak persistence the author reports, and the DROZY prior error is time-varying, not an offset (N5).
6. The validation study's non-inferiority margin is almost as large as the whole benefit of check-ins, and the study cannot test the novel component (N7).

## 3. Status of my round-1 major issues

| Issue | Verdict | Evidence | What remains |
|---|---|---|---|
| M1. Mis-specified measurement model | **Partly resolved** | Forward model, Eq. (11)-(12) and Table II. `twin.ts` l.289-300: h = [b, ..., 1, ...]. Within-person slopes from subject fixed effects (`drozy_forward.json`). Between-person variance moved from R to the anchor prior (`twin.ts` l.229-231, l.298). κ from the lag-1 autocorrelation (`twin.ts` l.95-96). Oracle added (`simulate.ts` l.93-104). | Slope heterogeneity is still treated as white noise. b is attenuated by rating noise. The released webcam models are fitted on the landmark pipeline, not the website's MediaPipe pipeline. κ for MediaPipe blink duration (2.28) is not used. See N6. The oracle is not a bound (N2). |
| M2. Circular simulation, little misspecification | **Partly resolved** | Morris framework (Sec. VI-A). Eight scenarios (Supplement S5, Table S2). Offset SD 0.84 from Ingre et al. Sensitivity to filter settings (Table S3). | The matched scenario copies the filter's noise SDs (`synth.ts` l.89-91 equal `twin.ts` l.109-111). There is no generator from a different model family. Webcam coverage is fixed at 0.9 with no missing windows (`synth.ts` l.226). PVT-B and latency noise are not simulated. There is no sensitivity to the generator's offset SD, fluctuation SD or slope SD. Scenarios break one assumption at a time; there is no combined realistic scenario. The website's real configuration (PERCLOS gated out, MediaPipe autocorrelation) is not simulated. The offset is constant within a person, contrary to ds004902 (N5). |
| M3. Comparisons not on equal terms; variant F | **Partly resolved** | Nothing is tuned; all variants use `DEFAULT_CONFIG` (`simulate.ts` l.90-106). Variant F is removed. | There is no literature baseline. "Check-ins only" is in effect the random-intercept Three-Process Model of Ingre et al. (2014); say so. The new comparator without anchors is mis-specified (N1). |
| M4. Overstated claims, selective reporting | **Partly resolved** | Table III gives all k. Coverage and width at k = 3. Night-time MAE and per-person shares at k = 3. Brier score with a person-level CI, Brier skill score, AUROC difference with a CI, reliability diagram (Fig. S4). Common random numbers. Comparisons labelled exploratory. "Never worse", "best forecasts" and "calibrated uncertainty" removed. | Coverage at other k and in the scenarios is in the files but not in the paper. It falls to 0.871 for BlinkTwin at k = 8 and to 0.768 with biased ratings. Per-person quantiles are not in the paper. No Monte Carlo SEs. The time-to-KSS-7 error is conditional on both curves crossing (minor 4). The abstract says "safely" (N3). |
| M5. DROZY: confounding, slopes, a LOSO design that did not test the twin | **Partly resolved** | Replay with the prior, a check-in, the anchors and per-fold forward models (Sec. V-C, `drozy_twin.ts`). Within-person slopes. Frame-rate confound stated. Subject-level bootstrap. Deconvolution claim removed. Non-convergence reported (Supplement S3). | The comparisons are unpaired and on different prediction sets. The replay uses landmark features. The naive baseline ties with the full model. Incremental value over the protocol time course is not tested (N3). The 30-fps-only associations with KSS are not reported (N6d). |
| M6. Blink validation overclaimed | **Partly resolved** | The MediaPipe pipeline was run on all 36 videos (Sec. V-B, Fig. 2), which is a real improvement. The wording "blink-counting logic" is used for the landmark comparison. The EOG detector is described as automatic. | No event-level sensitivity or PPV. No manual annotation. Blink duration is compared with the landmark pipeline, not with EOG (limits of agreement -107 to +93 ms). Long closures are not validated. No RGB video. The abstract still says "Webcam blink rates agreed with EOG" for near-infrared Kinect video (N9). |
| M7. Zero-blink defect | **Resolved** | `twin.ts` l.381 (`minBlinksForDuration`); `tests/sensing.test.ts` l.206. | The same class of defect now exists in the PERCLOS guard (N4). |
| M8. OpenNeuro misreported; invalid comparison | **Resolved** | SSS is no longer in the abstract. The 90/73 contrast is removed and ties are reported. CI given. Column mapping checked against the data dictionary and value ranges (Sec. V-D). The heterogeneity argument is replaced by a direct persistence test. | The lapse result (no change after a night without sleep) is still physiologically implausible. Say whether the dataset authors were contacted. The persistence test is across conditions, not across ordinary days (N5d). |
| M9. Unevaluated components | **Mostly resolved** | Workload is in Supplement S1. Alerts are renamed and called unvalidated, with exact rules. The additive decomposition is described as order dependent. Time to KSS 7 is evaluated in simulation. | No method improved the timing (about 80 min error), yet "Forecasting" stays in the title (N9). The crossing metric is conditional (minor 4). |
| M10. Constants, draft artefacts, released configuration | **Mostly resolved** | Breakpoint, U and multi-day history are in `tpm.ts` l.63-105. I reproduced the worked values 7.0, 3.7, 3.1, 5.7 and 7.7 and S_w from 11.2 to 8.9. Draft artefacts are removed. The simulation uses the released defaults. Assumed hyperparameters are labelled and their sensitivity is reported. | The linear recovery rate below the breakpoint (0.80 h⁻¹) is the value Reviewer B derived and asked the author to confirm. Supplement S2 cites "an independent reviewer" as verification (minor 8). The released webcam models are not fitted on the website's pipeline (N6c). |
| M11. Validation protocol | **Partly resolved** | Power is simulated on the primary outcome (`power.ts`). KSS is rated before the PVT with the estimate hidden (Sec. III-D, VII). Non-inferiority margin, fixed-sequence testing and calibration metrics are stated. | The margin is too lax, H2 does not test the novelty, the power estimand differs from the analysis, the laboratory phase is not sized and the study is not registered (N7). |
| M12. Novelty and related work | **Resolved** (minor residuals) | Table I lists named systems. Friedland (1969) is cited. Related work covers individualised fatigue models, model-plus-sensor fusion and browser timing. | One Table I entry breaks the table's own sourcing rule. Ahlstrom et al. (2013) is missing. Dynamic models of intensive self-report are still not cited (minor 9, 10). |

---

## 4. New major issues

### N1. The comparator without anchors is mis-specified, so "only with their own anchors" is not established

**Location.** Sec. IV-D, last sentence; `twin.ts` l.229-231, l.255, l.298; Sec. VI results and Table III; abstract (Conclusion); Discussion A.

**Problem.** In the variant without anchors, the between-person baseline variance is added to R for every observation as if it were independent noise, and no state carries it (`twin.ts` l.298). Per webcam minute this is 22.9 ms for blink duration (about 2.1 KSS points at b = 11.1 ms) and 2.38% for PERCLOS (about 3.8 KSS points). The simulator delivers a webcam minute every minute for 24 h. A persistent person-level error is therefore averaged as if it were white noise: after one hour its variance contribution is underestimated by a factor of about 60. The collapse to MAE 1.74 and coverage 0.24 follows directly. This is the error I raised in round 1 for variant D (M1b, M3b). It shows that a filter which ignores the correlation of a bias fails. It does not show that the bias must be estimated as a state.

**Required.**
- Add the fair comparator: a consider-covariance (Schmidt-Kalman) filter, which carries the bias in the covariance without estimating it, or any filter whose R reflects the persistence of the bias. I expect it to behave close to check-ins only, by down-weighting the passive data, rather than to fail.
- Report it in Table III, Table S2 and the forecast results.
- Rewrite "fusion without anchors failed" and the Conclusion accordingly. For example: treating person-level bias as white noise fails; estimating it as a state gives a small gain over ignoring the passive signals.

### N2. The "oracle" is not an upper bound

**Location.** Contribution 3 ("oracle upper bound"); Sec. VI aims and results ("oracle bound"; "the anchors recovered about 40% of the gain available"); `simulate.ts` l.93-104; `synth.ts` l.194, l.218-221.

**Problem.** The oracle is the released filter given each person's a_i and b_i, with an anchor prior SD of 1e-3. It is mis-specified in two ways:
- The generator draws the initial webcam baseline deviation from its Ornstein-Uhlenbeck (OU) drift, with SD 30 ms for blink duration and 1.8% for PERCLOS (`synth.ts` l.194). The oracle assumes this deviation is known to within 0.001.
- The oracle keeps the released noise model (independent noise inflated by κ, random-walk drift) instead of the generator's OU drift and AR(1) noise.

It is beaten in the result files:
- With autocorrelated webcam noise, the oracle gives 0.657 against BlinkTwin's 0.646 at k = 3, and 0.590 against 0.573 at k = 8 (oracle minus BlinkTwin +0.017, 95% CI +0.004 to +0.029).
- At k = 0 the oracle (0.895) is worse than the prior (0.819).

Without a bound, the 40% statement has no meaning.

**Required.** Implement the Bayes-optimal filter for the generator: augment the state with the OU drifts, the AR(1) noise states and the OU fluctuation of s*, and use the true person parameters and the correct initial covariance. Its fixed-interval smoother can serve as a looser bound. Otherwise rename the method "known-parameter filter" and drop "upper bound" and the 40% figure.

### N3. The evidence for the passive channels does not support "added safely" or the sequence in the abstract

**Location.** Abstract (Results, Conclusion); Sec. V-C and Fig. 3; Sec. VII (sample size); Discussion A.

**Problem.**

- **(a) Different prediction sets.** Conditions with a check-in are scored on 20 predictions and the others on 24. The abstract lists 1.73, 1.51, 1.47 and 1.38 as if they were one sequence. The prior's MAE on the 20-prediction set is not reported. All intervals are marginal; no paired difference is given, although a subject-level paired bootstrap is easy here.
- **(b) A tie with a naive baseline.** The protocol-aware per-test mean (1.39, n = 24) equals the full model (1.38, n = 20). Nothing in DROZY shows that the passive signals add to the protocol's time course.
- **(c) Where the gain comes from.** All of the gain over the prior is at test 2, the night test: prior 2.27, passive only 1.80, all sources 1.60. At test 3 the passive signals add nothing (1.18, 1.14, 1.16; `drozy_twin_summary.json`). At the nominal test times, with waking at 07:00, my evaluation of `tpm.ts` gives priors of 3.61, 7.81 and 7.82 against observed means of 3.25, 5.58 and 7.33. So the night test is where the prior is biased, by about 2.2 points. The forward-model intercepts are learnt on the other 13 DROZY subjects, with the same hardware, PVT and protocol. Before any check-in, part of each passive update goes to d. The passive channels therefore import DROZY's population KSS level and correct the prior's bias. This is calibration transfer within one laboratory, not tracking of within-person change. It would not transfer to a browser PVT-B whose device latency moves the reaction-time level by tens of milliseconds; on the forward model, each 18.85 ms is one KSS point.
- **(d) Not the website's pipeline.** The replay used landmark (EAR) webcam features, including landmark PERCLOS, which works. On the same video, the website's MediaPipe PERCLOS fails and would be gated out.
- **(e) The simulations point the same way.** Without check-ins, BlinkTwin is worse than the prior: 0.861 against 0.819, and 0.930 against 0.819 with autocorrelated webcam noise (difference +0.111, 95% CI +0.048 to +0.173). In the power simulation of the planned study, BlinkTwin minus check-ins averaged +0.019 KSS (SD 0.10, `power_summary.json`). Over the pool of 1000 virtual people this is about six standard errors above zero. On the study's primary outcome, adding the passive signals made predictions slightly but reliably worse. "Can be added safely" (abstract) and "without harm" (Discussion A) contradict the author's own results.

**Required.**
- Paired subject-level bootstrap differences on common prediction sets for the prior, check-in only, passive only, all sources and the naive baseline. Report the prior's MAE on the 20-prediction set.
- A replay that uses the MediaPipe per-minute features with the PERCLOS guard.
- A "protocol-aware prior plus passive signals" condition, to test incremental value over the time course.
- A sensitivity analysis without a check-in in which the RT intercept is shifted by plausible device offsets (for example +20, +40 and +60 ms).
- A per-test results table.
- Rewrite the abstract so that the conditions are not presented as one sequence, and replace "safely" with what the results show.

### N4. A code path bypasses the new PERCLOS guard

**Location.** `web/src/main.ts` l.459; `web/src/twin/twin.ts` l.380 (and the comment at l.58-59); `web/src/sensing/blink.ts` l.147; Sec. III-A, "PERCLOS guard".

**Problem.** The code path is as follows:
1. The guard uses the median peak closure of the minute's blinks. This is null when the minute has fewer than three blinks (`blink.ts` l.147).
2. `main.ts` then omits the `peakClosure` field from the stored event (l.459).
3. `twin.ts` treats a missing field as "use PERCLOS" (l.380). The comment at l.58-59 intends this only for old events, the DROZY replay and the simulation.

So on a camera whose blinks never reach full closure, which is exactly the case the guard exists for, a near-zero PERCLOS is used in every minute with fewer than three blinks. Those are minutes with long closures, staring or poor detection, so they are disproportionately the sleepiest minutes. With a = 3.24% at KSS 3 and b = 0.62% per point, a PERCLOS of 0 lies about 5 KSS points below KSS 3 on the population line. The anchor can absorb a constant level, but intermittent use in high-sleepiness minutes pulls d down. On DROZY video, 4.3% of MediaPipe minutes had no blink at all (`drozy_mediapipe_summary.json`), and minutes with one or two blinks add to that. This is the same class of defect as the round-1 zero-blink problem.

**Required.**
- Carry the camera-level guard decision across minutes (for example, from the most recent minutes with enough blinks), and treat PERCLOS as missing when the guard cannot be evaluated.
- Add a unit test for a minute with fewer than three blinks on a camera that fails the guard.
- Report, on RGB data, how often the guard is active (UTA-RLDD would do).

### N5. The offset dynamics and the prior's error structure conflict with the evidence presented

**Location.** Sec. IV-B (random-walk offset); Sec. IV-E (forecast holds the offset mean); Sec. V-C, V-D; Discussion D(i); `openneuro_anchor_summary.json`; `drozy_twin_summary.json`.

**Problem.**

- **(a) Random walk versus weak persistence.** The offset is a random walk. Its variance grows, but its mean is carried forward undiminished into every later estimate and forecast, and in the application and the protocol, into later days. On ds004902, carrying the full offset to the other session was worse than the prior (MAE 1.63 against 1.53), and a shrunk offset barely helped (1.52). A group-mean offset helped most (1.45; `rhythm_model_plus_group_offset`), and the paper does not report it. Sec. V-D argues that the growth of the variance means a check-in's information is "largely gone within a day". For the mean, the opposite holds. The data support a mean-reverting (Ornstein-Uhlenbeck) offset around a slowly learnt personal or population mean, and this should be compared with the random walk.
- **(b) The generator contradicts the persistence result.** The simulation uses a constant personal offset over the whole protocol, and the power simulation repeats the same offset on every day (`synth.ts` l.114; `power.ts` l.91-101). This contradicts the weak persistence (r = 0.29) the paper reports.
- **(c) The DROZY error is time-varying.** With two check-ins, both methods under-predict test 3 by 1.8 to 1.9 points (bias -1.90 and -1.78). This is the signature of a night-time error being learnt as an offset and carried into the next day.
- **(d) The "too steep" inference is not supported by DROZY.** Sec. V-D and Discussion D(i) conclude that the default mapping is too steep, citing DROZY in support. But on DROZY:
  - The prior's alertness is almost identical at tests 2 and 3 (A = 4.66 and 4.63 at 03:40 and 12:00 after waking at 07:00, from `tpm.ts`), while observed mean KSS differs by 1.75 points. No linear mapping can fit both.
  - The refitted mapping lowers the night prediction by only 0.27 points (7.81 to 7.54).
  - It raises the test-1 prediction from 3.61 to 4.32, against an observed 3.25.

  The DROZY night error is a problem of the prior's time course, or of the assumed wake time, not of its slope. The ds004902 gain from the refitted mapping may be real, but DROZY does not support it. Also, the ds004902 persistence test compares a rested with a deprived session. It measures a person-by-condition interaction as much as offset persistence, so "an offset learned on one day therefore carries little information to a day weeks later" overstates what it shows.

**Required.**
- Compare a random-walk with a mean-reverting offset on DROZY, ds004902 and the simulation.
- Report the group-offset result.
- Add day-to-day offset variation to the generator, calibrated to ds004902.
- Give a table of per-test prior and observed KSS on DROZY under both mappings.
- Rewrite the mapping inference and the persistence sentence.

### N6. Remaining specification problems in the measurement model

**Location.** Eq. (11)-(12); Table II; Sec. IV-C, "Fitting on DROZY"; `twin.ts` l.80-111 and l.298; `drozy_forward.json`; `synth.ts` l.89-91.

- **(a) Errors in variables.** The forward models regress each feature on the rated KSS. Ratings are integers with noise (σ_K assumed 0.75) and are near the ceiling at test 3 (mean 7.33). This attenuates b. With a within-person KSS spread of about 2 points in DROZY and rating noise of 0.75, my rough estimate of the attenuation is 10 to 15 per cent, more with the ceiling. With h = b too small, the filter over-reads every change in a feature. The simulation cannot detect this, because the generator uses the fitted b as the truth. Correct b for the reliability of within-person KSS, for example by fitting the state-space model to DROZY with s latent, or by a reliability correction, or show that the correction does not matter.
- **(b) Slope heterogeneity treated as white noise.** R contains (σ_b(ŝ - 3))², with σ_b = 14.3 ms for blink duration, which is larger than b = 11.1 ms. At ŝ = 7 this term is 57 ms per minute, more than twice σ_e = 24.6 ms. It is treated as independent across about 60 minutes per hour, although (b_i - b)(s - 3) is a persistent person-level error, with the same structure as the intercept problem of round 1. Carry it as a consider state or as a slowly varying state (for example, an extended Kalman filter with a personal slope), or show that the anchor drift absorbs it. The generator uses a blink-duration slope SD of 7 ms (`synth.ts` l.90), half the DROZY value the filter uses, so the matched scenario does not test this.
- **(c) Wrong pipeline.** The released webcam forward models (a, b, σ_e, κ, anchor SD, drift) come from the landmark (EAR) pipeline on DROZY; the website runs MediaPipe blendshapes. On the same videos:
  - MediaPipe blink duration differs from the landmark value with limits of agreement of -107 to +93 ms;
  - its lag-1 autocorrelation is 0.39, against 0.05;
  - its PERCLOS fails.

  The anchor can absorb a difference in level, not in slope, noise or autocorrelation. Refit the forward models on the MediaPipe per-minute features, which the author has already produced, or state prominently that the released webcam models are not fitted on the website's pipeline. At the least, set κ for blink duration from the MediaPipe autocorrelation (2.28, not 1.04).
- **(d) Confounded slopes and drift.** The within-person slopes and the anchor drift (taken from the between-session residual SD) are estimated from three sessions per person. These are confounded with time of day, test order and frame rate (16 of the 24 later tests were recorded at 15 fps). In the sensitivity analysis, the simulated gain disappears when the anchor drift is halved (0.657 against 0.659). The parameter on which the gain depends is therefore estimated from residuals that include a frame-rate change. Report the 30-fps-only estimates and what they imply: on that subset the within-person correlation of MediaPipe blink duration with KSS falls to 0.46 (p = 0.25; 12 tests, 5 subjects), and that of long closures to 0.33 (p = 0.42; `drozy_mediapipe_summary.json`, `excluding_15fps`).

### N7. The validation study cannot test the novel component, and its margin is too lax

**Location.** Sec. VII; `web/scripts/power.ts`; `results/power_summary.json`.

- **(a) Margin.** In the author's power simulation, the whole benefit of check-ins over the prior is 0.12 KSS points (1.005 against 0.886). A margin of 0.10 lets BlinkTwin lose 84% of that benefit and still be declared "not worse". Margins are usually set at no more than about half of the comparator's effect, and justified on practical grounds. With an expected difference of +0.019 (SD 0.10), H1 has power above 0.99 at n = 40 by construction, so it is not informative. Justify a margin of about 0.05 or less, or derive one from a minimal important difference on the KSS.
- **(b) H2 tests the check-ins, not the passive signals.** Superiority over the prior alone is driven by the check-ins, since check-ins only already beat the prior by 0.12. The paper's scientific question, whether anchored passive signals add value, is H3, and its power is below 0.01. Either state plainly that the study cannot detect a benefit of the passive channels, or redesign it. Possible designs:
  - withhold randomly scheduled probe ratings from the model and score predictions between check-ins, where the passive signals can matter;
  - make the objective outcome (the next PVT-B) co-primary.
- **(c) Estimand mismatch.** The power simulation replays each day separately (`power.ts` l.10-11). The primary analysis is a leave-future-out replay of all earlier events, across days. These are different estimands, and "conservative for BlinkTwin" is asserted, not shown; carry-over also changes the check-ins-only arm. Simulate the analysis that will actually be run, with day-to-day offset variation (N5b), realistic camera use and the website's PERCLOS behaviour.
- **(d) Unjustified sizes and rules.**
  - The laboratory phase (12 people) is not sized for any of its outcomes (alert sensitivity and PPV, KSS ≥ 7 forecasts).
  - n = 70 is interpolated; power was simulated only at 60 and 80.
  - The rule for re-estimating n after the 5-person pilot must be pre-specified, and say whether it is blinded.
  - "Leave-one-day-out cross-validation within the training days" refers to training days that the design does not define.
- **(e) Wording.** Do not call the protocol "pre-specified" until it is registered, and give the registration identifier.

### N8. The objective check is unevaluated and probably too noisy to be useful

**Location.** Sec. IV-D; Discussion C; `web/src/insights/divergence.ts` l.41-55; simulation, dissociation scenario.

**Problem.** The objective check reads the latest test through the population model: ŝ_obj = 3 + (f_RT - a_RT)/b_RT.
- Per test, the RT noise (σ_e = 36.4 ms) and the person's baseline (anchor SD 48.7 ms) together give an SD of about 61 ms, which is about 3.2 KSS points.
- Device latency adds to this, since each 18.85 ms is one KSS point, and so does the difference between the PVT-B and the 10-min PVT.
- The application flags a gap of 1.5 KSS points (`divergence.ts` l.45), so many flags will be noise, in both directions.

The simulation contains the relevant comparison: in the dissociation scenario, passive only minus check-ins at k = 3 is +0.196 (95% CI +0.147 to +0.248; `sim_summary.json`). The manuscript does not report it, although the response says it does. The dissociation scenario also barely exercises dissociation: as the paper itself notes, most check-ins fall before KSS 5 is exceeded. This display was introduced to answer a safety concern. As it stands, it may give false reassurance or false alarms.

**Required.**
- Report the expected false-flag rate of the gap rule under the matched and dissociation scenarios.
- Design a dissociation scenario in which ratings level off while the truth rises well before the later check-ins, for example chronic restriction over several days.
- Report the check's sensitivity and specificity for detecting that dissociation.
- Describe the display as experimental.

### N9. Title, abstract and conclusion still claim more than the evidence

- **Title.** "Forecasting": the time-to-KSS-7 forecast missed by about 80 min with every method, and no method improved on the prior. One-hour discrimination comes mainly from the clock (AUROC 0.945 for the prior alone). "From Webcam and Reaction-Time Signals": the estimate is driven by the prior and the check-ins. The passive signals add 0.03 points in simulation and nothing on the power simulation's primary outcome.
- **Abstract.**
  - "Webcam blink rates agreed with EOG (ρ = 0.71)": this was the website's pipeline on near-infrared Kinect video, not a webcam, and it undercounted by 13 blinks per minute (about 35%).
  - "A 3-min psychomotor vigilance test ... fitted within person on DROZY": DROZY used a 10-min PVT.
  - "Passive signals can be added safely": see N3(e).
  - "Pre-specified protocol": it is not yet registered.
- **Contribution 3 and Sec. VI.** "Oracle upper bound": see N2.
- **Discussion A.**
  - "Blink duration tracked sleepiness within person" needs the frame-rate caveat (N6d).
  - "Carried little information to a session weeks later" refers to sessions in different conditions (N5d).

---

## 5. Minor issues

1. **Length and format.** The main text is 13 pages plus a supplement, and the abstract is about 270 words. Check both against the journal's current limits. The Objective/Methods/Results/Conclusion/Significance structure is the format of a different IEEE journal; check what this journal requires.
2. **Coverage.** Report coverage and width at every k (Table III) and in every scenario (Table S2). Coverage falls with k for every method: BlinkTwin goes from 0.929 at k = 1 to 0.871 at k = 8, and the oracle from 0.886 to 0.846. At k = 3 it is 0.768 with biased ratings and 0.859 with misreported sleep. Discuss why the interval narrows faster than the error. The random-walk q_d is the only source of model noise for d, while the truth contains an OU fluctuation.
3. **Per-person results and Monte Carlo error.** Per-person quantiles of the paired differences (p05, p50, p95) are in `sim_summary.json` but not in the paper; add them to Table S2. Report Monte Carlo SEs, at least for coverage, as Morris et al. recommend.
4. **Time to KSS 7.** The MAE is conditional on both the forecast and the truth crossing, which happened for 288, 255 and 257 of 300 people (prior, check-ins, BlinkTwin). The methods are therefore scored on different subsets. Report hits, misses and false crossings, and a censored error measure.
5. **Results the paper does not mention.** Table S2 omits k = 1 and k = 8. With autocorrelated webcam noise, BlinkTwin is worse than check-ins only at k = 1 (+0.016) and k = 8 (+0.002). In the matched scenario it is worse at night at k = 1 (+0.011). Report these.
6. **Channel ablation.** Add PVT-only and webcam-only runs to the simulation; `useChannels` already exists in the configuration.
7. **Defaults.**
   - σ_d stays at 1.2, although the generator and Ingre et al. use 0.84 and the sensitivity analysis favours 0.84 (0.614 against 0.629).
   - σ_K = 1.0 gave a lower MAE than 0.75 (0.618 against 0.629).
   - √q_d = 0.15 gave a lower MAE but under-covered (0.81).

   State the rule by which the defaults were chosen; MAE and calibration trade off here.
8. **Three-Process Model sources.** Confirm the linear recovery rate below the breakpoint against Åkerstedt et al. (2008) and Ingre et al. (2014); Reviewer B left this to the author. Remove "All were checked by an independent reviewer" from Supplement S2; a referee report is not a source.
9. **Table I sourcing.** `docs/LITERATURE_COMPARISON.md` grades the Subramaniyan et al. numbers (error 36 ms, SE 5; cross-validated) as "P" (a paraphrase by a search tool). That breaks the rule stated in `table-comparison.tex` that only verbatim numbers are used. The same document says no full text could be opened. Verify every Table I number against the full text, give DOIs, and check the validation scheme of Maior et al. (graded Q/S).
10. **References.**
    - The Sandberg et al. claim in Sec. II-C is plausible.
    - I found no reference that is wrong for the claim it supports.
    - Add:
      - Ahlstrom et al., *Transp Res Part C* 2013;26:20-32. The Sleep/Wake Predictor plus an eye-movement test, used to predict KSS: the closest model-plus-eyes forecast, already in the author's own comparison document.
      - Bryson and Henrikson, *J Spacecraft Rockets* 1968;5:662-665, on sequentially correlated measurement noise (relevant to κ).
      - Schmidt, *Adv Control Syst* 1966;3:293-340, on consider states (N1, N6b).
      - Piaggio et al., *JAMA* 2012;308:2594-2604, the CONSORT extension for non-inferiority trials (N7).
      - Carroll et al., *Measurement Error in Nonlinear Models*, 2nd ed., 2006 (N6a).
      - Asparouhov, Hamaker and Muthén, *Struct Equ Modeling* 2018;25:359-388, on dynamic models of intensive self-report (my round-1 M12).
11. **Privacy check.** The network check used a fake camera that showed no face, and the 1-min test (`privacy_check.json`), so the landmark and blendshape path never ran. Repeat it with a recorded face video as the fake camera input.
12. **Individual data.** Fig. 2C and Fig. S1 show one line per subject. This conflicts with "only aggregate results" (Sec. V introduction; Data availability) and with the Fig. S1 caption "Aggregate statistics only". Check this against the DROZY licence.
13. **DROZY replay details.** Only a, b and the anchor SD are refitted in each fold (`drozy_twin.ts` l.69, l.85); σ_e, κ, the drift and the slope SD come from all 14 subjects. State this or refit them. Also say when DROZY's KSS was collected relative to the PVT, with a source; the replay places it 11 min after the start of the test.
14. **Figures.** Colour Fig. 2C by frame rate. In Fig. 3, plot paired differences on common prediction sets (N3).
15. **PERCLOS model.** The PERCLOS forward model ignores the floor at zero. With a = 3.24% and σ_e = 2.4%, the Gaussian model puts a noticeable share of minutes at KSS 3 below zero; the simulator clips at zero. Comment on this, or model the floor.
16. **ds004902 details.**
    - The 18% and 9% split of unchanged and falling KSS, and the method behind the Spearman CI (-0.17 to 0.59), are not in `openneuro_summary.json`; add them.
    - Give a disattenuated persistence correlation.
    - Flag the lapse result as implausible, and say whether the dataset authors were contacted.
17. **Wording in Sec. VI.**
    - "The truth and the signals are identical across k": the PVTs after check-ins differ by k (`simulate.ts` l.10-11).
    - "18 settings": there are 13 distinct settings; the default is repeated six times.
18. **Lapse threshold.** Sec. V-A, "0.73 for lapses": state that the threshold is 500 ms (`lapses500`), because Sec. III-C defines lapses at 355 ms.
19. **Keywords.** "Digital twin" is still a keyword, although the paper itself now uses "state-space model". Consider dropping it.

---

## 6. Number checks

### 6.1 Numbers that match

I checked every number in the abstract, Sections V and VI, Tables I to III, the protocol's sample-size paragraph, Sec. III-F and the supplementary tables against the result files.

- **Abstract.** 1.73, 1.51, 1.47, 1.38, 1.39, ρ = 0.71, r = 0.58, r = 0.29, 1.69 to 1.46 and 0.03 all match `drozy_twin_summary.json`, `drozy_mediapipe_summary.json`, `openneuro_anchor_summary.json`, `openneuro_prior_summary.json` and `sim_summary.json`.
- **Section V.** These all match:
  - DROZY test means and frame-rate counts;
  - repeated-measures correlations and df;
  - forward-model slopes and autocorrelations;
  - EOG agreement (0.88, 0.89, -5.4, -19.1 to +8.3);
  - MediaPipe face rate, agreement, undercount, limits of agreement, within-person correlations, PERCLOS failure statistics and the 30-fps ρ;
  - all replay MAEs, biases, per-test MAEs, wake-time sensitivities and naive baselines;
  - all ds004902 effect sizes, persistence statistics and prior comparisons.
- **Section VI.** All MAEs, CIs, paired differences, shares, coverage, widths, sensitivity ranges, Brier scores, skill scores, AUROCs and crossing errors match `sim_log.txt` and `sim_summary.json`.
- **Tables.** Table III matches `sim_log.txt`. Table II matches `DEFAULT_CONFIG`, `TPM_DEFAULTS` and `drozy_forward.json`. The BlinkTwin rows of Table I match the result files. Tables S2 and S3 match `sim_log.txt`.
- **Sample size.** The mean errors 1.00, 0.89 and 0.91, the differences +0.019 (SD 0.10) and -0.100 (SD 0.31), and the powers 0.92, above 0.99, 0.52, 0.75, 0.88 and below 0.01 match `power_summary.json`.
- **Other.** Sec. III-F (20 fps, 26 ms, 84 ms) matches `benchmark.json`, and the 105 unit tests pass. The worked prior values in Sec. IV-A reproduce from `tpm.ts`. Fig. 4A's "1.65 to 1.78" matches.

### 6.2 Mismatches, omissions and values not in the result files

| # | Location | Manuscript says | File and field | File shows | Type |
|---|---|---|---|---|---|
| 1 | Sec. V-C, Design (`05-realdata.tex` l.31) | "20 predictions from 10 subjects, against 24 from 12 subjects" | `drozy_twin_summary.json` n = 20 and 24, combined with the inventory of the 36 tests | 20 predictions come from 11 subjects; 24 come from 13 (two subjects have no first test, and one has only the first test). The inventory reproduces n = 20, 24 and 9 exactly. | Subject counts (please check) |
| 2 | Sec. V-A (l.10) and Sec. V-B (l.20) | Lag-1 autocorrelation of landmark blink duration: 0.02 (V-A) and 0.05 (V-B) | `drozy_forward.json` `lag1_autocorrelation.blink_ms`; `drozy_mediapipe_summary.json` `lag1_autocorrelation_per_minute.ear_mean_blink_ms` | 0.018 and 0.053 (landmark PERCLOS: 0.318 and 0.389) | Two values for one quantity |
| 3 | Abstract | "OpenNeuro ds004902 (33 adults) ... lowered the prior's error from 1.69 to 1.46" | `openneuro_prior_summary.json` `n_with_diary` | 1.69 and 1.46 are computed on 28 people | Sample size |
| 4 | Sec. V-D | "observed 2.04" after "KSS rose by 2.03 points (n = 33)" | `openneuro_prior_summary.json` `observed_change_mean`; `openneuro_summary.json` `paired.kss.diff_mean` | 2.036 (n = 28) and 2.030 (n = 33) | Unlabelled n |
| 5 | Supplement S5; Sec. VI ("population distributions come from DROZY") | Slope SDs "using the DROZY values of Table II (... 8 ms, ... 7 ms, ... 0.3%)" | Table II and `twin.ts` `slopeSd`; `drozy_forward.json` `slope_sd_raw`; `synth.ts` l.89-91 | Table II and the DROZY fit give 7.9, 14.3 and 0.47; the generator uses 8, 7 and 0.3 | Text against code; the generator halves the blink-duration value |
| 6 | Sec. VII | "analyse 70 participants (power for H2 about 0.80)" | `power_summary.json` `power` | Simulated at n = 60 (0.745) and n = 80 (0.880) only | Interpolated |
| 7 | Contribution 3; Sec. VI aims and results | "Oracle upper bound"; "recovered about 40% of the gain available" | `sim_summary.json` `mae`, scenario `autocorr`; `comparisons` | Oracle 0.657 against BlinkTwin 0.646 (k = 3); oracle minus BlinkTwin +0.017 [+0.004, +0.029] at k = 8; oracle 0.895 against prior 0.819 at k = 0 | Claim contradicted |
| 8 | Response to Reviewer B, M4 | Dissociation scenario reported "including what the objective channel shows (Section VI)" | `sim_summary.json` `comparisons`, dissociation `twin_k0 - checkins_k3` | +0.196 [0.147, 0.248]; not in the manuscript | Response against manuscript |
| 9 | Sec. VI, forecasts | "missed by about 80 min with every method (prior 79, check-ins 84, BlinkTwin 81 min)" | `sim_summary.json` `forecast[*].crossing_n` | 288, 255 and 257 of 300; each method scored on a different subset | Comparability |
| 10 | Sec. V-B (l.20) | "Restricting to the 20 tests recorded at 30 frames per second gave similar agreement with EOG (ρ = 0.83)" | `drozy_mediapipe_summary.json` `excluding_15fps` | Agreement matches, but KSS associations at 30 fps are not reported: blink duration r = 0.46 (p = 0.25), long closures r = 0.33 (p = 0.42) | Selective reporting |
| 11 | Sec. V-D | Prior, shrunk and full offsets reported | `openneuro_anchor_summary.json` `rhythm_model_plus_group_offset` | 1.45, better than all reported alternatives | Omission |
| 12 | Sec. VI, DGM (l.9) | "the truth and the signals are identical across k" | `simulate.ts` l.10-11; `sim_summary.json` `common_random_numbers` | Truth, webcam and 2-hourly PVTs are identical; PVTs after check-ins differ | Wording |
| 13 | Sec. VI, Sensitivity | "18 settings" | `sim_sensitivity.csv` | 18 rows, 13 distinct settings | Wording |
| 14 | Sec. V-A (l.10) | "0.73 for lapses" | `drozy_summary.json` `rmcorr_with_kss.lapses500` | Lapses at 500 ms; Sec. III-C defines lapses at 355 ms | Definition |
| 15 | Table I, Subramaniyan et al. row | "Error 36 ms (SE 5) ...; Cross-validated" | `docs/LITERATURE_COMPARISON.md`, Sec. 3 | Graded "P", which the table's own rule excludes | Sourcing |
| 16 | Supplement S2 | Constants "checked by an independent reviewer" | `round1-reviewer-B.md`, Three-Process Model table | The linear recovery rate was left "to be confirmed by the authors" | Source |
| 17 | Sec. V-D | "stayed the same in 18% and fell in 9%"; "approximate 95% CI -0.17 to 0.59" | `openneuro_summary.json` | Not in the file. Consistent with 6 and 3 of 33 people and with a Fisher-z interval using a Bonett-Wright SE, but add both to the file. | Not traceable |

---

## 7. Readiness for a Q1 venue

The paper is now a careful, transparent and reproducible methods study. Its honest bottom line is that the prior and the check-ins carry the information, and that the passive channels add little or nothing on real or realistic data. That can be a publishable message. But at present the paper still presents the anchored passive fusion as its main contribution, on evidence that does not carry it. For this journal, a system paper whose sensing component has not been tested on the sensor the system uses (an RGB laptop webcam) will struggle.

### 7.1 What can be done now with existing data and code (in order of priority)

1. **Fix the PERCLOS-guard bypass** (N4), add the test, and re-run everything that uses the webcam channel.
2. **Correct the simulation's comparators** (N1, N2). Add a consider-covariance filter without anchors and a Bayes-optimal oracle for the generator, then restate the anchoring conclusion.
3. **Rebuild the DROZY replay** (N3) with:
   - paired subject-level differences on common prediction sets;
   - MediaPipe per-minute features and the guard;
   - a protocol-aware prior plus passive signals;
   - device-offset sensitivity for the RT intercept;
   - the refitted KSS mapping;
   - per-test prior and observed values;
   - a 30-fps-only sensitivity analysis.
4. **Compare a mean-reverting offset with the random walk** (N5) on DROZY, ds004902 and the simulation. Report the group-offset result.
5. **Add a "website-realistic" combined scenario** to the simulation:
   - PERCLOS gated out;
   - MediaPipe autocorrelation, with κ set accordingly;
   - PVT-B latency jitter and device offsets;
   - intermittent camera use with missing windows;
   - day-to-day offset variation calibrated to r ≈ 0.3;
   - rating bias.

   Also add a generator from a different model family (for example, ordinal ratings with person-specific thresholds), sensitivity to the generator's offset, fluctuation and slope SDs, channel ablation, and coverage at all k and in all scenarios.
6. **Address the measurement model** (N6): refit the webcam forward models on the MediaPipe features, correct b for rating noise, and treat slope heterogeneity as persistent.
7. **Validate against EOG on DROZY**: blink duration and long closures at event level, with manual annotation of a random subset of minutes (Section 7.2, item 5).
8. **Run the website pipeline on UTA-RLDD** (consumer RGB video). Report how often the PERCLOS guard is active, blink-rate distributions and the association with the self-labelled classes. This is the only existing public test of the actual sensor path.
9. **Redesign and register the protocol** (N7): a justified margin, matching estimands, a hypothesis that can detect a benefit of the passive channels, a sized laboratory phase, and a registration identifier.
10. **Rewrite the title, abstract, contributions and conclusion** to match the results (N9).

### 7.2 What needs new data

1. RGB laptop-webcam recordings with simultaneous EOG (and ideally EEG), including downward gaze, reading and typing. This is needed to validate the website's blink, PERCLOS and long-closure measures and the alerts. It is the protocol's laboratory phase.
2. Device and browser latency measurements, and a forward model fitted on the 3-min PVT-B rather than the 10-min PVT.
3. Field data from the actual application, to test the model on the population and use case it is built for.
4. EOG blink durations and manual annotation of DROZY, if the archive becomes accessible again. DROZY is public under its licence, so this is existing data in principle.

### 7.3 Now or after the prospective study?

In my view the paper should come to this journal after at least the laboratory phase of the prospective study, and preferably with the field pilot. Without RGB-webcam data against a reference, the webcam half of the system remains untested, and the DROZY evidence for the passive channels is too thin to carry the claims.

If the author prefers to keep the present scope, the items in Section 7.1 are the minimum for another round. In that case the paper must be reframed as a state-space method evaluated in simulation and on two small public datasets, with the passive channels presented as an open question rather than a contribution. The protocol could be registered and published separately now; that would also make the later validation paper stronger.

## 8. Recommendation

**Major revision.**

The revision is a large step forward, and most of my round-1 points have been addressed in substance. The paper is still not acceptable, for four reasons:
- The main conclusion about anchored fusion rests on a mis-specified comparator and a "bound" that is not a bound.
- The real-data comparison is unpaired, on different prediction sets and on a different feature pipeline, and is tied by a naive baseline.
- The author's own power simulation contradicts "added safely".
- A new code path defeats the PERCLOS guard.

None of these needs new data to fix. If the next version does not resolve N1 to N4 and N7, and does not bring the claims into line with the evidence, I would recommend rejection with encouragement to resubmit after the laboratory phase of the prospective study.

Reviewer A
