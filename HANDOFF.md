# Handoff (5 November 2026): pick up here in a local session

This file is the starting point for the next working session on a local machine. It says where the project stands, how to merge this revision with local work, what the round-2 referees asked for, and what to do next, in order. `docs/PROJECT_NOTES.md` stays the standing brief (layout, data licences, writing rules).

## 1. Where things stand

- **Branch:** all work of this revision is on the remote branch `revision-round1` (starts from `main` at 0edd763). `main` is unchanged.
- **Paper:** IEEE two-column manuscript `paper/main.tex` (14 pages) and `paper/supplement.tex`; both build without warnings. New title: "BlinkTwin: A Browser-Based State-Space Model of Subjective Sleepiness Combining the Three-Process Model, Self-Ratings and Passive Signals".
- **Reviews:** round 1 answered (`paper/reviews/round1-response.md`); round-2 reports (`round2-reviewer-A.md`: major revision; `round2-reviewer-B.md`: reject and resubmit for J-BHI, supportive of a methods or protocol article now) answered in `paper/reviews/round2-response.md`, which marks every item Done, Partly or Not done. The remaining items mostly need DROZY or new data (Section 4C-D).
- **Tests:** 120 unit tests pass (`cd web && npx vitest run`); `npx tsc --noEmit` passes.

## 2. Merge this revision into your local copy

```bash
git status                                          # check local changes first
git stash push -u -m "local work before merge"      # only if you have uncommitted changes
git fetch origin
git switch main
git merge --no-ff origin/revision-round1
git stash pop                                        # if you stashed; resolve conflicts
cd web && npm install && npx tsc --noEmit && npx vitest run
cd ../paper && latexmk -pdf main.tex && latexmk -pdf supplement.tex
```

Files most likely to conflict with local edits: `web/src/main.ts`, `web/index.html`, `web/src/style.css`, `web/src/ui/*.ts`, `web/src/twin/twin.ts`, `web/src/twin/tpm.ts`, `web/src/sensing/*.ts`, `README.md`, everything in `paper/` (rewritten). Git-ignored local data (`data/`, `results/drozy_*.csv`, `analysis/.venv`) are not touched. If `web/package-lock.json` shows only removed `libc` fields after `npm install`, that is npm-version noise; discard it.

After merging you can delete the remote branch (`git push origin --delete revision-round1`).

## 3. What this revision changed

### App and model (`web/src/`)
- Forward measurement models with one anchor per passive signal; the published Three-Process Model (breakpoint 12.2, ultradian component, sleep debt across days). Channel constants and their derivation are commented in `twin.ts`.
- Blink meter keeps its open-eye baseline during closures of 2 s or more (released after 60 s); closures under 2 s are processed exactly as before.
- PERCLOS guard: PERCLOS is ignored when the camera's blinks do not reach full closure (`peakClosure` < 0.85), judged per camera from the last known blink peak (Section 5).
- Alerts: "long eye-closure alert" and "head-drop alert"; looking down judged from the 500 ms before a closure; head drop forward only; a face lost during a closure keeps the alert on.
- 1-minute reaction test shown but not used by the model; workload saved only when all six sliders are set; time on task after short breaks corrected; forecasts assume the usual 50/10 work rhythm; what-ifs relabelled.
- Missing nights: the app fills nights that were not entered with habitual sleep and flags the estimate (`fillMissingNights`, app only); "I did not sleep last night" can be entered. Research scripts do not fill nights.
- Insight panels (`web/src/insights/`): track record of past predictions, check-in suggestions, reactions vs ratings, sleep status.
- Privacy: an automated traffic check (`web/scripts/privacy_check.mjs`) found MediaPipe sending usage statistics to a Google logging service every minute (no images); a content security policy in `web/index.html` blocks it; the check records no request after load (`results/privacy_check.json`). Benchmark: `results/benchmark.json`.
- UI/UX: responsive charts, forecast shading, signed explanation bars, colour-blind-safe palette, dark mode contrast, accessibility, first-time guidance, footer disclaimer.

