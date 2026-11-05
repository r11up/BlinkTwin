# BlinkTwin

A laptop-scale personal digital twin of sleepiness and cognitive load that runs in the browser.

- **Signals:** webcam blink rate, blink duration and eye closure (PERCLOS) from MediaPipe face landmarks, computed on your device; a 3-minute psychomotor vigilance test (PVT-B).
- **Calibration:** short validated questionnaires, the Karolinska Sleepiness Scale (KSS) and NASA-TLX, used as occasional anchor points.
- **Model:** a Three-Process Model prior for the daily rhythm of sleepiness, a Kalman filter for the person's offset from it, and per-person Bayesian regressions that learn how their own signals map onto their own ratings.
- **Twin features:** current state with uncertainty, a forecast of when sleepiness reaches KSS 7, what-if scenarios (a break, a bedtime), and an explanation of which signal moved the estimate.

Privacy: video never leaves the page. Only numbers (blink and reaction-time summaries, ratings) are stored, in your browser.

Status: research prototype, not a medical device. It does not diagnose anything.

## Run it

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. Use **Demo day** to see the twin with synthetic data.

## Reproduce the analyses

```bash
bash scripts/fetch_data.sh   # downloads OpenNeuro ds004902 (participants.tsv) and DROZY; you accept their terms
python3.13 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt
analysis/.venv/bin/python -I analysis/openneuro_pvt_kss.py data/raw/openneuro-ds004902/participants.tsv results
cd web && npm test && npm run simulate
```

## Data

- Xiang C, Fan X, Bai D, Lv K, Lei X. A resting-state EEG dataset for sleep deprivation. Sci Data 11, 427 (2024). OpenNeuro ds004902.
- Massoz Q, Langohr T, François C, Verly JG. The ULg Multimodality Drowsiness Database (called DROZY) and examples of use. IEEE WACV 2016. Research use only; not redistributed here.

## Author

Utsav Poudel. Part of a PhD proposal on real-time multimodal sensing and digital twins of cognitive load and fatigue.
