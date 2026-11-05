"""DROZY: how reaction time and eye measures relate to KSS, within and between people, and whether a
single calibration check-in improves on a population model (BlinkTwin's core idea).

Inputs
  DROZY dir                     KSS.txt, pvt-rt/*.csv
  results/drozy_eyes.csv        per-test eye metrics from web/scripts/drozy_eyes.ts (website BlinkMeter on landmark EAR)
  results/drozy_eog.csv         per-test EOG blink counts from analysis/drozy_eog.py (ground truth for blink rate)
Outputs (results/)
  drozy_sessions.csv            one row per test: KSS, PVT metrics, eye metrics, EOG blink rate (git-ignored)
  drozy_summary.json            aggregate statistics and suggested priors for the twin and the simulation
  fig_drozy_blink_validation.pdf  landmark vs EOG blink rate
Local only (data/derived/, git-ignored, because it shows individual participants)
  fig_drozy_per_subject.pdf     KSS by test; KSS vs median RT; KSS vs blink duration (per-subject lines)

Usage: python -I drozy_analysis.py <DROZY dir> <results dir>
"""
import json
import sys
import warnings
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.tools.sm_exceptions import ConvergenceWarning

D, R = Path(sys.argv[1]), Path(sys.argv[2])

# ---------- data ----------
kss = np.loadtxt(D / "KSS.txt")
TS = "%Y-%m-%d_%H.%M.%S.%f"


def pvt_metrics(path):
    lines = path.read_text().strip().splitlines()[1:]
    rts, missing = [], 0
    for ln in lines:
        parts = [p.strip() for p in ln.split(";")]
        if len(parts) < 2 or not parts[1]:
            missing += 1
            continue
        a, b = datetime.strptime(parts[0], TS), datetime.strptime(parts[1], TS)
        rts.append((b - a).total_seconds() * 1000)
    rt = np.array(rts)
    valid = rt[rt >= 100]
    return dict(
        pvt_n=len(rt),
        pvt_no_response=missing,
        median_rt=float(np.median(valid)),
        mean_speed=float(np.mean(1000 / valid)),
        lapses500=int((valid > 500).sum() + missing),
        lapses355=int((valid > 355).sum() + missing),
        false_starts=int((rt < 100).sum()),
    )


rows = []
for f in sorted([p for p in (D / "pvt-rt").glob("*.csv") if not p.name.startswith(".")], key=lambda p: tuple(map(int, p.stem.split("-")))):
    s, t = map(int, f.stem.split("-"))
    k = kss[s - 1, t - 1]
    rows.append(dict(subject=s, test=t, kss=np.nan if k == 0 else float(k), **pvt_metrics(f)))
df = pd.DataFrame(rows)
eyes = pd.read_csv(R / "drozy_eyes.csv")
eog = pd.read_csv(R / "drozy_eog.csv")[["subject", "test", "eog_blink_rate"]]
df = df.merge(eyes, on=["subject", "test"], how="left").merge(eog, on=["subject", "test"], how="left")
df["perclos_pct"] = df["perclos"] * 100
df["rt100"] = (df["median_rt"] - 300) / 100
df["blinkms100"] = (df["mean_blink_ms"] - 150) / 100
df.to_csv(R / "drozy_sessions.csv", index=False)
d = df.dropna(subset=["kss"]).copy()
S = {"dataset": "DROZY (Massoz et al., 2016)", "n_tests": int(len(d)), "n_subjects": int(d.subject.nunique())}

# ---------- (a) descriptives by test ----------
desc = {}
for t, g in d.groupby("test"):
    desc[int(t)] = {
        c: {"mean": float(g[c].mean()), "sd": float(g[c].std(ddof=1)), "n": int(g[c].notna().sum())}
        for c in ["kss", "median_rt", "lapses500", "perclos_pct", "blink_rate", "mean_blink_ms", "long_closures_per_min"]
    }
S["by_test"] = desc
m_test = smf.mixedlm("kss ~ test", d, groups=d["subject"]).fit(reml=True)
S["kss_per_test_step"] = {"slope": float(m_test.params["test"]), "ci": [float(x) for x in m_test.conf_int().loc["test"]], "p": float(m_test.pvalues["test"])}

