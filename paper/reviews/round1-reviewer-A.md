# Referee report, round 1: Reviewer A

**Manuscript:** BlinkTwin: a browser-based personal digital twin of sleepiness and cognitive load, calibrated with validated questionnaires

**Reviewer expertise:** biomedical signal processing, Bayesian state-space modelling, statistics

**Materials checked:** LaTeX sources (`paper/main.tex`, `paper/sections/*.tex`), compiled PDF, code (`web/src/twin`, `web/src/sensing`, `web/src/sim`, `web/scripts/simulate.ts`, `web/scripts/drozy_eyes.ts`, `analysis/*.py`, `web/tests`) and result files (`results/*.json`, `results/*.csv`, figures). I did not access raw data. Some of the checks below are my own quick re-analyses of the authors' derived per-test files in `results/`. I label them as such. They are indicative only.

---

## 1. Summary of the paper

The manuscript presents BlinkTwin, a browser application that estimates a person's momentary sleepiness (on the KSS scale) and workload (on the NASA-TLX scale). It combines a Three-Process Model prior, KSS and NASA-TLX check-ins, a 3-minute PVT-B and webcam eyelid features in a three-state Kalman filter: one offset from the prior plus one additive bias per passive channel (the "questionnaire anchoring"). Population mappings from reaction time and eye features to KSS were fitted on DROZY (14 subjects, 36 sessions). DROZY was also used to compare the blink-counting logic against an EOG-based blink detector. OpenNeuro ds004902 is used to argue that objective and subjective responses to sleep loss are only weakly coupled across people. The main quantitative evidence is a simulation of 300 virtual participants over 24 h awake. In it, three check-ins reduce latent-KSS error by about 31% relative to the prior. Passive signals without bias states give no gain and under-cover. Passive signals with bias states give small gains (0.02 to 0.03 KSS points) and the lowest Brier score for a one-hour forecast. Learning personal slopes hurts, and a one-check-in recalibration did not beat the population mapping in DROZY. A prospective validation study is pre-specified.

## 2. Overall assessment and recommendation

**Strengths.** The paper is clearly written. It reports negative results openly (personal slopes, DROZY calibration), and the event-replay architecture makes every displayed number reproducible from a log. The same code runs the website, the tests and the simulation. Unit tests even check that the science text quotes the result files correctly. Almost every number in the manuscript matches the result files (Section 5 lists the few exceptions). The parameter table and the equations match the code exactly.

**Weaknesses.** The central claims rest on a simulation whose generator shares the filter's structure. Latent sleepiness is defined as what a KSS rating measures, and passive channels differ from the truth by exactly the additive person-level biases that the filter models. So "check-ins carry most of the information" and "anchoring is necessary" are largely properties of the generator. The passive-channel measurement model is an inverse (calibration) regression whose error depends on the state. This produces strongly attenuated pseudo-observations, which are then patched with a variance inflation of 160 that the manuscript attributes to autocorrelation. My check finds no basis for that attribution. Baselines were not tuned on equal terms. Several headline claims ("never worse", "best forecasts", "calibrated uncertainty") are not supported once per-person results, night-time error, coverage at all k and sampling uncertainty are considered, and all of these are already in the result files. The DROZY analyses are confounded by session and by video frame rate, and the leave-one-subject-out design does not test the twin. A rough re-analysis of the authors' own per-test file suggests the twin-like structure may actually help in DROZY. The blink validation covers the counting logic on a different input signal, for a feature the twin does not use. The abstract misreports the OpenNeuro coupling result. The code has a correctness problem in the webcam path. The workload model, the alarms and the time-to-KSS-7 forecast are listed as contributions but are not evaluated. The compiled PDF still contains a "To check before submission" box saying that the prior's constants are unverified.

**Recommendation: major revision.** The paper is not acceptable in its current form. For a journal of this level I would expect at least the following. (i) A measurement model that is valid for a Kalman filter, or a strong justification of the current one. (ii) An evaluation of the actual released twin on real data. DROZY replay with the TPM prior is feasible now. (iii) Misspecification experiments in the simulation, with tuned baselines. (iv) A substantial toning down of the abstract, contributions and conclusion. If the authors cannot provide (ii), the work would be better framed as a software and simulation-methods paper with much more modest claims.

---

## 3. Major issues

### M1. The passive-channel measurement model is mis-specified for a Kalman filter

**Location.** Sec. 4, "Observations" and population mappings (`04-model.tex` l.48–54); Table 2; `web/src/twin/twin.ts` l.292–305; `web/scripts/simulate.ts` l.95–138.

**Problem.** Each passive reading enters as z = E[KSS | features] − p(t) − γT with R = σ² + uᵀΣu, where E[KSS | features] comes from a regression of KSS on the feature. This is an inverse (calibration) regression. Its error is not independent of the state. Because of regression dilution, μ − s ≈ −(1 − λ)(s − s̄) + noise, so the error is negatively correlated with the true deviation of sleepiness from the population mean. A constant bias state cannot absorb an error that depends on the state. The authors' own files show how large the effect is:

