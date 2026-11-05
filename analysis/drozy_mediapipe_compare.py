"""Validation of BlinkTwin's webcam pipeline on the DROZY face videos.

Two steps:

  extract  Runs MediaPipe Face Landmarker (the same face_landmarker.task model file the website loads) on
           every frame of every DROZY video and writes per-frame eyeBlink scores to a folder under data/
           (never committed). Frame times come from DROZY's timestamps files. Uses the MediaPipe Tasks
           Python API, which wraps the same C++ graph as the browser's tasks-vision package.

  compare  Reads the per-test and per-minute summaries written by web/scripts/drozy_mediapipe_blinks.ts
           (which runs the website's unchanged BlinkMeter over the per-frame scores) and compares them with
           the EOG blink counts, the landmark-EAR pipeline and KSS. Writes results/drozy_mediapipe_summary.json
           and results/fig_drozy_mediapipe.pdf (aggregate numbers only, no images).

Usage (from the repository root):
  data/venv-mediapipe/bin/python -I analysis/drozy_mediapipe_compare.py extract \
      data/raw/drozy/extracted/DROZY web/public/models/face_landmarker.task data/derived/drozy_mediapipe_frames [--jobs 6]
  analysis/.venv/bin/python -I analysis/drozy_mediapipe_compare.py compare results

The extract step needs `mediapipe` and `opencv-python-headless` (a separate environment, e.g.
python3.13 -m venv data/venv-mediapipe && data/venv-mediapipe/bin/pip install mediapipe opencv-python-headless).
"""
import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------------------------- extract
def _extract_one(args):
    video, ts_file, model, out_file = args
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    ts = [int(round(float(line.split()[-1]))) for line in Path(ts_file).read_text().splitlines() if line.strip()]
    cap = cv2.VideoCapture(str(video))
    n_video = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        output_face_blendshapes=True,
    )
    lm = vision.FaceLandmarker.create_from_options(opts)
    rows = ["frame,t_ms,face,blink,blink_left,blink_right"]
    i = 0
    last_t = -1
    detected = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = ts[i] if i < len(ts) else ts[-1] + (i - len(ts) + 1) * round(1000 / fps)
        t_call = max(t, last_t + 1)  # MediaPipe needs strictly increasing timestamps
        last_t = t_call
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), t_call)
        if res.face_blendshapes:
            d = {c.category_name: c.score for c in res.face_blendshapes[0]}
            bl, br = d["eyeBlinkLeft"], d["eyeBlinkRight"]
            rows.append(f"{i},{t},1,{(bl + br) / 2:.5f},{bl:.5f},{br:.5f}")
            detected += 1
        else:
            rows.append(f"{i},{t},0,,,")
        i += 1
    lm.close()
    Path(out_file).write_text("\n".join(rows) + "\n")
    return {"test": Path(video).stem, "frames": i, "video_frames": n_video, "timestamps": len(ts), "fps": fps, "face_rate": detected / max(1, i)}


def extract(drozy_dir: str, model: str, out_dir: str, jobs: int = 6):
    from multiprocessing import get_context

    d = Path(drozy_dir)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    work = []
    for v in sorted((d / "videos_i8").glob("*.mp4")):
        if v.name.startswith("._"):
            continue
        ts = d / "timestamps" / f"{v.stem}.txt"
        if ts.exists():
            work.append((v, ts, model, out / f"{v.stem}.csv"))
    with get_context("spawn").Pool(jobs) as pool:
        stats = []
        for s in pool.imap_unordered(_extract_one, work):
            stats.append(s)
            print(f"{s['test']}: {s['frames']} frames ({s['fps']:.0f} fps), face {s['face_rate']:.1%}", flush=True)
    (out / "_extract_stats.json").write_text(json.dumps(sorted(stats, key=lambda s: s["test"]), indent=1))


