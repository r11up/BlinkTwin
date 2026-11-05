# Handoff: revision after referee round 1 (5 November 2026)

Read this first when picking the project up again on a local machine. It says what changed in this revision, how to merge it with local work, what still has to be run with the full datasets, and what is open. `docs/PROJECT_NOTES.md` remains the standing project brief (layout, data rules, writing rules).

## 1. Merge with your local copy

The revision is on the remote branch `revision-round1`. Your local clone may have uncommitted or unpushed work, so merge carefully:

```bash
git status                       # see local changes first
git stash push -u -m "local work before merge"   # only if you have uncommitted changes
git fetch origin
git switch main                  # or the branch you work on locally
git merge --no-ff origin/revision-round1
git stash pop                    # if you stashed; resolve any conflicts
cd web && npm install && npx tsc --noEmit && npx vitest run
```

Files most likely to conflict with local edits (they changed a lot): `web/src/main.ts`, `web/index.html`, `web/src/style.css`, `web/src/ui/charts.ts`, `web/src/ui/dialogs.ts`, `web/src/ui/science.ts`, `web/src/twin/twin.ts`, `web/src/sensing/*.ts`, `README.md`, `paper/` (rewritten). If your local copy has DROZY-derived files in `results/drozy_*.csv` or data in `data/`, they are git-ignored and are not touched by the merge.

## 2. What changed in this revision

