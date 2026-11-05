#!/usr/bin/env bash
# Builds the arXiv submission package for the BlinkTwin preprint and checks that it compiles on its own.
#
#   cd paper && bash make_arxiv.sh
#
# Output: paper/arxiv/ (the flattened sources) and paper/blinktwin-arxiv.tar.gz (upload this to arXiv).
# arXiv compiles the LaTeX itself, so the package must contain every figure next to the sources and the
# pre-built bibliography (main.bbl); paths outside the folder (../results, ../docs) do not work there.
set -euo pipefail
cd "$(dirname "$0")"

latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex >/dev/null

rm -rf arxiv
mkdir -p arxiv/sections arxiv/figures
cp main.tex main.bbl arxiv/
cp sections/*.tex arxiv/sections/
# only figures from the folder itself: arXiv must not see ../ paths
sed -i 's#\\graphicspath{{figures/}{../results/}{../docs/img/}}#\\graphicspath{{figures/}}#' arxiv/main.tex
sed -i '/^% arXiv package:/d' arxiv/main.tex

# every figure the paper includes, found in the same search path as the main build
for name in $(grep -ho '\\includegraphics\(\[[^]]*\]\)\?{[^}]*}' main.tex sections/*.tex | sed 's/.*{\(.*\)}/\1/' | sort -u); do
  found=""
  for dir in figures ../results ../docs/img; do
    if [ -f "$dir/$name" ]; then cp "$dir/$name" arxiv/figures/; found=1; break; fi
  done
  [ -n "$found" ] || { echo "missing figure: $name" >&2; exit 1; }
done

rm -f blinktwin-arxiv.tar.gz
tar -czf blinktwin-arxiv.tar.gz -C arxiv .

# test: compile the package in a clean directory with pdflatex only, as arXiv does
test_dir=$(mktemp -d)
tar -xzf blinktwin-arxiv.tar.gz -C "$test_dir"
( cd "$test_dir" && pdflatex -interaction=nonstopmode -halt-on-error main.tex >/dev/null && pdflatex -interaction=nonstopmode -halt-on-error main.tex >/dev/null )
if grep -q "undefined" "$test_dir/main.log"; then
  echo "undefined references or citations in the arXiv build" >&2
  grep "undefined" "$test_dir/main.log" >&2
  exit 1
fi
pages=$(pdfinfo "$test_dir/main.pdf" | awk '/^Pages/ {print $2}')
size=$(du -h blinktwin-arxiv.tar.gz | cut -f1)
rm -rf "$test_dir"
echo "arXiv package OK: paper/blinktwin-arxiv.tar.gz ($size, $pages pages when compiled)"
