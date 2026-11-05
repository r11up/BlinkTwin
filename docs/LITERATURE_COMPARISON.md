# BlinkTwin compared with published work

This document compares BlinkTwin's results with peer-reviewed studies that address the same or neighbouring problems: estimating sleepiness (KSS) or alertness (PVT), detecting drowsiness or blinks from a camera, combining a biomathematical fatigue model with sensing, and estimating workload. It lists the datasets those studies used. A condensed version is Table I of the paper (`paper/main.pdf`).

## Rules used

- **Only peer-reviewed journal or conference papers with a DOI.** Preprints (arXiv) are excluded from the comparison. Two arXiv software reports are cited in the paper only as the technical description of MediaPipe, not as evidence.
- **Every number has a verification grade.** The literature search was run through a web search tool. Publisher sites, PubMed Central, Crossref and doi.org could not be reached from the computing environment used, so no full text could be opened. Numbers therefore come from text that a web search returned for the paper's own page:
  - **Q**: a verbatim excerpt of the paper's own abstract or text.
  - **P**: a paraphrase of the paper's own page by the search tool.
  - **S**: a secondary source (a review or a citing paper).
  Only **Q** numbers are used in the paper's Table I. **P** and **S** numbers must be checked against the PDF before they are cited. A DOI marked "to confirm" was taken from a publisher page identifier but not from the DOI itself.
- **Comparability is stated for every row.** Most published numbers are not on the same scale or task as BlinkTwin's. Accuracy on acted (posed) drowsiness is much higher than on real drowsiness and is never placed next to ours.

## 1. BlinkTwin's own numbers

| Problem | Data | Validation | Metric | BlinkTwin |
|---|---|---|---|---|
| Predict a person's KSS rating at a later test | DROZY, 14 adults, 36 tests over about 28 h awake | Leave one subject out; rating predicted from earlier events | MAE (KSS points), 95% CI over subjects | Prior alone 1.73 (1.17 to 2.36); PVT + webcam 1.47 (1.09 to 1.91); one check-in 1.51 (0.97 to 2.26); all three 1.38 (0.93 to 2.04). Naive per-test mean of other subjects 1.39 |
| Predict KSS from the Three-Process Model alone | OpenNeuro ds004902, 28 adults with a sleep diary, 2 sessions | Out of sample (no fitting) | MAE; share within 1 KSS point | Default mapping 1.69, 36% within 1; Ingre et al. (2014) mapping 1.46, 45% within 1 |
| Does a person's offset persist across sessions? | ds004902, 33 adults | Correlation of offsets 1 to 4 weeks apart | Pearson r | 0.29 (95% CI -0.05 to 0.58) |
| Blink rate against EOG (landmark pipeline) | DROZY, 36 tests | Per test | Spearman rho; bias | 0.88; -5.4 blinks/min |
| Blink rate against EOG (website MediaPipe pipeline on video) | DROZY near-infrared video, 36 tests | Per test; within person | Spearman rho; within-person r | 0.71; 0.65 |
| Blink duration tracks KSS (website pipeline) | DROZY video | Within person | Repeated-measures r | 0.58 (p = 0.004) |
| Latent KSS, forecast of KSS >= 7 | Simulation, 300 virtual people per scenario | Known truth | MAE, Brier, AUROC | See paper Section VI (simulation only) |

## 2. Datasets used for this problem

