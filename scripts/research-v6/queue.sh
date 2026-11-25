#!/usr/bin/env bash
# Run "a:b family shard pairs" jobs from stdin with N parallel workers (default 4).
# Usage: scripts/research-v6/queue.sh OUTDIR [N] < jobs.txt
out=$1; n=${2:-4}; mkdir -p "$out"
grep -v '^#' | grep -v '^$' | xargs -P "$n" -L 1 bash -c 'm=$0; npx tsx scripts/research-v5/bench.ts --a ${m%%:*} --b ${m##*:} --family $1 --shard $2 --pairs $3 --out '"$out"' 2>/dev/null | grep V5_SHARD'
