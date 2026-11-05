# Response to the round-2 referee reports

We thank both referees again. Their round-2 reports are precise and, in our reading, correct on every major point. The revision answers what can be answered with code, simulation and text, and states plainly what still needs the DROZY recordings (which could not be downloaded in the environment used for this revision) or new data. Section and table numbers refer to the revised manuscript.

## Main changes

1. **Title and claims.** New title: "BlinkTwin: A Browser-Based State-Space Model of Subjective Sleepiness Combining the Three-Process Model, Self-Ratings and Passive Signals". "Forecasting", "webcam" for DROZY's near-infrared video, "safely", "pre-specified" and "oracle bound" are gone. The abstract no longer presents the DROZY conditions as one sequence and reports the power-simulation finding.
2. **Fair comparator.** A consider-covariance (Schmidt-Kalman) filter now carries each signal's bias in the covariance without estimating it (Sec. IV-D; `anchorMode: 'consider'` in `web/src/twin/twin.ts`, Joseph-form update). In every scenario it was no better than check-ins only (matched, three check-ins: +0.015, 95% CI -0.003 to +0.032), and BlinkTwin beat it (-0.044, -0.057 to -0.032; 72% of people better; Table III, Table S2). The conclusion now reads: the gain comes from estimating the anchors, and it is small.
3. **Known-parameter reference.** The "oracle" is renamed and described as a reference that shares the model's noise model and can be beaten; the "40% of the available gain" sentence is removed.
4. **Offset dynamics.** A mean-reverting (Ornstein-Uhlenbeck) offset is implemented (`offsetReversionHours`) and reported as a sensitivity analysis: with a 24-h time constant it lowered the error of both check-ins only (0.631) and BlinkTwin (0.605) without loss of coverage. The ds004902 group-mean-offset result (MAE 1.45, better than the personal offset 1.52) is reported, and the persistence test is described as a person-by-condition result.
5. **Real-data corrections.** Subject counts (11 and 13), the 30-fps-only associations (blink duration r = 0.46, p = 0.25; long closures r = 0.33), the frame-rate confound in blink duration, one definition of the landmark autocorrelation, the 28 vs 33 sample labels, the 500-ms lapse threshold, the location of the DROZY gain (night test only) and its likely source (calibration transfer within one laboratory).
6. **Mapping inference.** DROZY no longer cited in support of a steeper default mapping; the refitted mapping is a candidate supported by ds004902 only.
7. **PERCLOS-guard bypass fixed.** The model remembers the camera's last known blink peak and skips PERCLOS while none is known, for events that carry the field; the app stores the field as null in minutes with fewer than three blinks. Tests added.
8. **Objective check.** The app's "reactions slower than your ratings" verdict now uses only within-person change in the reaction-time anchor; the population-scale reading is shown as context and described as experimental. The suggestion rule uses the personal innovation of the latest test.
9. **Protocol redesigned** (Sec. VII, now "Planned Validation Study"): study mode hides all estimates during the field phase; two co-primary outcomes chosen so that passive signals can matter (withheld probe ratings between check-ins, and the next PVT-B); a 0.05 non-inferiority margin justified against the check-in benefit and reported per CONSORT; an event-based size for the laboratory phase; added screening (Epworth, Insomnia Severity Index, STOP-Bang, actigraphy-verified schedule, travel, pregnancy, caffeine and alcohol), driving guidance, bystander and employer consent, and video storage. The power simulation now replays each person's 10 days as one continuous log, matching the planned analysis. This reversed the earlier finding: BlinkTwin minus check-ins is now -0.010 KSS (SD 0.036), and -0.028 to -0.047 with a mean-reverting offset; the earlier per-day replay (+0.019) relearnt the anchors every morning. Superiority over check-ins has power 0.68 with 80 and 0.93 with 150 people; we provisionally plan 120 analysed and 135 recruited. Because the generator keeps offsets constant across days, these figures are likely optimistic.

## Reviewer A

