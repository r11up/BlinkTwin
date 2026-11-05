#!/usr/bin/env bash
# Makes the README figures in docs/img/ from the vector PDFs used in the paper.
#
#   bash scripts/readme_figures.sh
#
# The figures are written as SVG, so they stay sharp at any zoom and on high-density screens.
# Each gets a white background (GitHub's dark theme would otherwise show black text on a dark page)
# and a display width chosen for the README. Needs pdftocairo (poppler) and pdfcrop (TeX Live).
set -euo pipefail
cd "$(dirname "$0")/.."
out=docs/img
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# to_svg <pdf> <name> <display width in px>
to_svg() {
  pdftocairo -svg "$1" "$tmp/$2.svg"
  python3 - "$tmp/$2.svg" "$out/$2.svg" "$3" <<'PY'
import re, sys
src, dst, width = sys.argv[1], sys.argv[2], float(sys.argv[3])
svg = open(src, encoding="utf-8").read()
m = re.search(r"<svg\b[^>]*>", svg)
tag = m.group(0)
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', tag).group(1).split()]
height = width * vb[3] / vb[2]
new_tag = re.sub(r'\swidth="[^"]*"', f' width="{width:.0f}"', tag)
new_tag = re.sub(r'\sheight="[^"]*"', f' height="{height:.0f}"', new_tag)
background = f'<rect x="{vb[0]}" y="{vb[1]}" width="{vb[2]}" height="{vb[3]}" fill="#ffffff"/>'
svg = svg.replace(tag, new_tag + background, 1)
open(dst, "w", encoding="utf-8").write(svg)
PY
  echo "wrote $out/$2.svg"
}

to_svg paper/figures/architecture.pdf architecture 900
to_svg results/fig_sim_mae.pdf simulation 900
to_svg results/fig_drozy_twin.pdf drozy_replay 520
to_svg results/fig_drozy_blink_validation.pdf blink_validation 440

# MediaPipe on DROZY: panels A and B only. Panel C plots individual participants, which the DROZY
# licence and this project's data rule keep out of public figures (the paper trims it the same way).
pdfcrop --bbox "0 0 343.4 180" results/fig_drozy_mediapipe.pdf "$tmp/mediapipe_ab.pdf" >/dev/null
to_svg "$tmp/mediapipe_ab.pdf" mediapipe_drozy 620
