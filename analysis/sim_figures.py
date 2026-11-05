"""Figures for the simulation study (reads results/sim_*.csv written by web/scripts/simulate.ts).

Usage: python -I sim_figures.py <results_dir>
"""
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

res = Path(sys.argv[1])
mae = pd.read_csv(res / "sim_mae.csv")
cam = pd.read_csv(res / "sim_camera_weight.csv")
plt.rcParams.update({"font.size": 8, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42})

style = {
    "checkins": ("Check-ins only", "0.35", "o", "-"),
    "noanchor": ("Check-ins + passive, no anchoring", "#c2410c", "s", "--"),
    "anchor": ("Check-ins anchor passive signals (BlinkTwin)", "#165d8f", "D", "-"),
    "slopes": ("BlinkTwin + personal slopes", "#7c3aed", "^", ":"),
}
fig, ax = plt.subplots(1, 2, figsize=(7.2, 2.9), gridspec_kw={"width_ratios": [1.55, 1]})
a = ax[0]
prior = mae[(mae.method == "prior")].iloc[0]
passive = mae[(mae.method == "passive")].iloc[0]
a.axhline(prior.mae, color="0.6", lw=1, ls="--")
a.text(0.8, prior.mae + 0.008, "rhythm model only", va="bottom", fontsize=7, color="0.4")
a.axhline(passive.mae, color="#c2410c", lw=0.8, ls=":")
a.text(0.8, passive.mae + 0.008, "passive signals only, population mapping", va="bottom", fontsize=7, color="#c2410c")
for m, (label, color, marker, ls) in style.items():
    d = mae[(mae.method == m) & (mae.k >= 1)].sort_values("k")
    a.plot(d.k, d.mae, color=color, marker=marker, ms=3.5, lw=1.4, ls=ls, label=label)
    a.fill_between(d.k, d.mae_lo, d.mae_hi, color=color, alpha=0.12, lw=0)
a.set_xlabel("KSS check-ins in the first 16 h")
a.set_ylabel("MAE of latent KSS over 24 h")
a.set_xlim(0.6, 8.4)
a.set_ylim(0.5, 0.98)
a.set_xticks([1, 2, 3, 4, 6, 8])
a.legend(frameon=False, fontsize=6.5, loc="lower left")
a.set_title("A  Accuracy against the number of check-ins", loc="left", fontsize=8)

b = ax[1]
c = cam.sort_values("camRInflate")
x = c.camRInflate.clip(upper=1e4)
b.plot(x, c.mae, color="#165d8f", marker="o", ms=3)
b.set_xscale("log")
b.set_xlabel("Variance inflation per webcam minute")
b.set_ylabel("MAE, tuning cohort (k = 3)")
b.set_title("B  Weight of each webcam minute", loc="left", fontsize=8)
ticks = list(x)
b.set_xticks(ticks, [("off" if v >= 1e4 else f"{int(v)}") for v in ticks], rotation=45)
fig.tight_layout()
fig.savefig(res / "fig_sim_mae.pdf")
print("wrote", res / "fig_sim_mae.pdf")
