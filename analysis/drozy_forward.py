"""Forward measurement models (feature = a + b * (KSS - 3) + person bias + noise) fitted on DROZY.

These parameterise BlinkTwin's Kalman measurement model (web/src/twin/twin.ts) and the virtual people
in the simulation study. Within-person slopes use subject fixed effects, so differences between people
in their baseline do not leak into the slope.

Outputs results/drozy_forward.json (aggregate parameters only).
Usage: python -I drozy_forward.py <results_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

res = Path(sys.argv[1])
s = pd.read_csv(res / "drozy_sessions.csv")
m = pd.read_csv(res / "drozy_eye_minutes.csv")
s = s[s.kss > 0].copy()
m = m.merge(s[["subject", "test", "kss"]], on=["subject", "test"])
m["perclos_pct"] = m.perclos * 100


def forward(df: pd.DataFrame, feature: str, group_level: str) -> dict:
    d = df.dropna(subset=[feature, "kss"]).copy()
    d["x"] = d.kss - 3
    # within-person slope: centre feature and KSS on each subject's mean
    d["xc"] = d.x - d.groupby("subject").x.transform("mean")
    d["yc"] = d[feature] - d.groupby("subject")[feature].transform("mean")
    b = float((d.xc * d.yc).sum() / (d.xc ** 2).sum())
    a_i = d.groupby("subject").apply(lambda g: (g[feature] - b * g.x).mean(), include_groups=False)
    a = float(a_i.mean())
    resid = d[feature] - (d.subject.map(a_i) + b * d.x)
    n, k = len(d), d.subject.nunique() + 1
    noise = float(np.sqrt((resid ** 2).sum() / max(1, n - k)))
    # between-person SD of baselines, removing their estimation noise
    per_n = d.groupby("subject").size()
    bias_sd = float(np.sqrt(max(0.0, a_i.var(ddof=1) - (noise ** 2 / per_n).mean())))
    # person-specific slopes for subjects with >= 3 distinct KSS values (session level)
    slopes = []
    for _, g in d.groupby("subject"):
        if g.kss.nunique() >= 3 and group_level == "session":
            gx = g.x - g.x.mean()
            slopes.append(float((gx * (g[feature] - g[feature].mean())).sum() / (gx ** 2).sum()))
    slope_sd_raw = float(np.std(slopes, ddof=1)) if len(slopes) > 2 else None
    out = {
        "feature": feature,
        "level": group_level,
        "n_obs": int(n),
        "n_subjects": int(d.subject.nunique()),
        "at_kss3": a,
        "per_kss": b,
        "noise_sd": noise,
        "bias_sd": bias_sd,
        "slope_sd_raw": slope_sd_raw,
        "n_subjects_slope": len(slopes),
    }
    return out


def lag1(df: pd.DataFrame, feature: str) -> float:
    vals = []
    for _, g in df.sort_values("minute").groupby(["subject", "test"]):
        v = g[feature].to_numpy(float)
        v = v[~np.isnan(v)]
        if len(v) > 3:
            v = v - v.mean()
            vals.append((np.sum(v[1:] * v[:-1]), np.sum(v * v)))
    num = sum(a for a, _ in vals)
    den = sum(b for _, b in vals)
    return float(num / den)


out = {
    "dataset": "DROZY (Massoz et al., 2016), 14 subjects, 36 tests",
    "pvt_median_rt_ms": forward(s, "median_rt", "session"),
    "perclos_pct_session": forward(s.assign(perclos_pct=s.perclos * 100), "perclos_pct", "session"),
    "blink_ms_session": forward(s, "mean_blink_ms", "session"),
}
mb = m[m.blinks >= 3]
out["perclos_pct_minute"] = forward(m, "perclos_pct", "minute")
out["blink_ms_minute"] = forward(mb, "mean_blink_ms", "minute")
rho_p = lag1(m, "perclos_pct")
rho_b = lag1(mb, "mean_blink_ms")
out["lag1_autocorrelation"] = {"perclos_pct": rho_p, "blink_ms": rho_b}
out["variance_inflation"] = {
    "perclos_pct": (1 + max(rho_p, 0)) / (1 - max(rho_p, 0)),
    "blink_ms": (1 + max(rho_b, 0)) / (1 - max(rho_b, 0)),
    "note": "(1 + rho) / (1 - rho): variance of a mean of AR(1) samples relative to independent ones",
}
(res / "drozy_forward.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