- **Simulation.** The generator's within-person slope is r₁ = 18.8 ms per KSS point, about 5.3 KSS points per 100 ms. The PVT mapping fitted on the training cohort has a slope of 1.40 per 100 ms (`sim_summary.json`, `population_mappings.pvt.mean[1]`). A true 1-point rise in sleepiness therefore moves the reaction-test pseudo-observation by only about 0.26 points.
- **DROZY.** Per-subject slopes of KSS on RT average 4.79 per 100 ms (range 2.5 to 7.5; `drozy_summary.json`, `per_subject_slopes`). The random-intercept slope used as the default is 2.22. A fixed-effects (within-subject) slope I computed from `results/drozy_sessions.csv` is 3.18, against a pooled OLS slope of 1.68. Figure 2 (middle) shows the same thing: steep within-person lines with shifted baselines.

The consequences are serious:

- (a) Passive signals systematically under-track change, which is exactly the role "passive signals track change" assigns to them.
- (b) Between-person intercept variance is counted more than once. It appears in Σ (intercept prior SD 1.136 for DROZY, 1.30 in the simulation), again in the bias state (σ_β = 1.2) and, in the simulation, a third time in σ (the SD of pooled OLS residuals, `simulate.ts` l.135–136). In R it is treated as white noise, although it is a persistent person-level error.
- (c) The manuscript justifies κ = 160 by "the strong autocorrelation of successive one-minute windows". But the simulator draws per-minute camera noise independently given s* (`synth.ts` l.163–166). In DROZY's per-minute results (`drozy_eye_minutes.csv`), my quick estimate of the pooled within-test lag-1 autocorrelation is 0.32 for PERCLOS, 0.04 for blink duration and 0.16 for blink rate. Under an AR(1) model these values imply an inflation of about 1 to 2, not 160. κ is therefore absorbing model misspecification, not autocorrelation.
- (d) The conclusion that "the webcam adds little" (Sec. 6) cannot be separated from this modelling choice. With independent per-minute noise of about 1.7 KSS units and 50 windows per hour, a correctly specified filter should extract much more from the simulated webcam than the current one does.