# ---------------------------------------------------------------------------------------------- compare
def rm_corr(df, x, y, subject="subject"):
    """Repeated-measures correlation (Bakdash & Marusich, 2017): within-subject centred, df = N - S - 1."""
    import numpy as np
    from scipy import stats

    d = df[[subject, x, y]].dropna()
    d = d[d.groupby(subject)[x].transform("count") >= 2]
    xc = d[x] - d.groupby(subject)[x].transform("mean")
    yc = d[y] - d.groupby(subject)[y].transform("mean")
    r = float(np.sum(xc * yc) / np.sqrt(np.sum(xc**2) * np.sum(yc**2)))
    dof = len(d) - d[subject].nunique() - 1
    t = r * np.sqrt(dof / max(1e-12, 1 - r**2))
    p = float(2 * stats.t.sf(abs(t), dof))
    return {"r": r, "df": int(dof), "p": p, "n_obs": int(len(d)), "n_subjects": int(d[subject].nunique())}


def agreement(a, b):
    import numpy as np
    from scipy import stats

    m = ~(np.isnan(a) | np.isnan(b))
    a, b = a[m], b[m]
    diff = a - b
    return {
        "n": int(m.sum()),
        "spearman": float(stats.spearmanr(a, b).statistic),
        "pearson": float(stats.pearsonr(a, b).statistic),
        "bias": float(diff.mean()),
        "loa": [float(diff.mean() - 1.96 * diff.std(ddof=1)), float(diff.mean() + 1.96 * diff.std(ddof=1))],
        "mean_a": float(a.mean()),
        "mean_b": float(b.mean()),
    }


def lag1(minutes, col):
    """Pooled within-test lag-1 autocorrelation of a per-minute series (deviations from the test mean)."""
    import numpy as np

    xs, ys = [], []
    for _, g in minutes.sort_values("minute").groupby(["subject", "test"]):
        v = g[col].to_numpy(float)
        v = v[~np.isnan(v)]
        if len(v) < 3:
            continue
        v = v - v.mean()
        xs.extend(v[:-1])
        ys.extend(v[1:])
    xs, ys = np.array(xs), np.array(ys)
    return {"r": float(np.sum(xs * ys) / np.sqrt(np.sum(xs**2) * np.sum(ys**2))), "n_pairs": int(len(xs))}


