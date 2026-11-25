#!/usr/bin/env bash
# usage: run-matrix.sh FAMILY PAIRS_PER_SHARD SHARDS OUTDIR "a1:b1 a2:b2 ..."  (parallel = nproc)
set -euo pipefail
FAMILY=$1; PAIRS=$2; SHARDS=$3; OUT=$4; MATCHES=$5
JOBS=()
for m in $MATCHES; do a=${m%%:*}; b=${m##*:}; for ((s=0; s<SHARDS; s++)); do JOBS+=("$a $b $s"); done; done
printf '%s\n' "${JOBS[@]}" | xargs -P "${PARALLEL:-$(nproc)}" -L 1 bash -c 'npx tsx scripts/research-v5/bench.ts --a $0 --b $1 --family '"$FAMILY"' --shard $2 --pairs '"$PAIRS"' --out '"$OUT"' 2>>'"$OUT"'/progress.log'