# ---------- blink validation against EOG ----------
v = df.dropna(subset=["blink_rate", "eog_blink_rate"])
diff = v.blink_rate - v.eog_blink_rate
S["blink_validation_vs_eog"] = {
    "n_tests": int(len(v)),
    "spearman_rho": float(stats.spearmanr(v.blink_rate, v.eog_blink_rate).statistic),
    "pearson_r": float(stats.pearsonr(v.blink_rate, v.eog_blink_rate).statistic),
    "bias_per_min": float(diff.mean()),
    "loa_per_min": [float(diff.mean() - 1.96 * diff.std(ddof=1)), float(diff.mean() + 1.96 * diff.std(ddof=1))],
    "landmark_blink_rate_range": [float(v.blink_rate.min()), float(v.blink_rate.max())],
    "landmark_blink_ms_range": [float(df.mean_blink_ms.min()), float(df.mean_blink_ms.max())],
    "landmark_blink_ms_median": float(df.mean_blink_ms.median()),
}

# ---------- (b) mixed models KSS ~ feature ----------
FEATURES = {
    "rt100": "median RT, per 100 ms above 300 ms",
    "perclos_pct": "PERCLOS, per 1 percentage point",
    "blinkms100": "mean blink duration, per 100 ms above 150 ms",
    "blink_rate": "blink rate, per blink/min",
    "lapses500": "PVT lapses (>500 ms), per lapse",
}


def fit_mixed(formula, data, re=None):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        m = smf.mixedlm(formula, data, groups=data["subject"], re_formula=re).fit(reml=True)
        conv = m.converged and not any(issubclass(x.category, ConvergenceWarning) for x in w)
    return m, conv


mixed = {}
for f, label in FEATURES.items():
    dd = d.dropna(subset=[f])
    m, conv = fit_mixed(f"kss ~ {f}", dd)
    out = {
        "label": label,
        "n": int(len(dd)),
        "subjects": int(dd.subject.nunique()),
        "intercept": float(m.params["Intercept"]),
        "slope": float(m.params[f]),
        "ci": [float(x) for x in m.conf_int().loc[f]],
        "p": float(m.pvalues[f]),
        "random_intercept_sd": float(np.sqrt(max(m.cov_re.iloc[0, 0], 0))),
        "residual_sd": float(np.sqrt(m.scale)),
        "converged": bool(conv),
    }
    try:
        m2, conv2 = fit_mixed(f"kss ~ {f}", dd, re=f"~{f}")
        out["random_slope"] = {
            "converged": bool(conv2),
            "slope": float(m2.params[f]),
            "random_slope_sd": float(np.sqrt(max(m2.cov_re.iloc[1, 1], 0))),
            "note": "boundary or non-convergence; treat as unreliable" if not conv2 else "",
        }
    except Exception as e:  # noqa: BLE001
        out["random_slope"] = {"converged": False, "error": str(e)[:120]}
    mixed[f] = out
S["mixed_kss_on_feature"] = mixed


# ---------- (c) repeated-measures correlation ----------
def rmcorr(data, x, y="kss"):
    dd = data.dropna(subset=[x, y])
    dd = dd[dd.groupby("subject")[x].transform("count") >= 2]
    xc = dd[x] - dd.groupby("subject")[x].transform("mean")
    yc = dd[y] - dd.groupby("subject")[y].transform("mean")
    r = float(np.sum(xc * yc) / np.sqrt(np.sum(xc**2) * np.sum(yc**2)))
    dof = len(dd) - dd.subject.nunique() - 1
    tval = r * np.sqrt(dof / max(1e-12, 1 - r**2))
    return {"r": r, "df": int(dof), "p": float(2 * stats.t.sf(abs(tval), dof)), "n": int(len(dd)), "subjects": int(dd.subject.nunique())}


S["rmcorr_with_kss"] = {f: rmcorr(d, f) for f in FEATURES}


# ---------- (d) per-subject slopes ----------
def subject_slopes(x, y="kss", min_tests=3, data=d):
    out, sampling_var = {}, []
    for s, g in data.dropna(subset=[x, y]).groupby("subject"):
        if len(g) >= min_tests and g[x].std() > 0:
            coef, res, *_ = np.polyfit(g[x], g[y], 1, full=True)
            out[int(s)] = float(coef[0])
            sxx = float(((g[x] - g[x].mean()) ** 2).sum())
            dof = len(g) - 2
            if dof > 0 and len(res):
                sampling_var.append(float(res[0]) / dof / sxx)
    vals = np.array(list(out.values()))
    obs_var = float(vals.var(ddof=1)) if len(vals) > 1 else float("nan")
    # method of moments: spread of true slopes = observed spread minus average sampling noise of each slope
    true_var = max(0.0, obs_var - float(np.mean(sampling_var))) if sampling_var else float("nan")
    return {
        "sd_deconvolved": float(np.sqrt(true_var)) if np.isfinite(true_var) else None,
        "per_subject": out,
        "n_subjects": int(len(vals)),
        "mean": float(vals.mean()) if len(vals) else None,
        "sd": float(vals.std(ddof=1)) if len(vals) > 1 else None,
        "min": float(vals.min()) if len(vals) else None,
        "max": float(vals.max()) if len(vals) else None,
        "share_negative": float((vals < 0).mean()) if len(vals) else None,
    }


