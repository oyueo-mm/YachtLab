#!/bin/sh
# Run "A B shard" lines of a job file with bench.ts in parallel (resumable: skips finished shards).
#   sh scripts/research-v7/run-jobs.sh JOBS FAMILY PAIRS OUTDIR [PARALLEL]
JOBS=$1 FAM=$2 PAIRS=$3 OUT=$4 P=${5:-4}
export FAM PAIRS OUT
grep -v '^#' "$JOBS" | xargs -P "$P" -L 1 sh -c '
  f="$OUT/$0_vs_$1-f$FAM-s$2.json.gz"
  [ -f "$f" ] && exit 0
  NODE_OPTIONS=--max-old-space-size=6000 V5_COMMIT=$(git rev-parse HEAD) npx tsx scripts/research-v5/bench.ts --a $0 --b $1 --family $FAM --shard $2 --pairs $PAIRS --out "$OUT" < /dev/null 2>&1 | grep -E "V5_SHARD|Error" >> "$OUT/shards.log"'
