"""Reaction time vs sleepiness in OpenNeuro ds004902 (Xiang et al., 2024, Sci Data 11:427).

71 adults, each tested once after normal sleep (NS) and once after a night of sleep deprivation (SD).
participants.tsv holds PVT lapses, median RT and RT SD, and KSS, per session.

Outputs (to the folder given as the 2nd argument):
  openneuro_summary.json   group effects, overlap of measures, RT-vs-SSS coupling, between-person spread
  fig_openneuro.pdf        paired change plot and change-vs-change scatter

Usage: python -I openneuro_pvt_kss.py <participants.tsv> <out_dir>
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
df = pd.read_csv(src, sep="\t", na_values=["n/a"])

rows = []
for _, r in df.iterrows():
    for sess in ("NS", "SD"):
        rows.append(
            dict(
                pid=r["participant_id"],
                session=sess,
                lapses=r[f"PVT_item1_{sess}"],
                median_rt=r[f"PVT_item2_{sess}"],
                rt_sd=r[f"PVT_item3_{sess}"],
                kss=r[f"KSS_{sess}"],
                sss=r[f"SSS_{sess}"],
            )
        )
long = pd.DataFrame(rows)


def paired(col):
    d = df.dropna(subset=[f"{col}_NS", f"{col}_SD"])
    a, b = d[f"{col}_NS"].to_numpy(float), d[f"{col}_SD"].to_numpy(float)
    w = stats.wilcoxon(b, a)
    diff = b - a
    return dict(
        n=int(len(d)),
        ns_median=float(np.median(a)),
        sd_median=float(np.median(b)),
        diff_mean=float(diff.mean()),
        diff_sd=float(diff.std(ddof=1)),
        dz=float(diff.mean() / diff.std(ddof=1)),
        wilcoxon_p=float(w.pvalue),
    )


summary = {
    "dataset": "OpenNeuro ds004902 v1.0.4 (Xiang et al., 2024)",
    "n_participants": int(len(df)),
    "paired": {
        "kss": paired("KSS"),
        "median_rt_ms": paired("PVT_item2"),
        "lapses": paired("PVT_item1"),
    },
}

# Note: in this release KSS and SSS were collected on different participants, and only 2 people have
# both KSS and PVT. SSS overlaps with PVT for 25 people, so the person-level coupling uses SSS.
has = lambda c: df[f"{c}_NS"].notna() & df[f"{c}_SD"].notna()
summary["overlap"] = {
    "pvt_and_kss_both_sessions": int((has("PVT_item2") & has("KSS")).sum()),
    "pvt_and_sss_both_sessions": int((has("PVT_item2") & has("SSS")).sum()),
    "kss_and_sss_both_sessions": int((has("KSS") & has("SSS")).sum()),
}
summary["paired"]["sss"] = paired("SSS")
cp = df[has("PVT_item2") & has("SSS")].copy()
cp["d_rt"] = cp["PVT_item2_SD"] - cp["PVT_item2_NS"]
cp["d_sss"] = cp["SSS_SD"] - cp["SSS_NS"]
rho = stats.spearmanr(cp["d_rt"], cp["d_sss"])
pear = stats.pearsonr(cp["d_rt"], cp["d_sss"])
rt_all = df[has("PVT_item2")]
d_rt_all = rt_all["PVT_item2_SD"] - rt_all["PVT_item2_NS"]
k_all = df[has("KSS")]
d_kss_all = k_all["KSS_SD"] - k_all["KSS_NS"]
summary["coupling_rt_vs_sss"] = {
    "n": int(len(cp)),
    "spearman_rho": float(rho.statistic),
    "spearman_p": float(rho.pvalue),
    "pearson_r": float(pear.statistic),
    "pearson_p": float(pear.pvalue),
}
summary["heterogeneity"] = {
    "rt_slowed_share": float((d_rt_all > 0).mean()),
    "rt_change_mean_ms": float(d_rt_all.mean()),
    "rt_change_sd_ms": float(d_rt_all.std(ddof=1)),
    "kss_rose_share": float((d_kss_all > 0).mean()),
    "kss_change_mean": float(d_kss_all.mean()),
    "kss_change_sd": float(d_kss_all.std(ddof=1)),
    "kss_ns_range": [float(k_all["KSS_NS"].min()), float(k_all["KSS_NS"].max())],
    "kss_sd_range": [float(k_all["KSS_SD"].min()), float(k_all["KSS_SD"].max())],
}
both = cp

(out / "openneuro_summary.json").write_text(json.dumps(summary, indent=2))

plt.rcParams.update({"font.size": 8, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42})
fig, ax = plt.subplots(1, 3, figsize=(7.0, 2.4))
for a, (col, label) in zip(ax[:2], [("KSS", "KSS (1-9)"), ("PVT_item2", "PVT median RT (ms)")]):
    d = df.dropna(subset=[f"{col}_NS", f"{col}_SD"])
    jitter = np.random.default_rng(0).uniform(-0.06, 0.06, len(d))
    for (_, r), j in zip(d.iterrows(), jitter):
        a.plot([0 + j, 1 + j], [r[f"{col}_NS"], r[f"{col}_SD"]], color="0.75", lw=0.6)
    a.plot([0, 1], [d[f"{col}_NS"].median(), d[f"{col}_SD"].median()], color="C0", lw=2, marker="o")
    a.set_xticks([0, 1], ["Normal sleep", "Sleep deprived"])
    a.set_ylabel(label)
    a.set_title(f"n = {len(d)}", fontsize=8)
ax[2].axhline(0, color="0.85", lw=0.8)
ax[2].axvline(0, color="0.85", lw=0.8)
ax[2].scatter(both["d_rt"], both["d_sss"] + np.random.default_rng(1).uniform(-0.12, 0.12, len(both)), s=12, color="C1")
ax[2].set_xlabel("Change in median RT (ms)")
ax[2].set_ylabel("Change in SSS (1-7)")
ax[2].set_title(f"rho = {rho.statistic:.2f}, p = {rho.pvalue:.2f}, n = {len(both)}", fontsize=8)
fig.tight_layout()
fig.savefig(out / "fig_openneuro.pdf")
print(json.dumps(summary, indent=2))