S["per_subject_slopes"] = {
    "kss_per_100ms_rt": subject_slopes("rt100"),
    "kss_per_pct_perclos": subject_slopes("perclos_pct"),
    "kss_per_100ms_blink": subject_slopes("blinkms100"),
}
# only the summary of the slopes is kept: values by subject are not published (DROZY's licence)
for _v in S["per_subject_slopes"].values():
    _v.pop("per_subject", None)

# ---------- (e) leave-one-subject-out: population model vs one calibration check-in ----------
FEATURE_SETS = {"rt": ["rt100"], "eyes": ["perclos_pct", "blinkms100"], "rt+eyes": ["rt100", "perclos_pct", "blinkms100"]}
loso = {}
for name, feats in FEATURE_SETS.items():
    dd = d.dropna(subset=feats).sort_values(["subject", "test"])
    errs = {k: [] for k in ["population", "calibrated_full", "calibrated_shrunk", "carry_forward", "population_mean"]}
    for s in dd.subject.unique():
        test_s = dd[dd.subject == s]
        if len(test_s) < 2:
            continue
        train = dd[dd.subject != s]
        formula = "kss ~ " + " + ".join(feats)
        ols = smf.ols(formula, train).fit()
        mm, _ = fit_mixed(formula, train)
        tau2, sig2 = max(mm.cov_re.iloc[0, 0], 0), mm.scale
        gain = tau2 / (tau2 + sig2) if tau2 + sig2 > 0 else 0
        pred = ols.predict(test_s).to_numpy()
        first, rest = test_s.iloc[0], test_s.iloc[1:]
        shift = first.kss - pred[0]
        y = rest.kss.to_numpy()
        errs["population"] += list(np.abs(y - pred[1:]))
        errs["calibrated_full"] += list(np.abs(y - (pred[1:] + shift)))
        errs["calibrated_shrunk"] += list(np.abs(y - (pred[1:] + gain * shift)))
        errs["carry_forward"] += list(np.abs(y - first.kss))
        errs["population_mean"] += list(np.abs(y - train.kss.mean()))
    e = {k: np.array(v) for k, v in errs.items()}
    res = {k: {"mae": float(v.mean()), "n_predictions": int(len(v))} for k, v in e.items()}
    for k in ["calibrated_full", "calibrated_shrunk"]:
        w = stats.wilcoxon(e[k], e["population"]) if np.any(e[k] - e["population"]) else None
        res[k]["vs_population_wilcoxon_p"] = float(w.pvalue) if w else None
    loso[name] = res
S["loso_calibration"] = loso


def blr_update(mean, cov, noise_var, x, y):
    """Same equations as web/src/twin/blr.ts (known noise variance)."""
    px = cov @ x
    sv = x @ px + noise_var
    g = px / sv
    return mean + g * (y - x @ mean), cov - np.outer(g, px)


two = {"population": [], "blr_two_checkins": [], "blr_one_checkin": [], "exact_line_two_points": []}
dd = d.dropna(subset=["rt100"]).sort_values(["subject", "test"])
for s in dd.subject.unique():
    ts = dd[dd.subject == s]
    if len(ts) < 3:
        continue
    train = dd[dd.subject != s]
    mm, _ = fit_mixed("kss ~ rt100", train)
    sl = subject_slopes("rt100", data=train)
    slope_sd = sl["sd_deconvolved"] or sl["sd"] or 1.0
    m0 = np.array([mm.params["Intercept"], mm.params["rt100"]])
    c0 = np.diag([max(mm.cov_re.iloc[0, 0], 1e-6), slope_sd**2])
    nv = mm.scale
    x = lambda r: np.array([1.0, r.rt100])
    t1, t2, t3 = ts.iloc[0], ts.iloc[1], ts.iloc[2]
    two["population"].append(abs(t3.kss - x(t3) @ m0))
    m1, c1 = blr_update(m0, c0, nv, x(t1), t1.kss)
    two["blr_one_checkin"].append(abs(t3.kss - x(t3) @ m1))
    m2, c2 = blr_update(m1, c1, nv, x(t2), t2.kss)
    two["blr_two_checkins"].append(abs(t3.kss - x(t3) @ m2))
    if t2.rt100 != t1.rt100:
        b1 = (t2.kss - t1.kss) / (t2.rt100 - t1.rt100)
        two["exact_line_two_points"].append(abs(t3.kss - (t1.kss + b1 * (t3.rt100 - t1.rt100))))
