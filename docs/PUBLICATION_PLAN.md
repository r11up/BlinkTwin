# Publication plan

Where to publish BlinkTwin, in what order, and what each venue will need. Written on 5 November 2026 from the evidence in the repository and a venue survey.

**Verification status.** Quartiles and SJR values come from Scimago journal pages as returned by a web search on 5 Nov 2026; the pages themselves could not be opened from the computing environment used, so check each value on scimagojr.com before relying on it. Impact factors, article fees, word limits and review times were **not** verified and must be checked on each journal's site. Acceptance chances are judgements, not data.

## 1. Honest position of the work today

What a senior reviewer will see:

- **Strengths.** Open, on-device implementation; the published Three-Process Model implemented and tested; forward measurement models fitted within person; evaluation of the released model on two public datasets; the website's actual webcam pipeline run on DROZY video against EOG, including a failure (PERCLOS on near-infrared video) that was found and guarded against; honest negative results; a pre-specified protocol; a reproducible code base with tests.
- **Weaknesses that decide the venue.**
  1. On DROZY the full model's MAE (1.38) is no better than a naive baseline that predicts each test by the other subjects' mean rating (1.39), and all intervals overlap (14 subjects).
  2. No data from an ordinary RGB laptop webcam has been analysed. DROZY is near-infrared.
  3. No prospective human data. The main claim, that check-ins plus passive signals track a person's sleepiness in daily life, is untested.
  4. Browser reaction-time timing has not been measured on real devices.
  5. The workload component and the alerts are not evaluated.

A health-informatics or sleep journal will not accept a claim of better estimation on this evidence. A methods or tool journal can accept a carefully framed paper now.

## 2. Venue options

| Venue | Quartile (SJR 2025, Scimago) | Fit now | Fit after the field study | Notes |
|---|---|---|---|---|
| **Behavior Research Methods** | Q1, Experimental and Cognitive Psychology (SJR 2.382) | **Good**, framed as an open measurement tool tested on public data | Good | Publishes software and method papers with validation against a reference. Reviewers will ask for browser timing data. |
| **Computer Methods and Programs in Biomedicine** | Q1, Health Informatics; Software (SJR 1.233) | Good (method + open software) | Good | Public-data validation is common there. |
| **Computers in Biology and Medicine** | Q1, Health Informatics (SJR 1.375) | Moderate | Good | |
| **Biomedical Signal Processing and Control** | Q1, Signal Processing; Health Informatics (SJR 1.336) | Moderate | Moderate | Signal-processing novelty is modest. |
| **IEEE Journal of Biomedical and Health Informatics** | Q1 (best quartile; category quartile not confirmed) (SJR 1.624) | Weak (evidence too thin) | **Best target** | The manuscript is already in IEEE two-column format for this journal. |
| **Journal of Sleep Research** | Q1 (SJR 1.534) | Weak | Good | Published 2B-Alert, the closest existing system. |
| **JMIR mHealth and uHealth** | Q1, Health Informatics (SJR 1.888) | Weak | Good | A laptop app is at the edge of its mobile scope. |
| JMIR Formative Research | **Q2** (SJR 0.763) | High | High | Safety net; not Q1. |
| JMIR Research Protocols | **Q2** (SJR 0.533) | Protocol only, after ethics approval | n/a | Optional; registering on OSF is enough. |
| Sensors (MDPI), IEEE Access | Q1 or Q2 depending on category | High | High | Likely to accept but carry less weight in this field. |
| npj Digital Medicine, JMIR, Sleep, Sleep Health, Accident Analysis & Prevention, IJHCS | Q1 | Very low | Low to moderate | Need prospective clinical or field evidence. |

## 3. Recommended sequence

1. **Now (paper 1, tool and public-data evaluation).** Target *Behavior Research Methods*; fallback *Computer Methods and Programs in Biomedicine*. Frame it as an open, on-device measurement tool for subjective sleepiness, evaluated on public data, with its limits in the abstract (the naive-baseline tie on DROZY; PERCLOS failing on near-infrared video). Before submitting, add the items in Section 4 marked "needed now". BRM uses the Springer template and APA-style references, so the IEEE manuscript would need reformatting; the content carries over.
2. **Register the validation study** (Section VII of the paper) on OSF Registries after ethics approval. Use TRIPOD+AI as the reporting guideline for the prediction model; SPIRIT does not strictly apply to a non-interventional study but its checklist is useful.
3. **After the field study (paper 2, main validation; 65 analysed, 75 recruited).** Target *IEEE J-BHI* (the current IEEE format), with *Journal of Sleep Research* or *JMIR mHealth and uHealth* as alternatives. This paper tests the pre-registered hypotheses on real users.
4. **Software.** Archive each release on Zenodo with a DOI and cite it in both papers.

## 4. What to add before submission

| Item | Why | Needs participants? | Status |
|---|---|---|---|
| Browser PVT timing benchmark (photodiode on the screen and a key-press robot, 3 to 5 devices and browsers) | Every tool reviewer will ask; latency of tens of ms changes lapses at 355 ms | No | **Needed now** |
| Re-run the DROZY replay with the refitted KSS mapping (9.68 - 0.46 A) and with the new blink-meter fix; report the share within 1 KSS point | The mapping improved the prior on ds004902; the DROZY replay is the main real-data result | No (DROZY access) | **Needed now** |
| Paired comparison on the same 20 DROZY predictions for all conditions, with a paired bootstrap | Current conditions differ in n (20 vs 24) | No | **Needed now** |
| Run the MediaPipe pipeline on UTA-RLDD (consumer RGB webcams, real drowsiness) | Shows whether blink measures and the PERCLOS guard work on ordinary webcams | No | Strongly recommended |
| Privacy check: record all network traffic while the camera runs and show that no video, image or landmark data leave the page | Supports the on-device claim | No | Recommended |
| Compute benchmark (frames per second and CPU use on typical laptops) | Feasibility on ordinary hardware | No | Recommended |
| Small RGB pilot (5 to 10 people) with EOG and a webcam, including reading, typing and looking-down segments | Validates blink duration, long closures and alert false-alarm rates on the real pipeline | Yes (ethics) | Before paper 2 |
| Field study (75 recruited, 65 analysed) with a laboratory subset | Tests the main claim | Yes (ethics, registration) | Paper 2 |

## 5. Points a senior reviewer will press on, and the planned answer

- **"The model does not beat a naive baseline."** Report it in the abstract. Explain that the baseline knows the protocol's average trajectory, which daily life does not provide, and that the prior's night-time level is the main error source; show the refitted-mapping result as the evidence-based fix.
- **"The simulation is circular."** Already addressed with misspecified scenarios and an oracle bound; keep simulation claims secondary and labelled as such.
- **"Is this a digital twin?"** Define the term once and use "state-space model" in the technical text (done).
- **"Self-report as the reference is unsafe."** The objective check and the divergence indicator in the app answer this; the protocol has an objective secondary outcome.
- **"Browser timing."** The timing benchmark answers this.
- **"Small n."** State it, give subject-level bootstrap intervals, and keep conclusions to what n = 14 and n = 33 can support.

## 6. Disclosure requirements to check at submission

Each journal has its own policy on declaring software and writing tools used in preparing a manuscript, and on data and code availability. Check the target journal's current author guidelines and complete its declarations at submission.
