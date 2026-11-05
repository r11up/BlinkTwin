"""Blink counts from DROZY's vertical EOG, used as ground truth for the landmark-based blink meter.

Minimal EDF reader (no extra dependency). Blinks: EOG-V band-passed 0.5-15 Hz; positive peaks with prominence > k * robust SD, width 40-600 ms, at least 150 ms apart.
Writes results/drozy_eog.csv (per test: blink count, rate per minute, median peak width in ms).

Usage: python -I drozy_eog.py <DROZY dir> <out csv>
"""
import sys
from pathlib import Path

import numpy as np
from scipy import signal


def read_edf(path):
    raw = Path(path).read_bytes()
    h = lambda a, b: raw[a:b].decode("latin-1").strip()
    n_rec, dur, ns = int(h(236, 244)), float(h(244, 252)), int(h(252, 256))
    off = 256
    def field(width):
        nonlocal off
        vals = [raw[off + i * width: off + (i + 1) * width].decode("latin-1").strip() for i in range(ns)]
        off += width * ns
        return vals
    labels = field(16); field(80); field(8)
    pmin = np.array(field(8), float); pmax = np.array(field(8), float)
    dmin = np.array(field(8), float); dmax = np.array(field(8), float)
    field(80); spr = np.array(field(8), int); field(32)
    hdr = int(h(184, 192))
    data = np.frombuffer(raw[hdr:hdr + n_rec * spr.sum() * 2], dtype="<i2").reshape(n_rec, spr.sum())
    out, start = {}, 0
    for i, lab in enumerate(labels):
        d = data[:, start:start + spr[i]].reshape(-1).astype(float)
        start += spr[i]
        out[lab] = (d - dmin[i]) * (pmax[i] - pmin[i]) / (dmax[i] - dmin[i]) + pmin[i]
    fs = {lab: spr[i] / dur for i, lab in enumerate(labels)}
    return out, fs


def eog_blinks(x, fs, k=5.0):
    b, a = signal.butter(2, [0.5, 15], btype="band", fs=fs)
    y = signal.filtfilt(b, a, x)
    rsd = 1.4826 * np.median(np.abs(y - np.median(y)))
    # Blinks are positive deflections of vertical EOG (upper electrode); fixed polarity, as automatic
    # polarity choice picked up eye movements in some recordings.
    pk, pr = signal.find_peaks(y, prominence=k * rsd, width=(0.04 * fs, 0.6 * fs), distance=int(0.15 * fs))
    return pk, pr["widths"] / fs * 1000, 1, rsd

if __name__ == "__main__":
    D, out = Path(sys.argv[1]), Path(sys.argv[2])
    rows = ["subject,test,eog_blinks,minutes,eog_blink_rate,eog_median_width_ms,polarity"]
    for f in sorted([p for p in (D / "psg").glob("*.edf") if not p.name.startswith(".")], key=lambda p: tuple(map(int, p.stem.split("-")))):
        sig, fs = read_edf(f)
        key = next(k for k in sig if k.upper().replace(" ", "") in ("EOG-V", "EOGV"))
        pk, widths, sgn, _ = eog_blinks(sig[key], fs[key])
        minutes = len(sig[key]) / fs[key] / 60
        s, t = f.stem.split("-")
        rows.append(f"{s},{t},{len(pk)},{minutes:.2f},{len(pk) / minutes:.2f},{np.median(widths) if len(widths) else float('nan'):.0f},{sgn}")
        print(rows[-1])
    out.write_text("\n".join(rows) + "\n")
