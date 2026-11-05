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

## Findings so far (5 Nov 2026)

- **Model:** state = [offset d, reaction-time anchor, webcam anchor] (bias-augmented Kalman filter, `web/src/twin/twin.ts`). Check-ins observe d; passive channels observe d + their anchor. Population mappings from DROZY. Webcam weight camRInflate = 160 (tuned on a separate cohort). Personal slope learning is off by default (it hurt in simulation and DROZY).
- **DROZY** (`results/drozy_summary.json`): website blink code vs EOG blink rate rho = 0.88; within-person r with KSS: RT 0.77, lapses 0.73, PERCLOS 0.53, blink duration 0.51, blink rate 0.35 (ns); mixed-model slopes RT 2.22 KSS/100 ms, PERCLOS 0.28/%, blink duration 1.92/100 ms. Leave-one-subject-out: one or two check-ins did NOT beat the population model (negative result, reported).
- **OpenNeuro ds004902:** KSS +2.0 after sleep deprivation (n = 33), RT +41 ms (n = 30); KSS and SSS on different people; RT vs SSS change rho = 0.25 (n = 25).
- **Simulation** (`results/sim_summary.json`, 300 test people, training cohort 200, tuning cohort 120): MAE prior 0.930; check-ins k=3 0.645; anchored twin k=3 0.625; no-anchor fusion no gain and overconfident; slopes hurt (+0.040 at k=8). Forecast KSS>=7 at +1 h: Brier 0.062 anchored vs 0.067 check-ins vs 0.098 prior.
- **Website:** real-time alarms (eyes closed >= 1 s, head drop), live gaze/head/blink tracking, in-app science explanations (`web/src/ui/science.ts` -> `docs/SCIENCE.md` via `npm run science-doc`), light theme default, Quit endpoint, desktop launcher in `app/`.
- **Tests:** 44 vitest tests (`npm test`), including invariants over virtual people and a check that the science text matches `results/`.

## Open items

- [ ] Paper: finish review rounds; verify Three-Process Model constants against Akerstedt et al. (2004) and the references flagged in `paper/`.
- [ ] Screenshot of the live camera view (needs a real face) for the paper and README.
- [ ] Validation study protocol: ethics, recruitment, pre-registration.
- [ ] Optional: run the MediaPipe pipeline on DROZY videos (aggregate results only).

## Writing rules for the paper

Short, plain and specific. No em dashes. Avoid "delve", "leverage", "robust", "crucial", "pivotal", "novel" used loosely. Never overclaim: say what the data show, with n and effect sizes, and list limitations. Never invent results, numbers or references; every citation must be a real paper you can name precisely. British or American spelling consistently (the draft uses British).
