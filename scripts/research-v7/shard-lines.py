"""Aggregate V6_SHARD lines (JSONL, copied from GitHub Actions job logs) into a seed-pair paired test.
   python3 -I scripts/research-v7/shard-lines.py FILE.jsonl [--alpha 0.01]
Win credit = win + 0.5 tie. One seed pair (seat-swapped 2 games) = one observation."""
import json, math, sys
from statistics import NormalDist
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
alpha = float(sys.argv[sys.argv.index("--alpha") + 1]) if "--alpha" in sys.argv else 0.01
groups = {}
for r in rows: groups.setdefault((r["a"], r["b"], r["family"]), []).append(r)
N = NormalDist()
for (a, b, f), rs in groups.items():
    shards = sorted(r["shard"] for r in rs); assert len(set(shards)) == len(shards), "duplicate shard"
    assert len({r["commit"] for r in rs}) == 1, "mixed commits"
    n = sum(r["pairs"] for r in rs); s1 = sum(r["s1"] for r in rs); s2 = sum(r["s2"] for r in rs)
    W = sum(r["wins"] for r in rs); T = sum(r["ties"] for r in rs); L = sum(r["losses"] for r in rs)
    assert W + T + L == 2 * n
    m = s1 / n; var = (s2 - n * m * m) / (n - 1); se = math.sqrt(var / n)
    z = (m - 0.5) / se; p1 = 1 - N.cdf(z); zc = N.inv_cdf(1 - alpha / 2)
    elo = 400 * math.log10(m / (1 - m))
    print(json.dumps({"a": a, "b": b, "family": f, "shards": len(rs), "shardIds": f"{shards[0]}-{shards[-1]}", "pairs": n, "games": 2 * n, "wins": W, "ties": T, "losses": L,
        "winCredit": round(100 * m, 4), "check_WTL": round(100 * (W + T / 2) / (2 * n), 4), "pairSD": round(math.sqrt(var), 5), "sePP": round(100 * se, 4),
        "ci": [round(100 * (m - zc * se), 3), round(100 * (m + zc * se), 3)], "ciLevel": 1 - alpha, "z": round(z, 3), "p_one_sided": round(p1, 5), "elo": round(elo, 2),
        "msA_mean_of_shards": round(sum(r["msA"] for r in rs) / len(rs), 3), "commit": rs[0]["commit"]}))
