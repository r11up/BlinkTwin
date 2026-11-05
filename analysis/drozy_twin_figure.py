"""Figure for the leave-one-subject-out replay of the released twin on DROZY.

Reads results/drozy_twin_summary.json (written by web/scripts/drozy_twin.ts) and writes
results/fig_drozy_twin.pdf (one IEEE column wide). Aggregates only.

Usage: python -I drozy_twin_figure.py <results_dir>
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

res = Path(sys.argv[1])
d = json.loads((res / "drozy_twin_summary.json").read_text())
main = d["wake_0700"]
rows = [
    ("Rhythm model only", main["rhythm model only"], "0.55"),
    ("PVT only", main["PVT only"], "0.55"),
    ("PVT + webcam", main["passive only (PVT + webcam)"], "0.55"),
    ("Check-in only", main["check-in at test 1 only"], "0.35"),
    ("Check-in + PVT", main["check-in at test 1 + PVT"], "0.35"),
    ("BlinkTwin (all three)", main["BlinkTwin: check-in at test 1 + PVT + webcam"], "#165d8f"),
    ("Mean KSS of that test*", d["naive"]["LOSO mean KSS of the test"], "#c2410c"),
    ("Carry test-1 rating*", d["naive"]["carry test-1 KSS forward"], "#c2410c"),
]
plt.rcParams.update({"font.size": 7.5, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42})
fig, ax = plt.subplots(figsize=(3.5, 2.3))
for i, (label, r, color) in enumerate(rows):
    y = len(rows) - 1 - i
    ax.plot(r["ci"], [y, y], color=color, lw=1.4)
    ax.plot(r["mae"], y, "o", color=color, ms=4)
    ax.text(4.75, y, f"{r['mae']:.2f}  ({r['n']})", va="center", ha="left", fontsize=6.5, color="0.25")
ax.set_yticks(range(len(rows)), [r[0] for r in rows][::-1])
ax.set_xlabel("MAE of predicted KSS, 95% CI")
ax.text(4.75, len(rows) - 0.35, "MAE  (n)", ha="left", fontsize=6.5, color="0.25")
ax.set_xlim(0.5, 5.6)
ax.set_xticks([1, 2, 3, 4])
ax.axvline(main["rhythm model only"]["mae"], color="0.8", lw=0.8, ls="--", zorder=0)
fig.tight_layout()
fig.savefig(res / "fig_drozy_twin.pdf")
print("wrote", res / "fig_drozy_twin.pdf")