### Model and sensing (`web/src/`)
- Forward measurement models with one anchor per passive signal; the published Three-Process Model (breakpoint 12.2, ultradian component, sleep debt across days). Constants and their derivation are documented in `twin.ts`.
- Blink meter: the open-eye baseline is frozen during closures of 2 s or more (released after 60 s), so a long closure no longer ends itself after about 24 s. Closures under 2 s are processed exactly as before (tested against a copy of the old meter).
- PERCLOS guard: each camera minute records the median blink peak closure (`peakClosure`); the model ignores PERCLOS when it is below 0.85 (blinks never reach full closure, as on DROZY's near-infrared video).
- Alerts renamed "long eye-closure alert" and "head-drop alert"; looking down is judged from the 500 ms before a closure; head drop counts only forward pitch; a face lost during a closure keeps the alert on.
- The 1-minute reaction test is shown but not used by the model; untouched workload sliders are no longer saved; the test no longer runs after a cancelled check-in; time on task after a short break is corrected; the forecast assumes the usual 50/10 work rhythm by default.
- A first-time user before 07:00 was shown "Sleepy" from the default night; warnings from the model now need a real sleep entry.
- New insight modules (`web/src/insights/`): the model's personal track record (prediction before each check-in vs the rating), check-in suggestions, an objective-vs-subjective divergence check, and a sleep-history helper. See Section 6 for their integration status.
- UI/UX: responsive charts, past vs forecast shading, signed explanation bars, colour-blind-safe palette, dark mode with proper contrast, accessibility (focus, labels, live regions, reduced motion), first-time "getting started" card, 44 px touch targets, footer disclaimer.

### Analyses (`web/scripts/`, `analysis/`, `results/`)
- `web/scripts/openneuro_prior_check.ts` (new): on ds004902, entering a sleep diary did not improve the prior; the KSS mapping refitted by Ingre et al. (2014), 9.68 - 0.46 A, reduced the prior's MAE by 0.22 (95% CI -0.33 to -0.09). Output `results/openneuro_prior_summary.json`.
- `analysis/drozy_twin_figure.py` (new): figure of the DROZY replay (`results/fig_drozy_twin.pdf`).
- Simulation (`web/scripts/simulate.ts`, `web/src/sim/synth.ts`): common random numbers across the number of check-ins, new scenarios (trait vulnerability, unrecorded sleep debt, ordinary workday, ratings that level off), sensitivity analysis, interval widths, per-person quantiles, reliability bins. Outputs `results/sim_*.csv`, `results/sim_summary.json`.
- `web/scripts/power.ts` (new): power by simulating the protocol's primary outcome. Output `results/power_summary.json`.
- `web/scripts/drozy_eyes.ts`: reproduces the released DROZY eye results by default; `--fixed-baseline` uses the new blink-meter fix.
- `web/scripts/drozy_mediapipe_blinks.ts`: adds an "adaptive" variant (online closed-level normalisation) to be evaluated when the DROZY videos are available.

### Paper (`paper/`)
- Rewritten in IEEE two-column journal format (`main.tex`, `IEEEtran`), with a separate `supplement.tex`. Build: `cd paper && latexmk -pdf main.tex && latexmk -pdf supplement.tex`.
- Response to the round-1 referees: `paper/reviews/round1-response.md`.

### Documentation (`docs/`)
- `docs/HOW_IT_WORKS.md` (new): plain-language explanation of everything the app does, with worked examples and a FAQ.
- `docs/LITERATURE_COMPARISON.md` (new): published systems, their datasets, metrics and accuracies, compared with ours (peer-reviewed papers with DOIs only; every number graded by how it was verified).
- `docs/PUBLICATION_PLAN.md` (new): venue options and the recommended sequence.
- `docs/SCIENCE.md` regenerated from the app text; `README.md` updated.

## 3. Key results to remember

| Result | Value | Source |
|---|---|---|
| DROZY replay, leave one subject out, MAE | prior 1.73; PVT + webcam 1.47; one check-in 1.51; all three 1.38; naive per-test mean 1.39 | `results/drozy_twin_summary.json` |
| MediaPipe pipeline on DROZY video vs EOG | blink rate rho 0.71; blink duration vs KSS within person r 0.58; PERCLOS < 0.5% in all 36 tests | `results/drozy_mediapipe_summary.json` |
| ds004902 offset persistence | r 0.29 (95% CI -0.05 to 0.58), n 33 | `results/openneuro_anchor_summary.json` |
| ds004902 prior | default mapping MAE 1.69 (36% within 1 point); Ingre mapping 1.46 (45%) | `results/openneuro_prior_summary.json` |
| Power, primary outcome | non-inferiority vs check-ins > 0.99 with 40; superiority vs prior 0.77 with 60, 0.89 with 80; plan 65 analysed, 75 recruited | `results/power_summary.json` |
| Simulation | see `results/sim_summary.json` and paper Section VI | |

## 4. What to run locally with the full data

These need DROZY (blocked in the cloud environment used for this revision) or a real device:

1. Fetch the data: `bash scripts/fetch_data.sh`.
2. Re-run the DROZY pipeline and confirm the committed numbers reproduce: `drozy_eyes.ts` (default), `analysis/drozy_eog.py`, `analysis/drozy_analysis.py`, `analysis/drozy_forward.py`, `web/scripts/drozy_twin.ts`.
3. **Accuracy experiments to run next** (pre-specify them in a note before running):
   - DROZY replay with the Ingre et al. (2014) KSS mapping (`kssIntercept: 9.68, kssSlope: 0.46` in `TPM_DEFAULTS`); report the share of predictions within 1 KSS point as well as MAE.
   - Paired comparison of all conditions on the same 20 predictions, with a paired subject bootstrap.
   - `drozy_eyes.ts --fixed-baseline` to see whether the blink-meter fix changes any DROZY feature.
   - The MediaPipe "adaptive" variant: `drozy_mediapipe_compare.py extract`, then `drozy_mediapipe_blinks.ts`, then `compare`.
   - Raise the blink-duration noise inflation to (1 + 0.39)/(1 - 0.39) = 2.28, the autocorrelation of the MediaPipe pipeline, and re-run the replay.
4. **On a laptop with a webcam:** verify `PITCH_DOWN_SIGN` in `web/src/sensing/head.ts` (nodding down should make pitch positive), check that the looking-down gate does not suppress real eye closures, and look at the alerts while reading, typing and looking at a phone.
5. **Browser timing benchmark** for the reaction test (photodiode and key-press robot on 3 to 5 devices); needed before submission (see `docs/PUBLICATION_PLAN.md`).

## 5. Things to verify by hand

- Every literature number graded P or S in `docs/LITERATURE_COMPARISON.md`, and the DOIs marked "to confirm" (publisher sites, PubMed Central, Crossref and doi.org could not be reached from the cloud environment).
- Journal facts in `docs/PUBLICATION_PLAN.md` (quartiles came from Scimago via search; impact factors, fees and limits were not verified).
- The ds004902 PVT column labels: our assignment follows the released data dictionary; the dataset descriptor attaches the same t statistics to different measures (paper Section V-D).

## 6. Open items

- [ ] Round-2 review of the revised paper (see `paper/reviews/`), then revise.
- [ ] Complete and check the integration of the insight modules in the UI (track record panel, check-in nudges, divergence card, missing-night handling with `fillMissingNights`), if not finished in this revision.
- [ ] Decide on and add a licence file before making the repository public (none is present).
- [ ] Archive a release on Zenodo with a DOI before submission.
- [ ] Ethics application and OSF registration for the validation study (paper Section VII).
- [ ] Before submission, complete the target journal's declarations (data and code availability, tools used in preparing the manuscript) as its author guidelines require.

## 7. Branch

This revision is on the remote branch `revision-round1`, which starts from `main` at commit 0edd763. Merge it into `main` as in Section 1 (or open a pull request on GitHub and merge there), then delete the branch if you no longer need it.