S["loso_two_checkins_rt"] = {k: {"mae": float(np.mean(v)), "n_predictions": len(v)} for k, v in two.items()}
S["loso_two_checkins_note"] = (
    "Subjects with all three tests: tests 1 and 2 are check-ins, test 3 (most sleep deprived) is predicted. "
    "BLR uses BlinkTwin's update equations with a population prior fitted on the other subjects."
)
S["loso_note"] = (
    "Each held-out subject's first available test is the calibration check-in; MAE is over their later tests. "
    "calibrated_shrunk scales the intercept shift by tau^2/(tau^2+sigma^2) from a random-intercept model on the "
    "training subjects, as BlinkTwin's Kalman update does. Tests are ordered by increasing sleep deprivation."
)


# ---------- suggested priors ----------
def mixed_params(formula, data):
    m, _ = fit_mixed(formula, data)
    return m


pvt_m = mixed["rt100"]
s_rt = S["per_subject_slopes"]["kss_per_100ms_rt"]
cam_data = d.dropna(subset=["perclos_pct", "blinkms100"])
cam_m = mixed_params("kss ~ perclos_pct + blinkms100", cam_data)
s_pc = S["per_subject_slopes"]["kss_per_pct_perclos"]
s_bm = S["per_subject_slopes"]["kss_per_100ms_blink"]
inv = {}
for col, xform, name in [("median_rt", "I(kss - 3)", "rt"), ("mean_blink_ms", "I(kss - 3)", "blinkMs")]:
    dd = d.dropna(subset=[col])
    m = mixed_params(f"{col} ~ {xform}", dd)
    slopes = subject_slopes("kss", y=col, data=dd)
    inv[name] = {
        "intercept_at_kss3": [float(m.params["Intercept"]), float(np.sqrt(max(m.cov_re.iloc[0, 0], 0)))],
        # if noise explains all observed spread (deconvolved SD 0), fall back to the observed SD (conservative)
        "slope_per_kss": [float(m.params[xform]), slopes["sd_deconvolved"] or slopes["sd"]],
        "noise_sd": float(np.sqrt(m.scale)),
    }
dd = d.dropna(subset=["perclos"]).assign(kss_above4=lambda x: np.maximum(0, x.kss - 4))
m = mixed_params("perclos ~ kss_above4", dd)
pc_slopes = subject_slopes("kss_above4", y="perclos", data=dd)
inv["perclos"] = {"slope_per_kss_above4": [float(m.params["kss_above4"]), pc_slopes["sd_deconvolved"]], "noise_sd": float(np.sqrt(m.scale)), "intercept": float(m.params["Intercept"])}

S["suggested_priors"] = {
    "twin_pvt": {
        "mean": [pvt_m["intercept"], pvt_m["slope"]],
        # deconvolved per-subject slope SD is 0 (spread explained by noise); use the random-slope model's SD instead
        "priorSd": [pvt_m["random_intercept_sd"], max(s_rt["sd_deconvolved"] or 0, pvt_m["random_slope"].get("random_slope_sd", 0.5))],
        "noiseSd": pvt_m["residual_sd"],
        "feature": "[1, (medianRt - 300) / 100]",
    },
    "twin_cam": {
        "mean": [float(cam_m.params["Intercept"]), float(cam_m.params["perclos_pct"]), float(cam_m.params["blinkms100"])],
        # random-slope SDs from the single-feature models (flagged non-converged); deconvolved per-subject SDs
        # (3.3 and 5.7) are listed as an upper bound: with three tests per person the eye slopes are very noisy
        "priorSd": [float(np.sqrt(max(cam_m.cov_re.iloc[0, 0], 0))), mixed["perclos_pct"]["random_slope"].get("random_slope_sd"), mixed["blinkms100"]["random_slope"].get("random_slope_sd")],
        "priorSd_upper_deconvolved": [None, s_pc["sd_deconvolved"], s_bm["sd_deconvolved"]],
        "noiseSd": float(np.sqrt(cam_m.scale)),
        "feature": "[1, perclos * 100, (meanBlinkMs - 150) / 100]",
    },
    "synth_population": inv,
    "caveat": f"{S['n_subjects']} subjects, {S['n_tests']} tests with KSS; NIR Kinect camera and lab PVT, not a laptop webcam. Use as weakly informative priors.",
}
(R / "drozy_summary.json").write_text(json.dumps(S, indent=2))