### Analyses (`web/scripts/`, `analysis/`, `results/`)
- `openneuro_prior_check.ts`: sleep diary did not improve the prior; the Ingre et al. (2014) KSS mapping (9.68 - 0.46 A) lowered its MAE from 1.69 to 1.46 on 28 people (`results/openneuro_prior_summary.json`).
- `simulate.ts`: common random numbers, 9 scenarios, sensitivity, reliability, rhythm-aware forecasts (`results/sim_*`).
- `power.ts`: power by simulating the protocol's outcome with each person's 10 days replayed as one log (`results/power_summary.json`).
- `drozy_eyes.ts` reproduces the released DROZY eye results by default; `--fixed-baseline` uses the new blink-meter fix. `drozy_mediapipe_blinks.ts` has an "adaptive" variant ready to be run.
- `analysis/drozy_twin_figure.py`: figure of the DROZY replay.

### Documentation
- `docs/HOW_IT_WORKS.md` (plain-language guide with worked examples and FAQ), `docs/LITERATURE_COMPARISON.md` (peer-reviewed comparison with verification grades), `docs/PUBLICATION_PLAN.md`, `docs/SCIENCE.md`, `README.md`.

## 4. What the round-2 referees asked for (priority order; status per item in `paper/reviews/round2-response.md`)

Both referees credit the revision as thorough, honest and reproducible. Their shared verdict: the real-data support for learning a personal offset is weak, the passive signals' benefit (0.03 KSS points) exists only in simulation, the webcam half has never been tested on RGB webcam video, and the planned study cannot detect the passive signals' benefit.

**A. Fixable with code and existing simulation (no DROZY needed)**
1. Fix the PERCLOS-guard bypass in minutes with fewer than 3 blinks (Reviewer A, N4).
2. Add a fair comparator: a consider-covariance (Schmidt-Kalman) filter that carries the bias in the covariance without estimating it (A N1, B N5). Then rewrite "fusion without anchors failed" and drop "can be added safely only with their own anchors".
3. Rename the "oracle" to "known-parameter filter"; it is not an upper bound (beaten under autocorrelated noise); drop the "40% of the available gain" sentence (A N2).
4. Offset dynamics: compare the random-walk offset with a mean-reverting (Ornstein-Uhlenbeck) offset; add day-to-day offset variation to the simulator (A N5, B N1).
5. Power: simulate the analysis that will actually be run (one continuous 10-day replay per person, anchors carrying across days); use a non-inferiority margin of 0.05 or less (0.10 allows losing 84% of the check-in benefit); add a hypothesis that can detect a benefit of the passive signals, for example withheld probe ratings between check-ins or the next PVT-B as a co-primary objective outcome; size the laboratory phase (A N7, B N6).
6. Objective check: base the "slower than your ratings" verdict on within-person change only (between-person baselines are 2.6 KSS-equivalents, so a one-off population-scale gap would flag about a third of well-calibrated people); report false-flag rates in simulation; describe it as experimental (A N8, B N3).
7. Study mode that hides all estimates from participants during the field phase (B N6).
8. Channel ablation (PVT only, webcam only) in the simulation; coverage and width at every k and in every scenario; per-person quantiles in Table S2; Monte Carlo SEs; report the k = 1 and k = 8 results under autocorrelated noise (A minor 2-6).

