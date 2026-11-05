# BlinkTwin: project notes

Read this first when picking up the project. It says what the project is, where it stands and the rules for working on it.

## What it is

BlinkTwin is a laptop-scale personal digital twin of sleepiness (fatigue) and cognitive load. It runs as a website: the webcam gives blink and eye-closure signals (MediaPipe, on the device; video never leaves the page), a 3-minute reaction-time test (PVT-B) gives a performance signal, and validated questionnaires (Karolinska Sleepiness Scale, NASA-TLX) are used as occasional calibration points. A state-space model combines a published circadian/homeostatic prior (Three-Process Model) with these measurements, learns each person's own mapping from signals to ratings, and forecasts when the person will reach KSS 7.

It is a small, buildable slice of Utsav Poudel's QUT PhD proposal with Prof Graham Kerr ("Real-Time Multimodal Sensing and Digital Twin Modelling for Generalisable Prediction of Cognitive Load and Fatigue", Objective 3: a continuously updated, personalised twin under edge constraints). Focus is human cognitive load and fatigue only; leave out the animal (rat) material in the old drafts.

The goal is a Q1 journal paper. Candidate venues: IEEE Journal of Biomedical and Health Informatics, JMIR mHealth and uHealth, Computers in Biology and Medicine, Behavior Research Methods. A Q1 venue will want a human validation study; the protocol is part of the paper.

## Layout

| Path | What |
|---|---|
| `web/` | The website (Vite + TypeScript, no framework). `src/twin/` model, `src/sensing/` blink meter and camera, `src/probes/` PVT, `src/sim/` virtual participants, `tests/` vitest |
| `analysis/` | Python analyses of the public datasets (`.venv` from `requirements.txt`, Python 3.13) |
| `results/` | Analysis outputs (JSON summaries, figure PDFs). Aggregates only, never per-participant raw data |
| `paper/` | LaTeX manuscript (`main.tex`, `refs.bib`, `figures/`) |
| `scripts/fetch_data.sh` | Downloads the datasets into `data/raw/` (not in git) |

## Commands

```bash
cd web && npm install && npm test          # unit tests
cd web && npm run dev                      # website on http://localhost:5173
cd web && npm run simulate                 # simulation study -> results/
bash scripts/fetch_data.sh                 # datasets (accepting their terms)
analysis/.venv/bin/python -I analysis/openneuro_pvt_kss.py data/raw/openneuro-ds004902/participants.tsv results
cd paper && latexmk -pdf main.tex
```

## Data rules (licences)

- **DROZY** (Massoz et al., WACV 2016): research only, no redistribution, no modification, never show face images or video frames (none are marked publishable), never identify participants, always cite. Never commit DROZY files or per-frame derivatives. Paper figures show aggregate statistics only.
- **OpenNeuro ds004902** (Xiang et al., 2024, Sci Data 11:427): no re-identification. Only `participants.tsv` is used.
- Website screenshots for the paper use demo (synthetic) data or Utsav's own face only.

## Status (5 Nov 2026): revision after peer review round 1

Two internal referee reports are in `paper/reviews/round1-reviewer-A.md` (methods, statistics) and `round1-reviewer-B.md` (sleep science). Both: major revision. Done so far in response:

- **Model rebuilt** (`web/src/twin/twin.ts`): forward measurement models per signal (feature = a + b(KSS - 3) + anchor + noise), one anchor state per signal (PVT median RT, blink duration, PERCLOS) in its own units with slow drift, noise and autocorrelation from DROZY (`analysis/drozy_forward.py` -> `results/drozy_forward.json`). No tuning on simulated people. Personal slopes and the blink-rate workload channel removed. A minute with < 3 blinks is ignored for blink duration (bug fix).
- **Three-Process Model** now as published (`web/src/twin/tpm.ts`): breakpoint 12.2 with linear recovery below, 12-h ultradian component (dip 13:48), sleep debt carried across days. All constants checked by Reviewer B against Akerstedt et al. 2004 and Ingre et al. 2014.
- **Real-data evaluation of the released twin on DROZY**, leaving one subject out (`web/scripts/drozy_twin.ts` -> `results/drozy_twin_summary.json`): MAE rhythm model 1.73, passive only 1.47, check-in only 1.51, BlinkTwin 1.38 (n = 20-24 predictions, 14 subjects); stable to the assumed wake time.
- **OpenNeuro** (`web/scripts/openneuro_anchor.ts`): offset persistence normal sleep -> sleep deprivation r = 0.29 (n = 33). PVT columns: our t values equal the descriptor's but the descriptor attaches them to different measures; value ranges support the data dictionary.
- **Simulation rebuilt** (`web/scripts/simulate.ts`, 300 people per scenario, released defaults, oracle upper bound, matched + four robustness scenarios). Matched k = 3: BlinkTwin 0.634 vs check-ins 0.660 vs rhythm model 0.811; no-anchor fusion fails (about 1.7). Robustness k = 3: misreported sleep 0.701 vs 0.745; biased self-ratings 0.855 vs 0.906; nonlinear signals 0.634 vs 0.661; autocorrelated webcam 0.652 vs 0.660.
- **App**: alarms ignore eye closure while looking down; head drop counts only forward pitch (`PITCH_DOWN_SIGN` in `head.ts`, verify on a device: nodding down should make pitch positive); rate first then test; check-in screen hides the twin's estimate; objective (unanchored) reaction-test reading on the Now card.
- **MediaPipe on DROZY videos** (validation of the actual webcam pipeline): `web/validation/`, `analysis/drozy_mediapipe_compare.py` (in progress).
- **Tests**: 49 passing (`cd web && npm test`).

## Next steps

- [ ] Update `web/src/ui/science.ts` numbers to the new results, then `npm run science-doc`; update README numbers.
- [ ] Revise the paper with the new model and results; robustness scenarios go in a supplementary appendix with a one-line summary in the main text; remove obsolete analyses (inverse-regression calibration, personal slopes, RT-SSS coupling); keep a concise limitations paragraph; write `paper/reviews/round1-response.md`.
- [ ] Review round 2 with the same two referees, then revise.
- [ ] Reference fixes listed in Reviewer B's report (Xiang 2024 article 427; 2B-Alert J Sleep Res 28(2):e12725; PERCLOS source is NHTSA DOT HS 808 247, not Wierwille & Ellsworth 1994; missing DOIs).

## Writing rules for the paper

Short, plain and specific. No em dashes. Avoid "delve", "leverage", "robust", "crucial", "pivotal", "novel" used loosely. Never overclaim: say what the data show, with n and effect sizes, and list limitations. Never invent results, numbers or references; every citation must be a real paper you can name precisely. British or American spelling consistently (the draft uses British).