**Required fix.**
- Use a forward measurement model: feature = a_i + b·s + e, with a_i the channel bias state and b the within-person slope, optionally person-specific. Each observation is then linear-Gaussian in the state, with h = b. Otherwise, give a formal argument for the inverse form and at minimum use within-person (person-mean-centred) slopes and remove between-person variance from R.
- Add an oracle analysis (a filter given each virtual person's true forward parameters) to show how much information the simulated passive signals contain.
- Derive κ, or an explicit AR noise model, from the empirical autocorrelation.
- Re-run all comparisons.

### M2. The simulation is largely circular, and misspecification is minimal

**Location.** Sec. 6 Design, Table 3; `web/src/sim/synth.ts` l.152–180; Limitations (`09-discussion.tex` l.16).

**Problem.** The ground truth is s* = p_φ + o + γ*T + ε. The simulator and the twin share all of the following:

- the TPM constants;
- the sleep history (07:00 after 7.5 h, which is also the twin's default);
- a mean γ* equal to the twin's γ;
- an additive personal offset that matches the twin's offset state;
- additive person-level channel intercepts that match the bias states;
- the rating model. KSS ratings are unbiased s* + N(0, 0.7), rounded, giving an effective SD of about 0.76, while the twin assumes σ_K = 0.75.

Per-minute camera noise is independent given s*, with fixed coverage of 0.9 and no missing windows. Because latent sleepiness is defined as exactly what a KSS rating measures, the advantage of check-ins and of anchoring passive channels to them is built in. Misspecification is limited to a circadian phase shift (SD 1 h), spread in γ*, an Ornstein–Uhlenbeck term and the PERCLOS hinge. Only one protocol is simulated: a night of total sleep deprivation with a fixed 50/10 schedule and known sleep. The stated use case, an ordinary working day at a laptop, is not simulated. The headroom for the 31% figure is set by the offset SD (1.0) and the fluctuation SD (0.5), which are assumptions, not data.

**Required fix.** Report the simulation using a formal framework (aims, data-generating mechanisms, estimands, methods, performance measures; e.g., Morris, White and Crowther, *Stat Med* 2019), with Monte Carlo standard errors. Add misspecification scenarios, at least:

- person-specific TPM parameters (homeostatic rate, circadian amplitude);
- a wrong or missing sleep entry;
- a normal 16-h day and partial sleep restriction;
- KSS scale-use bias, non-linearity and person-specific rating noise;
- channel biases that drift within the day (lighting, posture, device);
- autocorrelated, heavy-tailed camera noise and missing windows (coverage below 0.6);
- the larger noise of a 3-minute PVT-B plus device latency;
- a generator from a different model family.

Report how sensitive each main result is to the offset SD, the fluctuation SD and the rating noise. Also report sensitivity to the hand-set filter hyperparameters (σ_d, q_d, σ_β, q_β, σ_K, γ), of which only κ was tuned.

### M3. Comparisons between variants are not on equal terms; variant F is confounded by its implementation

**Location.** Sec. 6 Cohorts and Variants; `simulate.ts` l.141–162, l.175–183; `twin.ts` l.267–278.

**Problem.**
- (a) κ was tuned on the tuning cohort only for the anchored configuration (variant E, at k = 3; `UNTUNED` in `simulate.ts` l.141, l.152) and then applied unchanged to C, D and F. The "naive fusion" variants may have a different optimum, and their reaction-test channel has no inflation at all. Some of D's loss of calibration may therefore be a tuning artefact.
- (b) D's R treats between-person intercept variance as independent noise, an overconfidence that a fair baseline would correct.
- (c) Variant F updates the full mapping, intercept included, by Bayesian linear regression from the same check-in that already updates d and, through earlier reaction-test updates, β_P. The same discrepancy is therefore corrected twice. F also pairs a check-in with a single 1-minute camera window, while the mapping was fitted on 15-minute averages (`simulate.ts` l.117–121), which is an errors-in-variables problem. And the predictive variance shrinks as the regression learns, so the channel gains weight as it becomes more biased. The negative result for personal slopes may be an artefact of this implementation rather than evidence that slope learning cannot help. This matters because ds004902 (see M8) is really an argument for personal slopes.
- (d) There is no comparison with an established approach, such as Bayesian individualisation of a two-process model (Van Dongen et al., *Sleep* 2007; Rajaraman et al., 2008) or a simple heuristic bias correction.

**Required fix.**
- Tune κ, and any inflation of the reaction-test channel, separately for each variant on the tuning cohort, with a pre-stated objective.
- Implement F so that slopes are learned while intercepts are left to the bias states, or as a joint state with slope and bias.
- Add at least one baseline from the literature.

### M4. Simulation claims in the abstract, contributions and conclusion are overstated; reporting is selective

**Location.** Abstract (`00-abstract.tex` l.8, l.10); Contribution 2 (`01-introduction.tex` l.19); Sec. 6 l.76–86; Discussion l.4; Conclusion (`09-discussion.tex` l.29).

**Problem.** Everything below is already in the result files.
- **"Never worse than check-ins alone."** This rests on point estimates. Paired CIs exist only at k = 1, 3 and 8, and the k = 8 CI includes zero. Per person, the anchored twin beat check-ins alone for only 50% of virtual participants at k = 1, 54% at k = 3 and 48% at k = 8 (`sim_summary.json`, `comparisons[*].share_a_better`). It was worse for about half of them.
- **Night time.** `sim_mae.csv` contains `night_mae` (23:00–07:00), which is not reported. At night the anchored twin is worse than check-ins alone for k = 4, 6 and 8 (0.638 vs 0.620, 0.568 vs 0.549, 0.587 vs 0.577), and this is the period that matters most for safety.
- **Coverage.** Table 4 shows coverage only at k = 1, where E (0.913) is closest to nominal. At larger k, E under-covers and does so more than B: 0.867 vs 0.887 at k = 4, 0.879 vs 0.895 at k = 6 and 0.872 vs 0.890 at k = 8. "Forecast sleepiness with calibrated uncertainty" (abstract) and "coverage close to nominal" do not hold in general. Coverage without interval width is also incomplete.
- **Forecasts.** The Brier scores of 0.062, 0.065 and 0.067 have no uncertainty attached. The 5,400 forecasts are 18 per person and therefore clustered. AUROC is identical for E and B (0.9643 vs 0.9643). The rhythm model alone reaches an AUROC of 0.923, so discrimination comes mostly from clock time. "Best one-hour forecasts" is not supported.
- **Passive only.** "Passive signals help a little on their own": passive-only beat the rhythm model for only 53% of people.
- **Practical size.** The gain of E over B (0.02 to 0.03 KSS points) is about 1/30 of a scale step and far below the rating noise. Sec. 6 says this, but the abstract, Contribution 2 ("shown to be necessary") and the Conclusion present it as a key result.
- **Pairing across k.** Every k uses a different simulator seed (`simulate.ts` l.269: `5000 + 31·id + k`). The truth trajectory, fluctuations and all noise therefore differ across k. The headline "paired difference" between three check-ins and the rhythm model (Sec. 6 l.76) is paired only on person-level parameters, not on the same realisation. The caption of Table 4 explains the non-monotonicity in k by check-in times alone.

**Required fix.**
- Report all k with coverage, mean interval width and an interval score or PIT histogram, plus night-time MAE.
- Show the distribution of per-person differences (quantiles, share worse by more than 0.1).
- Give person-level paired bootstrap CIs for differences in Brier score and AUROC, the Brier skill score against the rhythm model, reliability diagrams and time-stratified discrimination.
- Pre-specify a non-inferiority margin for "not worse".
- Control multiplicity or label the comparisons as exploratory.
- Use common random numbers across k.
- Rewrite the abstract, Contribution 2, the Discussion and the Conclusion to match.

### M5. DROZY analyses: confounding, between/within slopes, and a leave-one-subject-out design that does not test the twin

**Location.** Sec. 5.1 (`05-grounding.tex` l.7–17); `analysis/drozy_analysis.py`.

**Problem.**
- **(a) Confounding by session.** KSS, RT, PERCLOS and blink duration all rise with test number (KSS by 2.0 points per test, `kss_per_test_step`). The mixed models KSS ~ feature have no session term, and the repeated-measures correlations also mostly reflect the shared time trend. What matters for the twin is whether a feature adds information beyond the time-awake prior. That is not tested.
- **(b) Confounding by frame rate.** In `drozy_sessions.csv` all 12 recordings of test 1 are at about 30 fps, but 8 of 12 for test 2 and 8 of 12 for test 3 are at about 15 fps. That is 16 of 36 tests; the text says "15 for some tests". At 15 fps, blinks shorter than about 67 ms are missed and durations are quantised, which can raise mean blink duration and change PERCLOS. Mean blink duration was 232 ms in the low-fps tests and 203 ms in the high-fps tests. The eye–KSS associations and the default webcam mapping may be partly frame-rate artefacts.
- **(c) Between- and within-person slopes are mixed.** See M1. The random-intercept slope blends the two associations. Because the bias state absorbs a person's level, the twin needs the within-person slope.
- **(d) The leave-one-subject-out analysis does not test BlinkTwin.**
  - The "population model" is pooled OLS (`drozy_analysis.py` l.211, l.215), not the random-intercept mapping of Table 2.
  - The "shrinkage factor that BlinkTwin's Kalman update applies" is τ²/(τ² + σ²) from a mixed model, about 0.34 (l.213–214). The twin's actual check-in gain on d is σ_d²/(σ_d² + σ_K²), about 0.72, and the twin does not shift the RT intercept directly.
  - There is no TPM prior and no bias state.

  As a rough check, I re-ran a leave-one-subject-out analysis on `results/drozy_sessions.csv` (same 22 predictions).
  - Predicting each later test by the training subjects' mean KSS for that test, a crude time-awake prior, gives an MAE of 1.42.
  - Adding a shrunk offset from the first test gives 1.37 to 1.42.
  - Adding the within-person change in RT (slope estimated on the training subjects after removing session means) gives 1.11 to 1.22, depending on the check-in gain (0 to 1).

  The manuscript's numbers are 1.68 for the population RT mapping and 1.90 to 2.36 for the calibrated versions. With n = 13 this is only indicative. But it suggests the negative DROZY result reflects the comparison design (no prior, pooled slope), and that the structure of the twin (prior + offset + within-person change in a passive channel) may help. Notably, in this check the reaction-time change adds more than the check-in, which is the reverse of the simulation's conclusion.
- **(e) Inference.** statsmodels MixedLM reports Wald z-tests, which are anti-conservative with 14 clusters. The Wilcoxon tests on 22 predictions nested in 13 subjects ignore the clustering. The repeated-measures correlations have no CIs, and five features are tested with no multiplicity control. The random-intercept model for blink rate also failed to converge (`drozy_summary.json`, `converged: false`), which is not reported.
- **(f) Per-subject slope variance.** "Deconvolving" per-subject slope variance with three points per subject (1 residual df) is not reliable. "No between-person variance left after removing estimation noise" is not supported.
- **(g) Eye features out of sample.** The population eye model (MAE 1.94) barely beats predicting a constant (2.04), and RT plus eyes (1.82) is worse than RT alone (1.68). "The eye features behaved the same way" hides this.

**Required fix.**
- Replay the released twin on DROZY: TPM prior from the DROZY session clock times and sleep schedule, check-in at test 1, bias states, mappings fitted leave-one-subject-out.
- Estimate within-person slopes with person-mean centring, and test incremental value over session or prior.
- Remove the frame-rate confound by downsampling the 30-fps recordings to 15 fps and re-running the blink meter, or at least adjust for frame rate.
- Use small-sample inference (Kenward–Roger or Satterthwaite, or a cluster bootstrap), and give CIs for the repeated-measures correlations.
- Report the eye-feature leave-one-subject-out results, and revise the text.

### M6. The blink validation is overclaimed and incomplete

**Location.** Abstract l.6, l.8; Contribution 6; Sec. 5.1 l.9, l.11; Discussion "What is new"; Conclusion.

**Problem.**
- **(a) Input signal.** The pipeline the website uses (MediaPipe blendshapes from an RGB webcam) was not validated. What is shared is the thresholding logic, applied here to an EAR score from 68-point near-infrared Kinect landmarks, rescaled within each test between its 90th and 1st percentiles (`drozy_eyes.ts` l.65–68). "We validated the website's blink detector" should read "the blink-counting logic".
- **(b) Reference standard.** The reference is an automated EOG peak detector. Its polarity was fixed after inspecting recordings (`drozy_eog.py` l.44–46), and no events were manually annotated. Per-test EOG rates of 41 to 73 per minute (`drozy_eog.csv`) are high for a vigilance task, which suggests possible false detections. The two detectors may share errors.
- **(c) Level of agreement.** Agreement is reported at test level for blink rate only (n = 36 from 14 subjects). The between-subject range of 7 to 72 per minute inflates the correlation. From `drozy_sessions.csv`, I find a within-subject correlation of about 0.85 (35 tests, 13 subjects). That is reassuring and should be reported.
- **(d) Features the twin uses.** The twin does not use blink rate for sleepiness. It uses blink duration and PERCLOS, and neither was validated. EOG peak widths are already computed (`drozy_eog.csv`). A quick rank correlation with landmark blink duration is about 0.79, but this needs proper analysis given the frame-rate confound (M5b).
- **(e) Events and alarms.** There are no event-level metrics (sensitivity and PPV with time matching, duration error). Long closures of 1 s or more, which drive the microsleep alarm, are not validated, although the EOG would allow it.

**Required fix.**
- Annotate a random subset of EOG or video by hand.
- Report event-level sensitivity, PPV and duration agreement, with repeated-measures Bland–Altman analysis stratified by frame rate.
- Validate the detection of long closures.
- Either validate the MediaPipe-blendshape pipeline on RGB video (for example on UTA-RLDD, already cited, or a small recorded set) or remove the claim from the abstract, contributions and conclusion.

### M7. The webcam path has a correctness problem

**Location.** Sec. 3.1, Sec. 4 webcam mapping; `web/src/sensing/blink.ts` l.103; `web/src/twin/twin.ts` l.300–305; `web/src/main.ts` l.226; `web/scripts/drozy_eyes.ts` l.83, l.99.

**Problem.** When a one-minute window contains no ordinary blink, `meanBlinkMs` is 0. The twin still uses u = [1, PERCLOS%, (0 − 150)/100]. With the default slope of 1.441, this lowers the predicted KSS by about 2.2 points, so a minute with only long closures, or with no blinks while staring, is read as very alert. The DROZY analysis that fitted the mapping excluded windows without blinks, and the simulator never produces them (blink duration has a floor of 60 ms). The case was therefore never exercised. The mapping also ignores long closures, the most specific sleepiness sign the meter records.

**Required fix.**
- Treat blink duration as missing when a window has too few blinks, and drop that feature from u.
- Add a unit test for this path.
- Consider adding long closures to the mapping.
- Report how often such windows occur in pilot data.

### M8. OpenNeuro ds004902: misreported in the abstract, an invalid comparison, and an argument that points the other way

**Location.** Abstract l.8; Sec. 5.2 l.38–40; Discussion l.4.

**Problem.**
- **(a) Wrong scale in the abstract.** The abstract says "the two changes were weakly related (ρ = 0.25, n = 25)" right after "KSS rose in only 73%", which implies RT–KSS coupling. The correlation is between RT and SSS. KSS and PVT overlap in only 2 people.
- **(b) The 90% vs 73% comparison is invalid.** "RT slowed in 90% but KSS rose in only 73%" compares different subsets (n = 30 vs n = 33, with only 2 people in common). It also compares a continuous measure, where ties are practically impossible, with an integer scale on which "no change" counts as "did not rise" (`openneuro_pvt_kss.py` l.97, l.100).
- **(c) The coupling estimate is imprecise.** ρ = 0.25 with n = 25 has a 95% CI of about −0.16 to 0.59, and the Pearson r is 0.37. Change scores from a 7-point scale and from two RT sessions have low reliability, so attenuation is expected. "Says little" is not supported.
- **(d) Lapses do not behave as expected.** Lapses "did not change" (mean −0.03; median 2 after normal sleep, 1 after deprivation) while median RT slowed by 41 ms (d_z = 1.33). Lapses are usually the most sensitive PVT outcome. Please check the mapping of `PVT_item1`–`PVT_item3` against the dataset's data dictionary.
- **(e) The argument points the other way.** This result is about people differing in how much they change, which is a difference in sensitivity (slope). The twin's bias states are constant level offsets. Anchoring assumes that a change in a passive signal maps to a change in KSS through a common slope, and that is exactly what heterogeneity in change undermines. The analysis therefore motivates personal slopes, not per-channel biases. The "Interpretation" paragraph should be rewritten.

**Required fix.**
- Correct the abstract.
- Drop the 90/73 comparison, or redo it on overlapping people with a definition that handles ties.
- Report CIs and a reliability-corrected coupling estimate.
- Verify the column mapping.
- Revise the argument.

### M9. Contributions that are not evaluated: workload, alarms, the "explanation" and the time-to-KSS-7 forecast

**Location.** Title; Abstract; Contributions 3–5; Sec. 3.2; Sec. 4 (Workload, Attribution, Forecast); Conclusion.

**Problem.**
- **Workload.** The workload half of the twin is not evaluated (Sec. 4, "Workload was not evaluated in this paper"), yet the title, abstract and conclusion present a twin of "sleepiness and cognitive load". NASA-TLX is a retrospective rating of a task, not a measure of the instantaneous state w(t), so treating it as a point observation needs justification. The blink-rate → TLX mapping ([50, −1.0]) has no stated source, and DROZY found no association between blink rate and KSS.
- **Alarms.** The thresholds are unvalidated, yet the alarms are listed as a contribution. Implementation details matter here:
  - The "head drop" uses an absolute pitch deviation of at least 12° in either direction (`head.ts` l.57–58, l.74–76), so it is not a drop.
  - The 20th-percentile, 30-second baseline (`blink.ts` l.69–71) moves towards the closed level once the eyes are closed for more than about 80% of 30 s. This can suppress long microsleeps and very high PERCLOS, which are the events that matter most.
- **"Exact explanation".** The decomposition is an accounting identity that depends on the order of events. A check-in that follows a reaction test is credited with undoing that test's contribution, and what the bias states learn does not appear.
- **Time-to-threshold forecast.** The forecast of the time to KSS 7 and the what-if scenarios are not evaluated, even in simulation. The code contains a `trueCrossing` helper that is never used (`simulate.ts` l.255–258).

**Required fix.**
- Either evaluate these components (in simulation for workload and time-to-threshold; with DROZY EOG for the long-closure alarm), or move them from the title, abstract and contributions into a description of software features.
- Rename the "exact explanation" as an additive decomposition of filter updates and show its order dependence.

### M10. Unverified constants, draft artefacts, and an unevaluated released configuration

**Location.** Sec. 4.1 (`04-model.tex` l.26–27; the box appears in the compiled PDF), Table 2, Limitations (`09-discussion.tex` l.15); title page ("Working draft").

**Problem.**
- The Three-Process Model constants have not been verified against the source, and the sleep-recovery breakpoint is omitted. The manuscript says this itself, in an orange box in the compiled PDF.
- The filter hyperparameters (σ_d 1.2, √q_d 0.3, σ_β 1.2, √q_β 0.05, σ_K 0.75, γ 0.4 KSS h⁻¹) have no source and were not estimated.
- No reported result describes the released configuration. The simulation used its own cohort-fitted mappings (`sim_summary.json`: PVT [3.54, 1.40]; camera [0.62, 0.64, 2.10]), not the DROZY defaults of Table 2 (PVT [3.494, 2.222]; camera [3.609, 0.187, 1.441]). These simulation mappings are not reported in the paper.

**Required fix.**
- Verify the constants against the cited table and cite it precisely.
- Implement the breakpoint or justify leaving it out.
- Justify or estimate the hyperparameters.
- Report the simulation mappings.
- Evaluate the released defaults (at least by the DROZY replay in M5).
- Remove all draft artefacts.

### M11. The pre-specified validation study is under-specified and its power calculation does not match its outcome

**Location.** Sec. 8 (`08-protocol.tex` l.10–18).

**Problem.**
- **(a) Power.** The sample size uses the simulated difference in latent MAE (0.305), but the primary outcome is error against held-out KSS ratings. Rating noise (SD about 0.7 plus rounding) adds a floor to that error and attenuates differences. The per-person SD of the difference (0.6) is assumed; the simulation implies about 0.51 for the latent outcome.
- **(b) H2.** H2 ("not worse") needs a non-inferiority margin and test, and "better calibrated" needs a named metric and test.
- **(c) Contamination of ratings.** The app shows each reaction time for 600 ms and then prompts a check-in (Sec. 3.3–3.4). Ratings may be anchored on that feedback, which would inflate the coupling between PVT and KSS.
- **(d) Analysis.** Absolute errors are skewed. The estimand, model family and multiplicity handling for the two H1 comparisons are not stated.

**Required fix.**
- Compute power by simulating the actual primary outcome.
- Specify the margin and calibration metric.
- Collect the KSS rating before the PVT, or hide RT feedback, or randomise the order.
- Write a full statistical analysis plan, and register it before data collection.

### M12. Novelty claims and related work

**Location.** Sec. 2, Table 1, Discussion "What is new".

**Problem.**
- Adding per-sensor bias states to a Kalman state is a standard technique (e.g., Friedland, *IEEE Trans. Automatic Control* 1969).
- Bayesian individualisation of biomathematical fatigue models with predictive uncertainty already exists (Van Dongen et al., *Sleep* 2007; 2B-Alert provides prediction intervals).
- The ticks in Table 1 are not evidence-based. 2B-Alert's uncertainty is marked only "partly". BlinkTwin's "personal calibration ✓" is contradicted by the paper's own negative results (DROZY; slopes off by default).
- "The first open tool" needs a systematic search.
- "Digital twin" is used for a model with one personal state, two biases and fixed population parameters. The term should be justified, or replaced by "personalised state-space model".

**Required fix.**
- Reposition the contribution as an application and evaluation of known techniques.
- Make Table 1 evidence-based, or remove it.
- Expand the related work: state-space models of ecological momentary assessment, personalised drowsiness detection, validation of webcam PERCLOS and blinks, and timing accuracy of web-based reaction tests.

---

## 4. Minor issues

1. The κ grid minimum is reported as 0.622 (`06-simulation.tex` l.84). The file gives 0.62267, which rounds to 0.623 (`sim_camera_weight.csv`; `sim_log.txt` prints 0.623).
2. "24 unit tests" (`01-introduction.tex` l.23; `03-system.tex` l.37). `web/tests` contains 43 `it` blocks (24 in `twin.test.ts`, 19 in `more.test.ts`, one of them run twice), and the README says 44.
3. In the simulation the k = 1 check-in is at 10:00 (`simulate.ts` l.187). The other schedules run from 08:30 to 22:30. "Spread evenly over the first 16 h" is inaccurate; give the times.
4. The simulator emits camera windows in every context except `unset`, breaks included (`synth.ts` l.162). The text (`06-simulation.tex` l.15) and the protocol string in `sim_summary.json` say "during task blocks".
5. The simulator's true time on task falls to 0 at the start of each break (`synth.ts` l.152), while the twin freezes T for the first 10 minutes of a break (`twin.ts` l.189–193). This undocumented mismatch contradicts "the twin's time-on-task ... parameters are the same in the simulator and the twin" (`09-discussion.tex` l.16).
6. Sec. 3.2 should state the 12° threshold for the head-drop alarm and the fact that it is direction-agnostic (see M9).
7. "Browser and keyboard timing add a delay of a few milliseconds" (`03-system.tex` l.28) understates the problem. Published timing studies (e.g., Bridges et al., *PeerJ* 2020; Anwyl-Irvine et al., *Behav Res Methods* 2021) report lags of tens of milliseconds with device-dependent variability. A constant offset is absorbed by β_P only once check-ins exist.
8. "Models with random slopes did not converge and are not used" (`05-grounding.tex` l.9) contradicts l.17 and Table 2, where their SDs are used as priors. The non-convergence of the blink-rate random-intercept model should also be reported.
9. In the simulation, the camera mapping is fitted on 15-minute averaged features (`simulate.ts` l.117–121) but applied to 1-minute windows. State this, and model the noise accordingly.
10. Coverage is computed on clipped estimates and a clipped truth (`simulate.ts` l.232–235), so intervals can extend beyond 1–9. For predicting ratings, as in the protocol, the interval should include σ_K.
11. The bootstrap uses 1,000 percentile resamples. Use more (≥ 5,000) or BCa intervals, and report Monte Carlo error.
12. Figure 5A shows marginal CIs for what are paired comparisons; plot paired differences instead. Figure 2 reuses colours across the 14 subjects (`C{s % 10}` in `drozy_analysis.py` l.341), so different people share a colour.
13. Rescaling EAR within each test between its 90th and 1st percentiles (`drozy_eyes.ts` l.65–68) guarantees at least 1% "closed" frames in every test. This sets a floor on PERCLOS and removes between-session changes in eyelid aperture. Justify it, or normalise per subject.
14. "15 frames per second for some tests" (`05-grounding.tex` l.7) should say 16 of 36 tests, all of them in tests 2 and 3.
15. Table 2 omits the initial workload state (w₀ = 40, SD 20) and the `unset` demand of 40 (`twin.ts` l.87, l.171–172). Give sources for D_c and for the blink-rate mapping.
16. The "break now" what-if sets T to zero for the whole horizon (`twin.ts` l.365), i.e., it assumes the person never resumes work. Describe this in Sec. 4.
17. Define the forecast target as the latent s* ≥ 7, not a rated KSS ≥ 7.
18. Table 3 omits the truncations in `synth.ts` (b₀ ≥ 80 ms, blink duration ≥ 60 ms, RT ≥ 180 ms, PERCLOS in [0, 0.5], blink rate ≥ 2 min⁻¹ with baseline ≥ 5, fixed coverage 0.9, workload fluctuation time constant 20 min).
19. `results/drozy_sessions.csv`, `drozy_eyes.csv` and `drozy_eye_minutes.csv` contain derived values per subject and per test (and per minute), and Figure 2 shows individual trajectories. This goes beyond "only aggregate statistics" (`05-grounding.tex` l.7; Data availability). Check it against the DROZY licence before the repository is made public.
20. Reproducibility:
    - The repository is private. Provide an archived, versioned snapshot with a DOI and a commit hash.
    - State the Node.js version: the scripts run TypeScript directly, which needs a recent Node release with type stripping. Also state the OS.
    - Document the DROZY session timings needed for any replay with the prior.
    - The pinned Python requirements and fixed seeds are welcome.
21. Leave-one-subject-out wording: "did worse than the population mapping" (Discussion l.4) rests on p = 0.098 and p = 0.06. "Did not improve on" is accurate.
22. Report a CI for the blink-rate agreement (ρ = 0.88; 95% CI about 0.78 to 0.94 if the 36 tests are treated as independent, which they are not).
23. The abstract says the population mappings "were fitted on DROZY". The simulation results use different, cohort-fitted mappings. Say so.
24. Formatting: the manuscript is 21 pages in the generic article class and dated "Working draft". Use the journal template and length limits.

---

## 5. Number and equation checks

**Numbers that match.** I checked every number in the abstract, Sections 5 and 6, Tables 2–4, the protocol and the Discussion against `sim_summary.json`, `sim_mae.csv`, `sim_forecast.csv`, `sim_camera_weight.csv`, `drozy_summary.json` and `openneuro_summary.json`. All of the following match after rounding:

- the MAE, CI, coverage, Brier and AUROC values;
- the paired differences and CIs;
- the 23% share;
- the DROZY session means, mixed-model slopes, CIs and p-values, repeated-measures correlations and their df (35 − 13 − 1 = 21), leave-one-subject-out MAEs and blink agreement;
- all OpenNeuro statistics.

The worked prior values (6.9, 2.6, 5.3 and 7.5) reproduce from the TPM code. The power calculation (d_z = 0.5, n ≈ 34) is arithmetically correct.

**Equations and parameters that match.** Eqs. (1)–(12) match `tpm.ts`, `twin.ts` and `blr.ts`. All entries of Table 2 equal `TPM_DEFAULTS` and `DEFAULT_CONFIG`. Table 3 equals `POPULATION` in `synth.ts`, apart from the omitted truncations (minor issue 18).

**Mismatches and omissions found:**

| # | Manuscript location | Manuscript says | Source (file, line or field) | Source shows | Type |
|---|---|---|---|---|---|
| 1 | `06-simulation.tex` l.84 | κ minimum MAE 0.622 at κ = 160 | `results/sim_camera_weight.csv` (camRInflate 160); `sim_log.txt` | 0.62267 (prints 0.623) | Number (rounding) |
| 2 | `01-introduction.tex` l.23; `03-system.tex` l.37 | 24 unit tests | `web/tests/twin.test.ts` (24), `more.test.ts` (19, one run twice); README | 43 test cases, 44 runs | Number |
| 3 | `00-abstract.tex` l.8 | "the two changes were weakly related (ρ = 0.25, n = 25)", after a sentence on KSS | `openneuro_summary.json` `coupling_rt_vs_sss` | Coupling is RT vs SSS, not KSS | Reporting |
| 4 | `00-abstract.tex` l.8; `05-grounding.tex` l.38 | RT slowed in 90%, KSS rose in 73% (presented as a comparison) | `openneuro_pvt_kss.py` l.85–100; `paired.kss.n` = 33, `paired.median_rt_ms.n` = 30 | Different people (overlap 2); "rose" excludes ties | Reporting |
| 5 | `05-grounding.tex` l.15 | Intercept shift "by the shrinkage factor that BlinkTwin's Kalman update applies" | `drozy_analysis.py` l.213–214; `twin.ts` l.210–217 with `DEFAULT_CONFIG` | Analysis uses τ²/(τ²+σ²) ≈ 0.34; the twin's check-in gain on d is about 0.72 and it does not shift the mapping intercept | Method description |
| 6 | `05-grounding.tex` l.15 | Population model fitted on the other subjects (implied: the Table 2 random-intercept mapping) | `drozy_analysis.py` l.211, l.215 | Pooled OLS | Method description |
| 7 | `05-grounding.tex` l.7 | Video at 30 fps, "15 for some tests" | `results/drozy_sessions.csv`, column `fps` | 16 of 36 tests at about 15 fps: 0/12 in test 1, 8/12 in tests 2 and 3 | Description (confound) |
| 8 | `05-grounding.tex` l.9 | Random-slope models "are not used"; only random slopes failed | `05-grounding.tex` l.17; Table 2; `drozy_summary.json` `blink_rate.converged` | Random-slope SDs are used as priors; the blink-rate random-intercept model also did not converge | Description |
| 9 | `06-simulation.tex` l.15 | One webcam window per minute during task blocks | `synth.ts` l.162 | Windows in all contexts except `unset`, breaks included | Code vs text |
| 10 | `06-simulation.tex` l.15 | Check-ins spread evenly over the first 16 h | `simulate.ts` l.185–188 | k = 1 at 10:00; other k evenly from 08:30 to 22:30 | Code vs text |
| 11 | `06-simulation.tex` l.56 (Table 4 caption); l.17, l.76 | Non-monotonicity due to check-in times; "identical event streams"; paired difference vs the rhythm model | `simulate.ts` l.269, l.338–339 | Seed differs by k, so truth and noise differ across k; cross-k pairs share only person parameters | Code vs text |
| 12 | `09-discussion.tex` l.16; `04-model.tex` l.35 | Time-on-task rule the same in simulator and twin | `synth.ts` l.152 vs `twin.ts` l.189–193 | Truth resets T to 0 at break start; twin freezes T during the first 10 min of a break | Code vs text |
| 13 | `03-system.tex` l.25 | Alarm when "the head has dropped from its resting pitch" for ≥ 1 s | `head.ts` l.57–58, l.74–76; `alerts.ts` l.83 | Absolute pitch deviation ≥ 12° in either direction | Code vs text |
| 14 | `04-model.tex` l.52, l.54 (webcam mapping with mean blink duration b̄) | Feature defined by mean blink duration | `blink.ts` l.103; `twin.ts` l.300–305; `drozy_eyes.ts` l.83 | b̄ = 0 when a window has no blinks, so the feature is −1.5 (about −2.2 KSS); DROZY fit excluded such windows | Code defect |
| 15 | `04-model.tex` l.52 | κ allows for "strong autocorrelation of successive one-minute windows" | `synth.ts` l.163–166; `drozy_eye_minutes.csv` | Simulator noise is independent per minute; DROZY lag-1 autocorrelation is 0.04–0.32 | Justification vs evidence |
| 16 | `06-simulation.tex` l.13 | κ chosen over a grid from 1 to 1280 "and with the webcam switched off" | `simulate.ts` l.141–159 | "Off" (κ = 10⁹) is one grid option; tuned only for the anchored variant E | Description |
| 17 | Sec. 6 and Table 2 (implicit) | Mappings are the DROZY values of Table 2 | `sim_summary.json` `population_mappings` | Simulation used cohort-fitted mappings: PVT [3.54, 1.40]; camera [0.62, 0.64, 2.10] | Omission |
| 18 | Table 2 (workload) | Five default demands; no initial state | `twin.ts` l.87, l.171–172 | `unset` demand 40; w₀ = 40 with SD 20 | Omission |
| 19 | `04-model.tex` l.91 | "A break now sets T to zero" | `twin.ts` l.365 | T stays 0 for the whole forecast horizon | Description |
| 20 | Table 3 | Distributions as listed | `synth.ts` l.79–84, l.163–172 | Unstated truncations and fixed coverage 0.9 (minor issue 18) | Omission |

---

## 6. Points for the authors' response

In their response, I ask the authors to:
1. Provide a valid forward measurement model, or justify the current one, together with an oracle analysis.
2. Replay the released twin on DROZY with the TPM prior, after resolving the frame-rate confound.
3. Run misspecification and sensitivity experiments in the simulation, with every variant tuned on equal terms.
4. Report per-person, night-time and all-k results, with uncertainty for every forecast metric.
5. Correct the abstract (SSS vs KSS; the 90/73 comparison), the contributions and the conclusion.
6. Fix the zero-blink defect.
7. Either evaluate workload, the alarms and the time-to-KSS-7 forecast, or remove them from the title and contributions.
8. Remove the draft artefacts and verify the Three-Process Model constants.
