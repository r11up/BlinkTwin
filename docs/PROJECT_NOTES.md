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

## Status (5 Nov 2026): arXiv release v1.0-arxiv

Everything is on `main` and tagged `v1.0-arxiv`; `HANDOFF.md` has the release steps, the merge commands and the open items. Summary:

- **Model**: forward measurement models with one anchor per passive signal (`web/src/twin/twin.ts`); the published Three-Process Model with breakpoint 12.2, ultradian component and sleep debt across days (`web/src/twin/tpm.ts`). PERCLOS is ignored when blinks do not reach full closure. The app fills nights that were not entered (`fillMissingNights`); research scripts do not.
- **Real data**: DROZY replay of the released model, leaving one subject out: MAE prior 1.73, passive 1.47, one check-in 1.51, all three 1.38; naive per-test mean 1.39 (`results/drozy_twin_summary.json`). MediaPipe pipeline on DROZY video: blink rate vs EOG rho 0.71, blink duration vs KSS within person r 0.58, PERCLOS failed (`results/drozy_mediapipe_summary.json`). ds004902: offset persistence r 0.29; sleep diary did not improve the prior; the Ingre et al. (2014) KSS mapping (9.68 - 0.46 A) lowered the prior's MAE from 1.69 to 1.46 (`results/openneuro_prior_summary.json`).
- **Simulation** (`results/sim_summary.json`, common random numbers, 9 scenarios, sensitivity, consider-covariance comparator, known-parameter reference): matched k = 3, BlinkTwin 0.629 vs check-ins 0.659 vs consider-covariance 0.673 vs prior 0.819; passive signals alone did not beat the prior; the no-anchor variant fails by construction (about 1.7). A mean-reverting offset (24 h) lowered error (0.605). Power for the field study (`results/power_summary.json`, 10 days replayed as one log): BlinkTwin minus check-ins -0.010 (SD 0.036), -0.028 to -0.047 with a mean-reverting offset; per-day replay reverses the sign (+0.019). Superiority over check-ins: power 0.68 with 80, 0.93 with 150; plan 120 analysed, 135 recruited (provisional).
- **App**: renamed and safer alerts, blink-meter baseline frozen during long closures, privacy check with a content security policy (library usage statistics blocked), benchmark, UI/UX overhaul, insight panels (track record, check-in suggestions, reactions vs ratings, sleep status). 105 tests pass.
- **Paper**: IEEE two-column preprint with appendices (`paper/main.tex`); arXiv package `paper/blinktwin-arxiv.tar.gz` built and tested by `paper/make_arxiv.sh`; referee reports and responses for two rounds in `paper/reviews/`. Code under the MIT licence; `CITATION.cff` for citation.
- **Docs**: `docs/HOW_IT_WORKS.md`, `docs/LITERATURE_COMPARISON.md`, `docs/PUBLICATION_PLAN.md`, `HANDOFF.md`.

## Next steps

- [ ] Finish the round-2 items listed as partly done or not done in `paper/reviews/round2-response.md` (most need DROZY or new data); see `HANDOFF.md`.
- [ ] With DROZY available locally: re-run the replay with the Ingre mapping, a paired comparison on the same predictions, the share within 1 KSS point, the blink-meter fix (`drozy_eyes.ts --fixed-baseline`), the MediaPipe "adaptive" variant, and blink-duration inflation 2.28.
- [ ] Browser PVT timing benchmark (photodiode, key-press robot, 3-5 devices).
- [ ] Verify on a laptop: `PITCH_DOWN_SIGN`, the looking-down gate, alert behaviour while reading and typing.
- [ ] Check every P/S-graded number and "to confirm" DOI in `docs/LITERATURE_COMPARISON.md`, and the journal facts in `docs/PUBLICATION_PLAN.md`.
- [ ] Choose a licence; archive a release on Zenodo; ethics application and OSF registration for the field study.

## Contributor

Utsav Poudel is the sole author and contributor; commits use utsav.poudel@outlook.com.au.

## Writing rules for the paper

Short, plain and specific. No em dashes. Avoid "delve", "leverage", "robust", "crucial", "pivotal", "novel" used loosely. Never overclaim: say what the data show, with n and effect sizes, and list limitations. Never invent results, numbers or references; every citation must be a real paper you can name precisely. British or American spelling consistently (the draft uses British).
