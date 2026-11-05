# Handoff: arXiv release (5 November 2026)

Start here in the next session. `docs/PROJECT_NOTES.md` stays the standing brief (layout, data licences, writing rules).

## 1. Where things stand

- **GitHub `main` has everything.** The revision branch was merged into `main`; the release is tagged `v1.0-arxiv`, which is the version the paper cites. `revision-round1` can be deleted.
- **Preprint:** `paper/main.pdf` (17 pages, IEEE two-column, appendices included). Title: "BlinkTwin: An Open, In-Browser Model of Subjective Sleepiness That Anchors Webcam and Reaction-Time Signals to Self-Ratings".
- **arXiv package:** `paper/blinktwin-arxiv.tar.gz`, built by `paper/make_arxiv.sh`, which also checks that the package compiles on its own with pdflatex (as arXiv does).
- **Code:** MIT licence (`LICENSE`), citation file (`CITATION.cff`). Typecheck, all unit tests and the production build pass; an end-to-end browser check of the app and the privacy traffic check pass (see `results/privacy_check.json`).
- **Reviews:** two rounds of internal referee reports and responses are in `paper/reviews/`. Items still open after round 2 are marked in `paper/reviews/round2-response.md`; most need the DROZY recordings or new data.

## 2. Make your local copy identical to GitHub

If your local clone has nothing you want to keep:

```bash
git fetch origin --tags
git switch main
git reset --hard origin/main
```

If you have local work to keep, stash it first, update, then bring it back:

```bash
git stash push -u -m "local work"
git fetch origin --tags
git switch main
git pull --ff-only origin main
git stash pop
```

Then:

```bash
cd web && npm install && npx tsc --noEmit && npx vitest run
cd ../paper && latexmk -pdf main.tex && bash make_arxiv.sh
```

Git-ignored local data (`data/`, `results/drozy_*.csv`, `analysis/.venv`, `paper/arxiv/`) are not touched. If `npm install` changes `web/package-lock.json` only by removing `libc` fields, discard that change.

## 3. Posting to arXiv

1. Make the GitHub repository public first, so the link in the paper works, and check that the tag `v1.0-arxiv` is visible.
2. Upload `paper/blinktwin-arxiv.tar.gz` as the source. arXiv will compile `main.tex`; the bibliography (`main.bbl`) and all figures are inside.
3. Suggested categories: primary cs.HC (Human-Computer Interaction), cross-lists eess.SP (Signal Processing) and q-bio.QM (Quantitative Methods). A first submission to a category may need an endorsement.
4. Choose the arXiv licence for the paper text (for example CC BY 4.0); the code licence (MIT) is separate.
5. Paste the plain-text abstract from `paper/arxiv_abstract.txt` (under the 1920-character limit) and the title into the arXiv form.
6. Check the target journal's preprint and disclosure policies before submitting there later.

## 4. What changed for the arXiv release

- Title changed; "submitted for review" header replaced by a preprint header; code link and release tag in the first-page footnote and the Data and Code Availability section.
- The supplement is merged into the paper as appendices (one PDF for arXiv); `paper/supplement.tex` is gone.
- DROZY results are aggregate-only, as its licence and the project's data rule require: the per-subject figure is replaced by a table of means by test, and the per-subject panel of the MediaPipe figure is removed (in the paper and in the README's `docs/img/mediapipe_drozy.svg`).
- New simulation results: channel ablation (`web/scripts/ablation.ts`, `results/sim_ablation.*`), coverage, width and Monte Carlo standard errors at every number of check-ins, and per-person quantiles (`analysis/sim_tables.py`, `results/sim_table_*`).
- App screenshot figure in the System section (`paper/figures/app_now.png`, `app_timeline.png`), made by `web/scripts/screenshots.mjs` at twice the screen resolution.
- README figures replaced: charts are now SVG made from the paper's vector PDFs (`scripts/readme_figures.sh`), so they stay sharp at any zoom, and the dashboard screenshot is a 2x capture of the demo day.
- App fixes from the end-to-end check, including the reaction-test timing logic (a double press during feedback could schedule two stimuli; now in `web/src/probes/pvt-run.ts` with tests).
- Writing pass over the paper, README and docs for plain, specific prose.

## 5. Key results (from the committed result files)

| Result | Value | File |
|---|---|---|
| DROZY replay, leave one subject out, MAE | prior 1.73; PVT + webcam 1.47 (24 predictions, 13 subjects); one check-in 1.51; all three 1.38 (20 predictions, 11 subjects); per-test mean of others 1.39 | `results/drozy_twin_summary.json` |
| MediaPipe pipeline on DROZY near-infrared video | blink rate vs EOG rho 0.71 (undercount 13/min); blink duration vs KSS within person r 0.58 (0.46, n.s., at 30 fps only); PERCLOS < 0.5% in all 36 tests | `results/drozy_mediapipe_summary.json` |
| ds004902 | offset persistence r 0.29; group-mean offset MAE 1.45 vs personal 1.52 vs prior 1.53; Ingre mapping lowered the prior's MAE from 1.69 to 1.46 (28 people) | `results/openneuro_*.json` |
| Simulation, matched, 3 check-ins | BlinkTwin 0.629, check-ins 0.659, consider-covariance 0.673, prior 0.819, known-parameter filter 0.586; reaction test only 0.643, webcam only 0.641 | `results/sim_summary.json`, `results/sim_ablation.json` |
| Power, 10 days as one log | BlinkTwin minus check-ins -0.010 (SD 0.036); -0.028 to -0.047 with a mean-reverting offset; superiority over check-ins power 0.68 at 80, 0.93 at 150 | `results/power_summary.json` |

## 6. Open items for a journal version

- **Needs DROZY** (blocked in the cloud environment; run locally after `bash scripts/fetch_data.sh`): paired comparisons on common prediction sets; replay with the website's MediaPipe features and the PERCLOS guard; refit of the camera forward models on MediaPipe features (kappa 2.28 for blink duration); refitted-mapping and consider-covariance variants on DROZY; frame-rate downsampling; a lapse-based PVT model.
- **New data:** RGB webcam + EOG recording during desk work (15-20 people); browser PVT-B latency on at least 10 device combinations; UTA-RLDD for the camera pipeline on consumer webcams; the registered field study.
- **Code:** store the camera frame rate with each minute; suppress only prior-driven warnings on an assumed night; show the time to KSS 7 as a window or probability; power for the probe-rating and PVT co-primary outcomes; day-to-day offset variation in the simulator.
- **To verify by hand:** `PITCH_DOWN_SIGN` in `web/src/sensing/head.ts` on a real webcam; the privacy check with a real face; literature numbers graded P or S and DOIs marked "to confirm" in `docs/LITERATURE_COMPARISON.md`; journal facts in `docs/PUBLICATION_PLAN.md`; the linear recovery rate below the breakpoint (0.80 per hour) against Akerstedt et al. (2008).
- **Before a journal submission:** split the appendices back into a supplement if the journal asks for one, and complete its declarations (data and code availability, tools used in preparing the manuscript).