| Issue | Response | Status |
|---|---|---|
| N1 Mis-specified no-anchor comparator | Consider-covariance comparator added and reported in Table III, Table S2, forecasts; conclusion rewritten | Done |
| N2 Oracle not a bound | Renamed known-parameter filter; "upper bound" and the 40% figure removed. A Bayes-optimal filter for the generator was not implemented | Partly |
| N3(a) Different prediction sets | Abstract and Sec. V-C state that the sets differ and are not one sequence. Paired subject-level comparisons and the prior's MAE on the 20-prediction set need the DROZY files | Partly (needs DROZY) |
| N3(b,c) Naive-baseline tie; gain only at test 2 | Reported, with the calibration-transfer interpretation and the device-latency caveat | Done |
| N3(d) Replay used landmark features | Stated in the abstract and Sec. V-C; MediaPipe replay needs DROZY | Partly (needs DROZY) |
| N3(e) "Added safely" contradicts power result | "Safely" removed. Re-running the power simulation as the planned analysis (one continuous log) reversed the sign (BlinkTwin minus check-ins -0.010); both results and the reason are reported in Sec. VII and the Discussion | Done |
| N4 PERCLOS-guard bypass | Fixed with tests | Done |
| N5 Offset dynamics and mapping inference | Mean-reverting offset implemented and evaluated; group offset reported; mapping inference rewritten; persistence described as person-by-condition. Day-to-day offset variation in the generator: not yet | Partly |
| N6(a) Errors in variables | Stated as a limitation with Carroll et al. (2006); correction needs DROZY | Partly |
| N6(b) Slope heterogeneity as white noise | Stated as a limitation; the simulator's smaller slope spreads are disclosed in S5 | Partly |
| N6(c) Wrong pipeline for webcam models | Stated prominently; refit on MediaPipe features and kappa 2.28 need DROZY | Partly (needs DROZY) |
| N6(d) 30-fps estimates | Reported in Sec. V-B | Done |
| N7 Protocol margin, hypotheses, estimand, sizes, wording | Redesigned as above; margin 0.05 (31% of the simulated check-in benefit); continuous-log power simulation; event-based laboratory size; "planned" not "pre-specified". Power for the probe-rating and PVT co-primary outcomes at the corrected alpha is still to be simulated before registration | Partly |
| N8 Objective check | Verdict on within-person change only; described as experimental; false-flag rate is a secondary outcome. A chronic-restriction simulation of its sensitivity and delay is not yet done | Partly |
| N9 Title, abstract, conclusion | Rewritten | Done |
| Minor 2 Coverage at every k | Coverage at k = 1 and 8 in the text; Table III gives k = 3 | Partly |
| Minor 3 Per-person quantiles, Monte Carlo SEs | Per-person harms reported (41% worse by > 0.1 without check-ins; 29% of people worse than the prior with three check-ins); full quantile table and Monte Carlo SEs not yet | Partly |
| Minor 4 Crossing-time subsets | Subset sizes reported; a censored measure not yet | Partly |
| Minor 5 Unreported k = 1, 8 results | Reported for autocorrelated noise | Done |
| Minor 6 Channel ablation | Not yet run (`useChannels` exists) | Not done |
| Minor 7 Default choice rule | Not changed; to be addressed with the mean-reverting offset | Not done |
| Minor 8 Linear recovery rate; "independent reviewer" | Sentence removed; the rate still needs confirming against Akerstedt et al. (2008) | Partly |
| Minor 9 Table I sourcing | Subramaniyan et al. graded Q (verbatim in two independent searches); full-text check still needed | Partly |
| Minor 10 References | Ahlstrom 2013, Schmidt 1966, Bryson and Henrikson 1968, Piaggio 2012, Carroll 2006, Asparouhov 2018 added | Done |
| Minor 11 Privacy check without a face | Stated as a limitation; to repeat with a recorded face video | Not done |
| Minor 12 Per-subject plots | Disclosed in Sec. V; licence check listed for the author | Partly |
| Minor 13 Replay details | Not yet stated (which parameters are refitted per fold; KSS timing source) | Not done |
| Minor 14-19 | Figure recolouring by frame rate and paired-difference plot need DROZY; PERCLOS floor, ds004902 details, wording (13 distinct settings; CRN caveat), lapse threshold and keywords fixed | Mostly done |

## Reviewer B

| Issue | Response | Status |
|---|---|---|
| N1 Random-walk offset | Mean-reverting option implemented, evaluated in simulation and the continuous power analysis; default unchanged until DROZY can be replayed | Partly |
| N2 Additive offset vs trait vulnerability | Discussed as the second route to better accuracy; a personal-gain model on ds004902 and DROZY not yet fitted | Not done |
| N3 Objective check noise | Verdict now from the within-person anchor trend only (`divergence.ts`); the population reading is context; described as experimental in the paper, the app text and `docs/HOW_IT_WORKS.md`; "take this seriously" removed. Simulation of false alarms and detection delay not yet done | Partly |
| N4 Blink-duration frame-rate confound | Reported (30-fps results, 84 ms vs 26 ms rise); frame rate to be stored per minute (listed for implementation) | Partly |
| N5 Straw-man comparator | Consider-covariance comparator added; "only with their own anchors" replaced | Done |
| N6 Protocol | Redesigned: registration wording, continuous-log power, co-primary outcomes that can show a passive-signal benefit, margin rationale, study mode, event-based laboratory size, desk-work tasks, screening, safety, consent and video storage; the pilot update was dropped | Mostly done |
| N7 Scenario outside intended use | Workday results reported alongside; the 24-h scenario described as outside the intended use. The app's clock-time forecast to be replaced with a window or probability (listed) | Partly |
| N8 Wording table | Applied (camera not webcam; undercount; 30-fps caveat; "safely"; "each source reduced"; mapping; title; "planned"; head-drop sign) | Done |
| Minor 1 Response vs code | The divergence message existed; corrected | Done |
| Minor 2 KSS wording source | Not yet in the supplement | Not done |
| Minor 3-4 ds004902 hours awake; late sample | The 08:20 diary mean is reported; a sensitivity for hours awake not yet | Partly |
| Minor 5 Privacy check with a face; unencrypted storage | Storage caveat added; check with a face not yet | Partly |
| Minor 6 Figure files in the paper folder | For the submission package | Not done |
| Minor 7 Length | 14 pages; to be cut for submission | Not done |
| Minor 8-11 | Fixed (mean per-test maximum; one autocorrelation definition; slope-spread disclosure; per-person harms) | Done |
| Minor 12 Replay features | Stated in the abstract | Done |

## What still needs data

- **DROZY (to run locally):** paired comparisons on common prediction sets; replay with MediaPipe features and the guard; refit of the camera forward models on MediaPipe features; protocol-aware prior plus passive signals; device-offset sensitivity; consider-covariance and refitted-mapping variants on DROZY; frame-rate downsampling; a lapse-based PVT model; errors-in-variables correction.
- **New data:** an RGB webcam and EOG recording during desk work; browser PVT-B latency on at least 10 device combinations; UTA-RLDD for the camera pipeline on consumer webcams.

We agree with Reviewer B's suggestion to publish the current material as a methods or formative-evaluation article and the protocol separately once registered, and to return to IEEE J-BHI after the RGB validation and the prospective study.