def compare(results_dir: str):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd

    res = Path(results_dir)
    mp_tests = pd.read_csv(res / "drozy_mediapipe_tests.csv")
    mp_min = pd.read_csv(res / "drozy_mediapipe_minutes.csv")
    sess = pd.read_csv(res / "drozy_sessions.csv")
    eog = pd.read_csv(res / "drozy_eog.csv")
    ear_min = pd.read_csv(res / "drozy_eye_minutes.csv")
    eog_rate_col = "eog_blink_rate" if "eog_blink_rate" in eog.columns else [c for c in eog.columns if "rate" in c][0]
    df = (
        mp_tests.merge(sess[["subject", "test", "kss", "fps", "perclos", "blink_rate", "mean_blink_ms", "long_closures_per_min"]].rename(
            columns={"perclos": "ear_perclos", "blink_rate": "ear_blink_rate", "mean_blink_ms": "ear_blink_ms", "long_closures_per_min": "ear_long_per_min", "fps": "fps_ear"}),
            on=["subject", "test"], how="left")
        .merge(eog[["subject", "test", eog_rate_col]].rename(columns={eog_rate_col: "eog_blink_rate"}), on=["subject", "test"], how="left")
    )
    df["low_fps"] = df["fps"] < 20
    out = {
        "dataset": "DROZY videos_i8 (near-infrared intensity, 512x424)",
        "pipeline": "MediaPipe Face Landmarker (face_landmarker.task, as on the website) via the Tasks Python API -> mean eyeBlink blendshape -> website BlinkMeter (unchanged)",
        "n_tests": int(len(df)),
        "n_subjects": int(df["subject"].nunique()),
        "face_detection_rate": {"mean": float(df["face_rate"].mean()), "min": float(df["face_rate"].min()), "per_test": {f"{int(r.subject)}-{int(r.test)}": round(float(r.face_rate), 4) for r in df.itertuples()}},
        "raw_score_percentiles_mean": {k: float(df[k].mean()) for k in ["score_p50", "score_p95", "score_p99", "score_max"] if k in df.columns},
    }

    def block(d):
        o = {}
        o["blink_rate_vs_eog"] = agreement(d["mp_blink_rate"].to_numpy(float), d["eog_blink_rate"].to_numpy(float))
        o["blink_rate_vs_eog_within_person"] = rm_corr(d, "mp_blink_rate", "eog_blink_rate")
        o["blink_rate_vs_ear"] = agreement(d["mp_blink_rate"].to_numpy(float), d["ear_blink_rate"].to_numpy(float))
        o["blink_ms_vs_ear"] = agreement(d["mp_blink_ms"].to_numpy(float), d["ear_blink_ms"].to_numpy(float))
        o["perclos_vs_ear"] = agreement((d["mp_perclos"] * 100).to_numpy(float), (d["ear_perclos"] * 100).to_numpy(float))
        o["rescaled_blink_rate_vs_eog"] = agreement(d["rs_blink_rate"].to_numpy(float), d["eog_blink_rate"].to_numpy(float))
        o["rescaled_blink_rate_vs_eog_within_person"] = rm_corr(d, "rs_blink_rate", "eog_blink_rate")
        o["rescaled_blink_ms_vs_ear"] = agreement(d["rs_blink_ms"].to_numpy(float), d["ear_blink_ms"].to_numpy(float))
        o["rescaled_perclos_vs_ear"] = agreement((d["rs_perclos"] * 100).to_numpy(float), (d["ear_perclos"] * 100).to_numpy(float))
        o["share_tests_mp_perclos_below_0_5pct"] = float((d["mp_perclos"] < 0.005).mean())
        for v in ["mp_perclos", "mp_blink_ms", "mp_blink_rate", "mp_long_per_min", "rs_perclos", "rs_blink_ms", "rs_blink_rate"]:
            if v in d.columns:
                o[f"rmcorr_{v}_kss"] = rm_corr(d, v, "kss")
        return o

    out["all_tests"] = block(df)
    out["excluding_15fps"] = block(df[~df["low_fps"]])
    out["fps_by_test"] = {int(t): {"n": int(len(g)), "n_15fps": int(g["low_fps"].sum())} for t, g in df.groupby("test")}
    means = df.groupby("test")[[c for c in ["kss", "mp_perclos", "mp_blink_ms", "mp_blink_rate", "mp_long_per_min", "rs_perclos", "rs_blink_ms", "rs_blink_rate", "eog_blink_rate", "score_p99", "face_rate"] if c in df.columns]].mean()
    out["means_by_test"] = {int(t): {k: float(v) for k, v in row.items()} for t, row in means.iterrows()}
    out["lag1_autocorrelation_per_minute"] = {
        "mediapipe_perclos": lag1(mp_min, "perclos"),
        "mediapipe_mean_blink_ms": lag1(mp_min.assign(mean_blink_ms=mp_min["mean_blink_ms"].where(mp_min["blinks"] > 0)), "mean_blink_ms"),
        "mediapipe_blink_rate": lag1(mp_min, "blink_rate"),
        "rescaled_perclos": lag1(mp_min.rename(columns={"perclos_rs": "x"}), "x") if "perclos_rs" in mp_min.columns else None,
        "rescaled_mean_blink_ms": lag1(mp_min.assign(x=mp_min["mean_blink_ms_rs"].where(mp_min["blinks_rs"] > 0)), "x") if "mean_blink_ms_rs" in mp_min.columns else None,
        "ear_perclos": lag1(ear_min, "perclos"),
        "ear_mean_blink_ms": lag1(ear_min.assign(mean_blink_ms=ear_min["mean_blink_ms"].where(ear_min["blinks"] > 0)), "mean_blink_ms"),
    }
    out["minutes_with_no_blinks_share"] = float((mp_min["blinks"] == 0).mean())
    bc = Path(results_dir).parent / "data" / "derived" / "drozy_mediapipe_browser_check.json"
    if bc.exists():
        out["browser_cross_check"] = json.loads(bc.read_text())
        out["browser_cross_check"]["note"] = "Browser tasks-vision package (as on the website) vs the Python extraction, same frames (first 1800 decoded by seeking)."
    (res / "drozy_mediapipe_summary.json").write_text(json.dumps(out, indent=2))

    plt.rcParams.update({"font.size": 8, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42})
    fig, ax = plt.subplots(1, 3, figsize=(7.2, 2.5))
    a = ax[0]
    a.scatter(df["eog_blink_rate"], df["mp_blink_rate"], s=13, color="#165d8f", label="website pipeline")
    a.scatter(df["eog_blink_rate"], df["rs_blink_rate"], s=13, facecolors="none", edgecolors="0.45", label="rescaled score")
    lim = [0, max(df["eog_blink_rate"].max(), df["rs_blink_rate"].max(), df["mp_blink_rate"].max()) * 1.05]
    a.plot(lim, lim, color="0.75", lw=0.8, ls="--")
    s1 = out["all_tests"]["blink_rate_vs_eog"]
    s2 = out["all_tests"]["rescaled_blink_rate_vs_eog"]
    a.set_title("A  Blink rate vs EOG", loc="left", fontsize=8)
    a.text(0.03, 0.78, f"rho = {s1['spearman']:.2f} (website)\nrho = {s2['spearman']:.2f} (rescaled)", transform=a.transAxes, ha="left", va="top", fontsize=7, bbox=dict(facecolor="white", edgecolor="none", alpha=0.9, pad=1))
    a.set_xlabel("EOG blinks/min")
    a.set_ylabel("MediaPipe blinks/min")
    a.legend(frameon=False, fontsize=6.5, loc="upper left")
    a = ax[1]
    m = df.groupby("test")[["mp_perclos", "rs_perclos", "ear_perclos"]].agg(["mean", "sem"]) * 100
    xs = m.index.to_numpy()
    for col, lab, sty in [("mp_perclos", "website pipeline", dict(color="#165d8f", marker="o")), ("rs_perclos", "rescaled score", dict(color="0.45", marker="s", mfc="none")), ("ear_perclos", "landmark EAR", dict(color="#c2410c", marker="^"))]:
        a.errorbar(xs, m[(col, "mean")], yerr=m[(col, "sem")], lw=1.2, ms=4, capsize=2, label=lab, **sty)
    a.set_xticks([1, 2, 3])
    a.set_xlabel("Test (increasing sleep deprivation)")
    a.set_ylabel("PERCLOS (%)")
    a.set_title("B  PERCLOS by test (mean, SE)", loc="left", fontsize=8)
    a.legend(frameon=False, fontsize=6.5, loc="lower right", bbox_to_anchor=(1.0, 0.07))
    a = ax[2]
    for subj, g in df.sort_values("test").groupby("subject"):
        a.plot(g["mp_blink_ms"], g["kss"], color="0.7", lw=0.7, marker="o", ms=2.5)
    rc = out["all_tests"]["rmcorr_mp_blink_ms_kss"]
    a.set_title("C  Blink duration vs KSS", loc="left", fontsize=8)
    a.text(0.03, 0.97, f"within-person r = {rc['r']:.2f}, p = {rc['p']:.3f}", transform=a.transAxes, ha="left", va="top", fontsize=7, bbox=dict(facecolor="white", edgecolor="none", alpha=0.9, pad=1))
    a.set_ylim(1.5, 10.2)
    a.set_xlabel("MediaPipe blink duration (ms)")
    a.set_ylabel("KSS")
    fig.tight_layout()
    fig.savefig(res / "fig_drozy_mediapipe.pdf")
    print(json.dumps({k: out[k] for k in ["n_tests", "face_detection_rate"]}, indent=1))
    print(json.dumps(out["all_tests"], indent=1)[:3000])


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "extract":
        jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 6
        extract(sys.argv[2], sys.argv[3], sys.argv[4], jobs)
    elif cmd == "compare":
        compare(sys.argv[2])
    else:
        raise SystemExit("usage: extract <DROZY dir> <model> <out dir> [--jobs N] | compare <results dir>")