| Dataset | People | Drowsiness | Sensors | Labels | Access | Used by | Notes for BlinkTwin |
|---|---|---|---|---|---|---|---|
| **DROZY** (Massoz et al., WACV 2016, doi:10.1109/WACV.2016.7477715) | 14 (3 M, 11 F) | Real: 3 sessions over 28-30 h awake | Kinect v2 near-infrared video, 68 landmarks, EEG, EOG, ECG, EMG | KSS, 10-min PVT | Research licence, no redistribution | This work; Maior et al. 2020 | Our main real-data benchmark. 42 nominal tests, 36 usable. Frame rate drops to about 15 fps in 16 tests. |
| **Liège multi-timescale dataset** (Massoz et al., Sensors 2018, doi:10.3390/s18092801) | 35 recruited, 29 evaluated | Real: up to 30 h awake | Kinect v2 near-infrared, 30 fps | 10-min PVT reaction times | Reaction times and eyelid-distance sequences released | Massoz et al. 2018 | Same lab as DROZY, more people. Candidate for testing PVT forecasting from eyelid signals. |
| **UTA-RLDD** (Ghoddoosian et al., CVPRW 2019, doi:10.1109/CVPRW.2019.00027) | 60 | Real, self-labelled using KSS descriptions (alert, low vigilant, drowsy) | Participants' own phone or webcam RGB video | 3 classes per video | Public for research | Ghoddoosian et al. 2019 | **Best next dataset for BlinkTwin**: consumer RGB webcams, like the website. Would test the MediaPipe pipeline and PERCLOS guard on RGB video. |
| **NTHU-DDD** (Weng et al., ACCV workshops 2016; DOI not confirmed) | 36 | **Acted** | Active infrared + RGB | Frame labels of posed behaviour | Research | Many deep-learning papers | Posed drowsiness; accuracies near 85-99% are not comparable with real drowsiness. |
| **YawDD** (Abtahi et al., MMSys 2014, doi:10.1145/2557642.2563678) | Not confirmed | **Acted** yawning | In-car RGB | Yawning, talking, singing | Research | Yawning detectors | No sleepiness ground truth. Not suitable. |
| **OpenNeuro ds004902** (Xiang et al., Sci Data 2024, doi:10.1038/s41597-024-03268-2) | 71 | Real: normal sleep vs one night of total sleep deprivation | Resting EEG; participant table | KSS, SSS, PVT summaries, sleep diary | Open (OpenNeuro) | This work | KSS and PVT were collected in different people; good for testing the prior and offset persistence. |
| **Airline field data** (Ingre et al., PLoS ONE 2014, doi:10.1371/journal.pone.0108679) | 106 or 136 aircrew (sources disagree, P) | Real, field | Sleep diaries | KSS 3 times per flight day | Not public | Ingre et al. 2014 | Source of the refitted KSS mapping we tested. |
| **WRAIR / 2B-Alert sleep-deprivation studies** (Reifman et al. 2019, doi:10.1111/jsr.12725; Subramaniyan et al. 2025, doi:10.1093/sleep/zsaf149) | 21; 26 | Real: 62 h total sleep deprivation | Smartphone PVT; face video | PVT reaction times | Not public | Unified Model of Performance papers | The closest work, but the data are not public and the outcome is PVT, not KSS. |
| **ICU nurse field data** (Knock et al., Sleep 2021, doi:10.1093/sleep/zsab146) | 21 | Real, rotating shifts | Actigraphy, light | KSS | Not public | Knock et al. 2021 | Reports the share of KSS predictions within 1 point, which we now also report. |
| **COLET** (Ktistakis et al., Comput Methods Programs Biomed 2022, 224:106989; DOI to confirm) | 47 | Workload, not drowsiness | Eye tracker | NASA-TLX | Public | Ktistakis et al. 2022 | A public dataset with NASA-TLX labels; a possible test for the workload component, but with a research eye tracker. |

## 3. Predicting sleepiness (KSS) and alertness (PVT) with models

