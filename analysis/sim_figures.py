"""Figures for the simulation study (reads results/sim_*.csv and sim_summary.json written by web/scripts/simulate.ts).

Writes results/fig_sim_mae.pdf (two columns) and results/fig_sim_reliability.pdf (one column). Sized for an
IEEE two-column paper (column 3.5 in, page 7.16 in), 8-pt text. The README's copy (docs/img/simulation.svg)
is made from the PDF by scripts/readme_figures.sh.

Usage (from the repository root): analysis/.venv/bin/python -I analysis/sim_figures.py results
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

res = Path(sys.argv[1])
mae = pd.read_csv(res / "sim_mae.csv")
rel = pd.read_csv(res / "sim_reliability.csv")
summary = json.loads((res / "sim_summary.json").read_text())
plt.rcParams.update({"font.size": 8, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42, "ps.fonttype": 42})

COL = {"prior": "0.55", "checkins": "0.25", "twin": "#165d8f", "oracle": "#7c3aed", "noanchor": "#c2410c", "consider": "#0f8a6b"}
SCENARIO_LABEL = {
    "matched": "Matched to the twin",
    "misreport": "Clock off, sleep misreported",
    "nonlinear": "Nonlinear, heavy-tailed signals",
    "ratingbias": "Biased, noisier ratings",
    "autocorr": "Autocorrelated webcam noise",
    "trait": "Person-specific rhythm model",
    "debt": "Unrecorded sleep debt",
    "workday": "Ordinary 16-h day",
    "dissociation": "Ratings level off above KSS 5",
}

fig, ax = plt.subplots(1, 2, figsize=(7.16, 2.6), gridspec_kw={"width_ratios": [1.15, 1]})

# A: matched scenario, MAE against the number of check-ins
a = ax[0]
m = mae[mae.scenario == "matched"]
prior = m[m.method == "prior"].iloc[0]
a.axhspan(prior.mae_lo, prior.mae_hi, color=COL["prior"], alpha=0.12, lw=0)
a.axhline(prior.mae, color=COL["prior"], lw=1, ls="--")
a.text(8.2, prior.mae - 0.008, "rhythm model only", ha="right", va="top", fontsize=7, color="0.35")
series = [
    ("checkins", "Check-ins only", "o", "-"),
    ("consider", "Consider-covariance (bias not estimated)", "s", "--"),
    ("twin", "BlinkTwin (anchored)", "D", "-"),
    ("oracle", "Known-parameter filter (same noise model)", "^", ":"),
]
for meth, label, marker, ls in series:
    d = m[m.method == meth].sort_values("k")
    if meth == "checkins":  # with no check-ins, 'check-ins only' is the rhythm model
        d = pd.concat([prior.to_frame().T.assign(method="checkins"), d]).sort_values("k")
    k = d.k.astype(float).to_numpy()
    a.plot(k, d.mae.astype(float), color=COL[meth], marker=marker, ms=3.2, lw=1.3, ls=ls, label=label)
    a.fill_between(k, d.mae_lo.astype(float), d.mae_hi.astype(float), color=COL[meth], alpha=0.13, lw=0)
na = m[m.method == "noanchor"]
a.text(
    0.98, 0.98,
    f"Check-ins + passive without anchors:\nMAE {na.mae.min():.2f} to {na.mae.max():.2f} (off the scale)",
    transform=a.transAxes, ha="right", va="top", fontsize=6.5, color=COL["noanchor"],
)
a.set_xlabel("KSS check-ins in the first 16 h")
a.set_ylabel("MAE of latent KSS (24 h)")
a.set_xlim(-0.3, 8.3)
a.set_xticks([0, 1, 2, 3, 4, 6, 8])
lo = min(m[m.method.isin(["checkins", "consider", "twin", "oracle"])].mae_lo.min(), prior.mae_lo)
a.set_ylim(np.floor(lo * 20) / 20, max(prior.mae_hi, m[m.method.isin(["twin", "consider"])].mae_hi.max()) + 0.25)
a.legend(frameon=False, fontsize=6.2, loc="upper right", bbox_to_anchor=(1.0, 0.85), handlelength=2.2, labelspacing=0.3)
a.set_title("A  Matched scenario", loc="left", fontsize=8)

# B: paired difference BlinkTwin minus check-ins only, k = 3, every scenario
b = ax[1]
comps = [c for c in summary["comparisons"] if c["a"] == "twin_k3" and c["b"] == "checkins_k3"]
order = [s for s in SCENARIO_LABEL if any(c["scenario"] == s for c in comps)]
for i, s in enumerate(order):
    c = next(c for c in comps if c["scenario"] == s)
    y = len(order) - 1 - i
    b.errorbar(c["mean_diff"], y, xerr=[[c["mean_diff"] - c["ci"][0]], [c["ci"][1] - c["mean_diff"]]], fmt="D", ms=3.2, color=COL["twin"], ecolor=COL["twin"], elinewidth=1.1, capsize=2)
b.axvline(0, color="0.5", lw=0.8)
b.set_yticks(range(len(order)), [SCENARIO_LABEL[s] for s in reversed(order)], fontsize=7)
b.set_xlabel("MAE difference, BlinkTwin minus check-ins only\n(k = 3; negative favours BlinkTwin; 95% CI)")
b.spines["left"].set_visible(False)
b.tick_params(axis="y", length=0)
b.set_title("B  Paired difference by scenario", loc="left", fontsize=8)

fig.tight_layout(w_pad=1.2)
fig.savefig(res / "fig_sim_mae.pdf")
print("wrote", res / "fig_sim_mae.pdf")

# Reliability of the one-hour forecast of KSS >= 7 (matched scenario, k = 3)
fig, a = plt.subplots(figsize=(3.5, 3.0))
a.plot([0, 1], [0, 1], color="0.7", lw=0.8, ls="--")
labels = {"prior": "Rhythm model only", "checkins": "Check-ins only (k = 3)", "twin": "BlinkTwin (k = 3)"}
markers = {"prior": "s", "checkins": "o", "twin": "D"}
fc = pd.read_csv(res / "sim_forecast.csv")
for meth in ["prior", "checkins", "twin"]:
    d = rel[(rel.method == meth) & (rel.n >= 10)].sort_values("bin")
    f = fc[(fc.scenario == "matched") & (fc.method == meth)].iloc[0]
    a.plot(d.mean_forecast, d.observed, color=COL[meth], marker=markers[meth], ms=3.2, lw=1.1, label=f"{labels[meth]}: Brier {f.brier:.3f}")
a.set_xlim(0, 1)
a.set_ylim(0, 1)
a.set_xlabel("Forecast probability of KSS $\\geq$ 7 in 1 h")
a.set_ylabel("Observed frequency")
a.legend(frameon=False, fontsize=6.5, loc="upper left")
a.set_title("Reliability, matched scenario (bins with n $\\geq$ 10)", loc="left", fontsize=8)
fig.tight_layout()
fig.savefig(res / "fig_sim_reliability.pdf")
print("wrote", res / "fig_sim_reliability.pdf")