**B. Text and number fixes in the paper (no new analysis)**
- Title: drop "Forecasting" and "From Webcam ..." claims the evidence does not carry; do not call DROZY's near-infrared Kinect video a webcam; DROZY used a 10-min PVT, not the 3-min PVT-B.
- Sec. V-C: the prediction sets are 20 predictions from **11** subjects and 24 from **13** (not 10 and 12).
- Sec. V-D and Discussion: DROZY does **not** support "the default mapping is too steep" (the prior's alertness is almost identical at tests 2 and 3 while observed KSS differs by 1.75; the refitted mapping moves the night prediction by only 0.27). Keep the ds004902 result but stop citing DROZY for it. The persistence test compares rested with deprived sessions, so it is a person-by-condition result, not day-to-day persistence.
- Report the group-mean offset result on ds004902 (MAE 1.45, better than the personal offset 1.52).
- One value for the landmark blink-duration autocorrelation (0.02 in Sec. V-A, 0.05 in V-B; they come from two scripts); label n = 28 vs 33 where used; "lapses" in Sec. V-A are > 500 ms.
- Report the 30-fps-only DROZY results: MediaPipe blink duration vs KSS r = 0.46 (p = 0.25, 5 subjects), long closures r = 0.33.
- Report the power finding plainly (done: with one continuous 10-day log BlinkTwin minus check-ins is -0.010; with each day replayed separately it was +0.019).
- Call the protocol "proposed", not "pre-specified", until registered.
- Supplement S2: remove "checked by an independent reviewer".
- Add references: Ahlstrom et al., Transp Res Part C 2013;26:20-32 (confirm the DOI); Schmidt 1966 (consider states); Bryson and Henrikson 1968 (correlated measurement noise, doi 10.2514/3.29327); Piaggio et al., JAMA 2012 (CONSORT non-inferiority, doi 10.1001/jama.2012.87802); Carroll et al. 2006 (measurement error); Asparouhov, Hamaker and Muthen 2018 (dynamic models of intensive self-report, doi 10.1080/10705511.2017.1406803).
- Table I: only numbers verified against the full text (Subramaniyan et al. 2025 is graded P in the comparison document).
- Fig. 2C and Fig. S1 show one line per subject: check against the DROZY licence, or replace with aggregates.
- Remaining number discrepancies are tabulated in Section 6.2 of Reviewer A's report and Section 5 of Reviewer B's report.

**C. Needs DROZY (run locally; the host is blocked in the cloud environment)**
- Paired, subject-level bootstrap comparisons on common prediction sets; the prior's MAE on the 20-prediction set; a per-test table.
- Replay with the website's MediaPipe per-minute features and the PERCLOS guard; refit the webcam forward models on the MediaPipe features (and set kappa for blink duration to 2.28).
- "Protocol-aware prior plus passive signals" condition; device-offset sensitivity (+20, +40, +60 ms on the reaction-time level).
- Refitted-mapping and consider-covariance variants; the two-check-in under-prediction at test 3.
- A lapse-based PVT forward model; slope attenuation from rating noise (errors in variables).
- `drozy_eyes.ts --fixed-baseline` and the MediaPipe "adaptive" variant.

**D. New data**
1. RGB webcam + EOG laboratory recording, 15-20 people, desk work (typing, reading, phone), after normal sleep and after restriction: event-level blink and long-closure detection, blink-duration agreement, PERCLOS guard behaviour, false alerts per hour.
2. Browser PVT-B latency on at least 10 laptop, browser and keyboard combinations; a PVT-B-specific forward model.
3. Other public data: UTA-RLDD (consumer RGB webcams, 60 people) for the MediaPipe pipeline; the Liege multi-timescale dataset (29 people, PVT) for eye measures against PVT.
4. The prospective study, redesigned as in A5, registered with ethics approval.

## 5. Round-2 code changes (done in this revision)

- PERCLOS guard judged per camera: the app always stores `peakClosure` (null when unknown); the model remembers the last known blink peak and skips PERCLOS while none is known. Events without the field (DROZY replay, simulation) behave as before.
- `anchorMode: 'estimate' | 'consider' | 'none'` in `TwinConfig` (consider-covariance filter with Joseph-form update) and `offsetReversionHours` (mean-reverting offset, off by default).
- Simulation: consider-covariance method, known-parameter filter label, mean-reverting offset rows; full re-run (earlier rows unchanged).
- `power.ts`: one continuous 10-day log per person, margins 0.03/0.05/0.10, n up to 150, the per-day analysis kept as a sensitivity block.
- Objective check: verdict from within-person anchor change only; suggestions use the personal innovation of the latest test; unvalidated wording removed.
- Study mode (`?study=1`) hides estimates, forecasts, checks, track record and suggestions; keeps safety alerts, camera, check-in prompts and export.

Still to do in code: store the camera frame rate with each minute; suppress only prior-driven (not check-in-driven) warnings when the night is assumed; replace the clock-time "you will reach KSS 7 at" with a window or probability; channel ablation in the simulation; power for the probe-rating and PVT co-primary outcomes; day-to-day offset variation in the generator.

## 6. Key results (from the committed result files)

| Result | Value | File |
|---|---|---|
| DROZY replay, leave one subject out, MAE | prior 1.73; PVT + webcam 1.47; one check-in 1.51; all three 1.38; per-test mean of others 1.39 (24 and 20 predictions from 13 and 11 subjects) | `results/drozy_twin_summary.json` |
| MediaPipe pipeline on DROZY near-infrared video | blink rate vs EOG rho 0.71 (undercount 13/min); blink duration vs KSS within person r 0.58 (all tests), 0.46 at 30 fps only; PERCLOS < 0.5% in all 36 tests | `results/drozy_mediapipe_summary.json` |
| ds004902 offset persistence | r 0.29 (95% CI -0.05 to 0.58), n 33; group-mean offset MAE 1.45 vs personal shrunk offset 1.52 vs prior 1.53 | `results/openneuro_anchor_summary.json` |
| ds004902 prior (28 people with a diary) | default mapping MAE 1.69 (36% within 1 point); Ingre mapping 1.46 (45%); diary sleep 1.74 | `results/openneuro_prior_summary.json` |
| Simulation, matched, 3 check-ins | BlinkTwin 0.629, check-ins 0.659, consider-covariance 0.673, prior 0.819, known-parameter filter 0.586, no anchors 1.741; passive alone 0.861; mean-reverting offset (24 h) 0.605 | `results/sim_summary.json`, `results/sim_log.txt` |
| One-hour forecast of KSS >= 7 (matched) | Brier: prior 0.086, check-ins 0.066, BlinkTwin 0.063; AUROC 0.945, 0.966, 0.969; time to KSS 7 off by about 80 min for every method | same |
| Power (10 days as one log) | rating MAE: prior 1.007, check-ins 0.847, BlinkTwin 0.837, consider 0.850, mean-reverting 24 h 0.819, 72 h 0.799; BlinkTwin minus check-ins -0.010 (SD 0.036); superiority over check-ins power 0.68 at 80, 0.93 at 150; per-day replay gives +0.019 | `results/power_summary.json` |

## 7. Things to verify by hand

- On a laptop with a webcam: `PITCH_DOWN_SIGN` in `web/src/sensing/head.ts` (nodding down should make pitch positive), the looking-down gate, alert behaviour while reading and typing; repeat the privacy check with a real face (the automated check used a test pattern without a face).
- Literature numbers graded P or S and the DOIs marked "to confirm" in `docs/LITERATURE_COMPARISON.md` (publisher sites, PubMed Central, Crossref and doi.org could not be reached from the cloud environment).
- Journal facts in `docs/PUBLICATION_PLAN.md` (quartiles came from Scimago via search; impact factors, fees and limits were not verified).
- The linear recovery rate below the breakpoint (0.80 per hour) against Akerstedt et al. (2008) and Ingre et al. (2014).

## 8. Publication route (updated with the referees' advice)

- **Now:** split into (i) a methods or formative-evaluation article (JMIR Formative Research, PLOS Digital Health, Frontiers in Digital Health, IEEE Open Journal of Engineering in Medicine and Biology, or Sleep Advances; check quartiles), and (ii) a protocol article (JMIR Research Protocols or BMJ Open) once ethics approval and registration exist. With the browser PVT-B timing data, Behavior Research Methods becomes realistic.
- **After the RGB webcam + EOG recording and the existing-data analyses:** IEEE J-BHI as a methods-and-validation paper (the manuscript is already in IEEE format).
- **After the prospective study:** IEEE J-BHI or TBME; npj Digital Medicine if real-world validation is strong; SLEEP or Journal of Sleep Research if the sleep-science findings are central.
- Before any submission, complete the target journal's declarations (data and code availability, tools used in preparing the manuscript) as its author guidelines require.

## 9. Housekeeping

- [ ] Choose a licence and add a LICENSE file before making the repository public (none is present).
- [ ] Archive a release on Zenodo with a DOI before submission.
- [ ] Ethics application and OSF registration for the field study.
- [ ] Sole author and contributor: Utsav Poudel (utsav.poudel@outlook.com.au).