| Study | Data, n | Outcome | Inputs | Personalised | Validation | Reported result (grade) | Comparable? |
|---|---|---|---|---|---|---|---|
| Ingre et al. 2014, *PLoS ONE* 9(10):e108679, doi:10.1371/journal.pone.0108679 | Airline crews | KSS | Three-Process Model from sleep | Random person intercepts | In-sample mixed model | Residual SD 1.42, between-person SD 0.84, refitted mapping KSS = 9.68 - 0.46 A (P); residual 1.46 with model-generated sleep (Q) | Same scale and model. An in-sample residual SD of about 1.4 implies an MAE of roughly 1.1 to 1.3 if errors are Gaussian (our rough conversion, not a published value). Our out-of-sample prior MAE is 1.73 on DROZY and 1.69 on ds004902; 1.46 with their mapping. |
| Knock et al. 2021, *Sleep* 44(11):zsab146, doi:10.1093/sleep/zsab146 | 21 ICU nurses | KSS | Arousal-dynamics model, shift schedule, sleep, light | No | Prospective field comparison | 56-60% of KSS predictions within 1 point on day shifts, 48-52% on night shifts (Q) | Same scale. Our prior on ds004902: 36% within 1 (default) and 45% (Ingre mapping). |
| Ahlstrom et al. 2013, *Transp Res Part C* 26:20-32 (DOI to confirm) | 24 drivers | Will KSS reach 8 within 2 h? | Sleep/Wake Predictor + eye-movement test | No | Not retrieved | More than 80% correct classifications (Q); AUC 0.86 with eyes vs 0.64 model alone (S) | Closest model-plus-eyes forecast. Different threshold, horizon and metric; our forecast results are simulation only. |
| Sandberg et al. 2011, *IEEE Trans Intell Transp Syst* 12(1):97-108, doi:10.1109/TITS.2010.2077281 | 12 drivers in a simulator | Sleepy vs alert (KSS-based) | Driving indicators + Sleep/Wake Predictor | No | Held-out data | Best single indicator 0.72 (mean of sensitivity and specificity) (Q); adding the model improved detection (P) | Same idea (model + sensing). Binary task. |
| Subramaniyan et al. 2025, *Sleep* 48(11):zsaf149, doi:10.1093/sleep/zsaf149 | 26 adults, 62 h awake | PVT mean RT | 1 min of face video into a personalised Unified Model of Performance | Yes | Cross-validated (P) | RMSE 36 ms (SE 5) against 30 ms rested within-person variability (Q: verbatim in two independent searches of the paper's own page; a third search returned a paraphrase) | **Closest architecture** (camera features feed a personalised biomathematical model). Outcome is PVT, not KSS. |
| Priezjev et al. 2023, *J Sleep Res*, doi:10.1111/jsr.13626 | 301 people, 12 studies | PVT mean RT | Unified Model of Performance | Group and individual | Across studies | Group-average RMSE 43 ms (P); 80% of PVTs inside prediction intervals (P); 81% of individual models indistinguishable in 3 of 4 PVTs (Q) | PVT scale. Reference for group vs individual calibration. |
| Reifman et al. 2019, *J Sleep Res* 28(2):e12725, doi:10.1111/jsr.12725 | 21 adults, 62 h awake | PVT mean RT | In-app PVT + model with Bayesian learning | Yes | Prospective | After 12 PVTs, accuracy comparable to the peak with all PVTs (Q) | An app twin like ours, for PVT. Shows that personal learning needs many tests, which matches our weak DROZY gains from one or two check-ins. |
| Liu et al. 2017, *J Sleep Res* 26(6):820-831, doi:10.1111/jsr.12535 | 18 adults | PVT mean RT | Model + PVTs | Yes, extended Kalman filter | Simulated real time | Halving PVT frequency did not notably hamper individualisation (P) | Methodologically closest (Kalman-filter personalisation). |
| Van Dongen et al. 2007, *Sleep* 30(9):1129-1143, doi:10.1093/sleep/30.9.1129 | 88 h sleep deprivation | PVT lapses | Two-process model, Bayesian traits and states | Yes | Prospective forecasts | Individualised predictions improved on the population model (S) | Conceptually close; PVT outcome. |
| Rajaraman et al. 2008, *J Appl Physiol* 104(2):459-468, doi:10.1152/japplphysiol.00877.2007 | Sleep deprivation | PVT lapses | Two-process model + PVTs | Yes | Not retrieved | No number retrieved | PVT outcome. |
| Abdullah et al. 2016, *Proc. UbiComp*, 178-189, doi:10.1145/2971648.2971712 | In the wild | PVT response time | Passive phone use | No | Not retrieved | RMSE 80.64 ms (Q) | Passive device signals predict alertness in daily life; PVT target. |
| Riedy et al. 2020, *Chronobiol Int* 37(4), doi:10.1080/07420528.2020.1746798 | 173 police officers | Model-implied peak KSS | FAID Quantum from actigraphy | No | Field | Observed 5.7 (SD 1.3) vs predicted 5.5 (SD 1.2) (Q) | Group means only. |
| Bermudez et al. 2016, *PLoS ONE* 11(3):e0151770, doi:10.1371/journal.pone.0151770 | Lab protocols | PVT and others | Self-rated alertness, circadian phase, time awake, sleep loss | Individual effects | Model comparison | Self-rated alertness alone was not an accurate predictor of PVT (Q) | Supports showing an objective check beside the subjective estimate. |

## 4. Drowsiness from face video and eyelid sensors

| Study | Data, n | Drowsiness | Sensor | Task | Validation | Reported result (grade) | Comparable? |
|---|---|---|---|---|---|---|---|
| Maior et al. 2020, *Expert Syst Appl* 158:113505, doi:10.1016/j.eswa.2020.113505 | **DROZY** | Real | Near-infrared video, eye aspect ratio | Binary drowsy vs awake | Inter-subject | 94.44% accuracy; 16.1 warnings per drowsy subject, none for awake (Q/S) | **Same dataset and eye signal.** Binary classification, not KSS regression, so not comparable with our MAE. |
| Massoz et al. 2018, *Sensors* 18(9):2801, doi:10.3390/s18092801 | Liège dataset, 29 people (not DROZY) | Real | Near-infrared video | Binary, labels from median PVT RT | Leave one subject out | Accuracy 70%, 85%, 89%, 94% for 5, 15, 30, 60 s windows (Q) | Same lab and protocol type; binary PVT-based target. |
| Ghoddoosian et al. 2019, *CVPRW*, 178-187, doi:10.1109/CVPRW.2019.00027 | UTA-RLDD, 60 | Real | Phone and webcam RGB | 3 classes per video | 5 folds by subject (S) | HM-LSTM 65.2%; human judges 57.8% (Q) | Shows that real drowsiness from consumer cameras is hard even for people. |
| Daley et al. 2020, *Front Artif Intell* 3:17, doi:10.3389/frai.2020.00017 | 25 h sleep deprivation | Real | Eye and face tracking | PVT normal vs impaired | Not retrieved | Balanced accuracy 50.0-81.6% across 60 model settings (Q) | Binary PVT target. |
| Wilkinson et al. 2013, *J Clin Sleep Med* 9(12):1315-1324, doi:10.5664/jcsm.3278 | Restricted sleep | Real | Infrared reflectance oculography (Optalert) | Detect >= 3 or >= 5 PVT lapses per minute | Group | Sensitivity 77% and 100%, specificity 85% and 83% (Q) | Dedicated eyelid sensor; a ceiling a webcam is unlikely to reach. |
| Anderson et al. 2013, *J Clin Sleep Med* 9(9):907-920, doi:10.5664/jcsm.2992 | 29 adults, 30 h constant routine (S) | Real | Optalert | Dose-response | Group | PVT lapses, mean RT and KSS rose with the prior ocular score, p < 0.0001 (Q) | Same constructs; no per-person error. |
| Ingre et al. 2006, *J Sleep Res* 15(1):47-53, doi:10.1111/j.1365-2869.2006.00504.x | 10 shift workers | Real | EOG | KSS vs blink duration | Within person | Blink duration rose with KSS (quadratic trend p = 0.003); large differences in baseline between people (p < 0.001) (Q) | Supports per-person anchors for blink duration. |
| Schleicher et al. 2008, *Ergonomics* 51(7):982-1010, doi:10.1080/00140130701817062 | Driving simulator | Real | EOG | Which ocular measures track sleepiness | Not retrieved | Blink duration among the best indicators (Q) | Qualitative agreement with our blink-duration result. |
| Abe 2023, *Sleep Advances* 4(1):zpad006, doi:10.1093/sleepadvances/zpad006 | Review | - | PERCLOS technologies | Review | - | PERCLOS is among the most validated indices; no single index established for real-world driving (Q/P) | Context. |

## 5. Blink detection against a reference

| Study | Data | Reference | Metric | Reported result (grade) | Comparable? |
|---|---|---|---|---|---|
| Schmidt et al. 2018, *Behav Res Methods* 50(3):1088-1101, doi:10.3758/s13428-017-0928-0 | Two driving-simulator studies | Simultaneous EOG | Event detection rate | Above 90% when alert and driving manually; 70-80% under automation; lower when drowsy (S) | The only camera-against-EOG comparison found. Event-level, while ours is per-test rate agreement (rho 0.88 landmarks, 0.71 MediaPipe). Its drop in drowsy phases matches our pattern. |

No peer-reviewed validation of MediaPipe's eyeBlink blendshapes against EOG was found. Our DROZY result (Section V-B of the paper) may be one of the first, but the search was cut short, so this is not a claim of priority.

## 6. Workload (cognitive load) estimation

BlinkTwin's workload estimate is not evaluated; these studies set targets for a future evaluation.

| Study | Data, n | Sensor | Target | Validation | Reported result (grade) | Relevance |
|---|---|---|---|---|---|---|
| Kosch et al. 2018, *Proc. CHI*, paper 436, doi:10.1145/3173574.3174010 | 20, N-back | Eye tracker, smooth pursuit | N-back level | Person-independent (binary) | 99.5% binary, 88.1% three levels (Q) | Active gaze probe and task labels; not comparable. |
| Ktistakis et al. 2022 (COLET), *Comput Methods Programs Biomed* 224:106989 (DOI to confirm) | 47 | Eye tracker | NASA-TLX, low vs high | Not retrieved | Up to 88% binary (P) | NASA-TLX labels, but a research eye tracker. |
| Vasta et al. 2025, *Electronics* 14(3):467, doi:10.3390/electronics14030467 | Computer tasks | Webcam blink rate vs eye tracker | Task demand | Within subjects | Webcam measured load "as accurately as a scientific-grade eye tracker" (Q) | Same sensor class; no predictive metric. A companion study (Biondi et al. 2023, DOI not confirmed) found no load effect in webcam blink rate, so evidence conflicts; BlinkTwin no longer uses blink rate for workload. |
| Tao et al. 2019, *Int J Environ Res Public Health* 16(15):2716, doi:10.3390/ijerph16152716 | 91 studies | Many | Mental workload | Systematic review | Eye measures showed a workload effect in 66% of reports (P) | Context. |
| Grier 2015, *Proc HFES Annu Meet* 59(1):1727-1731, doi:10.1177/1541931215591373 | 1173 TLX scores, 237 publications | NASA-TLX | Score distribution | Meta-analysis | n as stated (P) | Reference values for BlinkTwin's default context demands. |
| Hertzum 2021, *Ergonomics* 64, doi:10.1080/00140139.2021.1876927 | 556 studies | NASA-TLX | Scores by domain | Meta-analysis | Mean TLX from 35 (leisure) to 56 (manual labour) (P) | Our defaults (15 to 65) span a wider range than these study means. |
| Pulick et al. 2025, *JMIR Form Res* 9:e73265, doi:10.2196/73265 | 148 people, daily EMA | Self-report | Lapse (not fatigue) | Within person | Idiographic state-space models reliably best only with at least 30 days of data (P) | Suggests personal learning needs weeks of data, consistent with our weak cross-session offset persistence. |
| Liu et al. 2023, *West J Emerg Med* 24(4):693-702, doi:10.5811/westjem.58139 | 110 staff, 1542 shifts | Smartwatch | Fatigue questionnaire change | Held-out test | AUC 0.838 (Q) | Questionnaire label plus passive data in shift workers. |

## 7. What the comparison shows

1. **No published KSS-regression benchmark on DROZY or ds004902 was found.** Published DROZY results are binary classifications (for example 94.44% inter-subject accuracy; Maior et al. 2020), which cannot be compared with an MAE. Our DROZY and ds004902 numbers are therefore a first reference point on these public datasets, not a demonstration that BlinkTwin is more accurate than other systems.
2. **On the KSS scale, our errors are in the range expected for the Three-Process Model.** Ingre et al. report an in-sample residual SD of about 1.4 KSS points in field data; our out-of-sample prior MAE is 1.7, and 1.46 with their refitted mapping. Knock et al. predicted 48-60% of field KSS ratings within one point; our prior reached 36-45% on ds004902, with a single rating 1-4 weeks apart adding nothing.
3. **The closest designs predict PVT, not KSS.** Subramaniyan et al. (2025) feed face-video features into a personalised Unified Model of Performance and reach an error close to the PVT's own within-person variability. Their editorial notes that video alone is still weaker than a real PVT, which supports keeping the PVT in BlinkTwin.
4. **Personal learning needs many observations.** 2B-Alert reached its best accuracy after about 12 PVTs, and idiographic models of daily self-reports needed about 30 days. This fits our finding that one or two check-ins help little on DROZY and that offsets persist only weakly between sessions weeks apart.
5. **Real drowsiness from consumer cameras is hard.** On UTA-RLDD, the best video model reached 65.2% on three classes and people 57.8%. Accuracies of 85-99% come from acted datasets.
6. **To be comparable in future work, BlinkTwin should report** the share of KSS predictions within one point, AUROC for KSS >= 7 on real data, and event-level blink detection against EOG, and should test the MediaPipe pipeline on UTA-RLDD (consumer RGB webcams).

## 8. Open items

- Check every P and S number against the PDF before citing it (publisher sites, PubMed Central, Crossref and doi.org could not be reached during this search).
- Confirm the DOIs marked "to confirm" (Ahlstrom et al. 2013; Ktistakis et al. 2022).
- Search further for: KSS regression on other public datasets (for example SEED-VIG, which uses PERCLOS as a vigilance label), and peer-reviewed validations of MediaPipe blink detection against EOG.