# ---------- figures ----------
plt.rcParams.update({"font.size": 8, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42})
fig, ax = plt.subplots(1, 3, figsize=(7.0, 2.4))
for s, g in d.groupby("subject"):
    g = g.sort_values("test")
    ax[0].plot(g.test, g.kss, color="0.8", lw=0.7, marker="o", ms=2)
means = d.groupby("test").kss.mean()
ax[0].plot(means.index, means.values, color="C0", lw=2, marker="o")
ax[0].set_xticks([1, 2, 3])
ax[0].set_xlabel("Test (increasing sleep deprivation)")
ax[0].set_ylabel("KSS")
ax[0].set_title(f"KSS by test (n = {len(d)} tests)", fontsize=8)
for a, x, xl, key in [(ax[1], "median_rt", "PVT median RT (ms)", "rt100"), (ax[2], "mean_blink_ms", "Mean blink duration (ms)", "blinkms100")]:
    for s, g in d.dropna(subset=[x]).groupby("subject"):
        g = g.sort_values(x)
        a.plot(g[x], g.kss, color=f"C{int(s) % 10}", lw=0.8, marker="o", ms=2.5, alpha=0.8)
    rc = S["rmcorr_with_kss"][key]
    a.set_xlabel(xl)
    a.set_ylabel("KSS")
    a.set_title(f"within-person r = {rc['r']:.2f} (p = {rc['p']:.2g})", fontsize=8)
fig.tight_layout()
# shows individual participants, so it stays in the git-ignored data folder
local_dir = R.parent / "data" / "derived"
local_dir.mkdir(parents=True, exist_ok=True)
fig.savefig(local_dir / "fig_drozy_per_subject.pdf")

fig, a = plt.subplots(figsize=(3.2, 2.8))
a.scatter(v.eog_blink_rate, v.blink_rate, s=12)
lim = [0, max(v.eog_blink_rate.max(), v.blink_rate.max()) + 5]
a.plot(lim, lim, color="0.6", lw=0.8, ls="--")
a.set_xlim(lim)
a.set_ylim(lim)
a.set_xlabel("EOG blink rate (/min)")
a.set_ylabel("Landmark blink rate (/min)")
bv = S["blink_validation_vs_eog"]
a.set_title(f"rho = {bv['spearman_rho']:.2f}, bias = {bv['bias_per_min']:.1f}/min (n = {bv['n_tests']})", fontsize=8)
fig.tight_layout()
fig.savefig(R / "fig_drozy_blink_validation.pdf")

print(json.dumps({k: S[k] for k in ["n_tests", "n_subjects", "kss_per_test_step", "blink_validation_vs_eog", "loso_two_checkins_rt"]}, indent=1))
for f, rc in S["rmcorr_with_kss"].items():
    print(f"rmcorr {f}: r={rc['r']:.2f} df={rc['df']} p={rc['p']:.2g}")
for fs, res in S["loso_calibration"].items():
    print("LOSO", fs, {k: round(v["mae"], 2) for k, v in res.items()})
for t, dct in S["by_test"].items():
    print("test", t, {c: (round(v["mean"], 2), v["n"]) for c, v in dct.items()})
for f, o in mixed.items():
    print(f"{f}: slope {o['slope']:.3f} [{o['ci'][0]:.3f}, {o['ci'][1]:.3f}] p={o['p']:.3g} tau={o['random_intercept_sd']:.2f} sigma={o['residual_sd']:.2f} conv={o['converged']} rs={o['random_slope']}")
for k, v_ in S["per_subject_slopes"].items():
    print(k, {kk: v_[kk] for kk in ["n_subjects", "mean", "sd", "sd_deconvolved", "min", "max", "share_negative"]})
print(json.dumps(S["suggested_priors"], indent=1))
