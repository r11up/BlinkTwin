"""Supplementary tables for the simulation study (reads results written by web/scripts/simulate.ts).

Writes:
  results/sim_table_allk.csv       matched scenario, every method x k: MAE, its Monte Carlo SE, coverage and
                                   width of the 90% interval; and, for every scenario at k = 3, the per-person
                                   quantiles of BlinkTwin minus check-ins only
  results/sim_table_allk.tex       LaTeX table body (booktabs rows only) for the matched scenario
  results/sim_table_quantiles.tex  LaTeX table body (booktabs rows only) for the per-person quantiles

Monte Carlo SE: approximated as (upper - lower) / 3.92 from the 95% percentile bootstrap interval of the MAE
(2000 resamples of the 300 virtual people), i.e. the standard error a normal interval of the same width implies.

Usage: python -I sim_tables.py <results_dir>
"""
import csv
import json
import math
import sys
from pathlib import Path

res = Path(sys.argv[1])
mae_rows = list(csv.DictReader((res / "sim_mae.csv").open()))
summary = json.loads((res / "sim_summary.json").read_text())

METHODS = [
    ("prior", "Prior alone"),
    ("checkins", "Check-ins only"),
    ("noanchor", "No anchors"),
    ("consider", "Consider-covariance"),
    ("twin", "BlinkTwin"),
    ("oracle", "Known parameters"),
]
SCENARIOS = [
    ("matched", "Matched"),
    ("misreport", "Misreport"),
    ("nonlinear", "Nonlinear"),
    ("ratingbias", "Rating bias"),
    ("autocorr", "Autocorrelated"),
    ("trait", "Trait"),
    ("debt", "Debt"),
    ("workday", "Workday"),
    ("dissociation", "Dissociation"),
]


def num(x: str) -> float:
    try:
        return float(x)
    except ValueError:
        return math.nan


def f3(x: float) -> str:
    if not math.isfinite(x):
        return "--"
    return f"{x:.3f}".replace("-", "$-$") if x < 0 else f"{x:.3f}"


allk = []
for mid, mlabel in METHODS:
    for r in mae_rows:
        if r["scenario"] != "matched" or r["method"] != mid:
            continue
        lo, hi = num(r["mae_lo"]), num(r["mae_hi"])
        allk.append({
            "table": "matched_all_k",
            "scenario": "matched",
            "method": mid,
            "label": mlabel,
            "k": int(r["k"]),
            "mae": num(r["mae"]),
            "mc_se": (hi - lo) / 3.92,
            "coverage90": num(r["coverage90"]),
            "width90": num(r["width90"]),
        })
allk.sort(key=lambda r: ([m for m, _ in METHODS].index(r["method"]), r["k"]))

quant = []
for sid, slabel in SCENARIOS:
    c = next((x for x in summary["comparisons"] if x["scenario"] == sid and x["a"] == "twin_k3" and x["b"] == "checkins_k3"), None)
    if c is None:
        continue
    quant.append({
        "table": "quantiles_k3",
        "scenario": sid,
        "label": slabel,
        "mean_diff": c["mean_diff"],
        "ci_lo": c["ci"][0],
        "ci_hi": c["ci"][1],
        "p05": c["p05"],
        "p50": c["p50"],
        "p95": c["p95"],
        "share_better": c["share_a_better"],
        "share_worse_by_0_1": c["share_a_worse_by_0_1"],
    })

with (res / "sim_table_allk.csv").open("w", newline="") as fh:
    fields = ["table", "scenario", "method", "label", "k", "mae", "mc_se", "coverage90", "width90",
              "mean_diff", "ci_lo", "ci_hi", "p05", "p50", "p95", "share_better", "share_worse_by_0_1"]
    w = csv.DictWriter(fh, fieldnames=fields)
    w.writeheader()
    for r in allk + quant:
        w.writerow({k: r.get(k, "") for k in fields})

# LaTeX: matched scenario, one row per method and k
lines = ["\\toprule", "Method & $k$ & MAE & MC SE & Coverage & Width \\\\", "\\midrule"]
prev = None
for r in allk:
    if prev is not None and r["method"] != prev:
        lines.append("\\midrule")
    name = r["label"] if r["method"] != prev else ""
    lines.append(f"{name} & {r['k']} & {f3(r['mae'])} & {f3(r['mc_se'])} & {f3(r['coverage90'])} & {f3(r['width90'])} \\\\")
    prev = r["method"]
lines.append("\\bottomrule")
(res / "sim_table_allk.tex").write_text("\n".join(lines) + "\n")

lines = ["\\toprule", "Scenario & Mean & 95\\% CI & p05 & p50 & p95 & Better & Worse $>0.1$ \\\\", "\\midrule"]
for r in quant:
    lines.append(
        f"{r['label']} & {f3(r['mean_diff'])} & {f3(r['ci_lo'])}, {f3(r['ci_hi'])} & {f3(r['p05'])} & {f3(r['p50'])} & {f3(r['p95'])} & "
        f"{f3(r['share_better'])} & {f3(r['share_worse_by_0_1'])} \\\\"
    )
lines.append("\\bottomrule")
(res / "sim_table_quantiles.tex").write_text("\n".join(lines) + "\n")

print(f"{'method':<20}{'k':>3}{'MAE':>8}{'MC SE':>8}{'cov90':>8}{'width':>8}")
for r in allk:
    print(f"{r['label']:<20}{r['k']:>3}{r['mae']:>8.3f}{r['mc_se']:>8.3f}{r['coverage90']:>8.3f}{r['width90']:>8.3f}")
print()
print(f"{'scenario':<16}{'mean':>8}{'lo':>8}{'hi':>8}{'p05':>8}{'p50':>8}{'p95':>8}{'better':>8}{'worse>0.1':>10}")
for r in quant:
    print(f"{r['label']:<16}{r['mean_diff']:>8.3f}{r['ci_lo']:>8.3f}{r['ci_hi']:>8.3f}{r['p05']:>8.3f}{r['p50']:>8.3f}{r['p95']:>8.3f}{r['share_better']:>8.3f}{r['share_worse_by_0_1']:>10.3f}")
print("wrote", res / "sim_table_allk.csv", res / "sim_table_allk.tex", res / "sim_table_quantiles.tex")
