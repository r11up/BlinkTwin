#!/usr/bin/env bash
# Downloads the two public datasets BlinkTwin's analyses use into data/raw/.
# Running this means you accept each dataset's terms:
#  - OpenNeuro ds004902 (Xiang et al., 2024): OpenNeuro's data-use terms (no attempt to re-identify anyone).
#  - DROZY (Massoz et al., 2016): research and evaluation only, no commercial use, no redistribution,
#    no modification, no disclosure of identities, no display of images except those marked publishable,
#    and cite the WACV 2016 paper. Licence: https://orbi.uliege.be/bitstream/2268/191620/5/DROZY-LicenseAgreement-20180718.pdf
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw/openneuro-ds004902 data/raw/drozy

curl -fsSL -o data/raw/openneuro-ds004902/participants.tsv https://s3.amazonaws.com/openneuro.org/ds004902/participants.tsv
curl -fsSL -o data/raw/openneuro-ds004902/participants.json https://s3.amazonaws.com/openneuro.org/ds004902/participants.json

# DROZY.zip is about 2.46 GB and the server does not support resuming, so a dropped connection means starting again.
if ! unzip -tq data/raw/drozy/DROZY.zip >/dev/null 2>&1; then
  curl -fL -o data/raw/drozy/DROZY.zip https://orbi.uliege.be/bitstream/2268/191620/4/DROZY.zip
fi
unzip -tq data/raw/drozy/DROZY.zip
echo "Data ready in data/raw/"
