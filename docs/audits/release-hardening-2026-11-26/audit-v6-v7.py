"""Read archived v6/v7 tournament and teacher evidence without running experiments."""

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

ROOTS = ("training/results/v6", "training/results/v7")
MASK = 0xFFFFFFFF


def git(*args):
    return subprocess.check_output(["git", *args])


def seed(family, shard, pair):
    value = (0x5EED0000 + family * 1_000_003 + shard * 20_011 + pair) & MASK
    value = ((value ^ (value >> 16)) * 0x85EBCA6B) & MASK
    value = ((value ^ (value >> 13)) * 0xC2B2AE35) & MASK
    return value ^ (value >> 16)


def rows(path, data):
    if path.endswith(".json.gz"):
        yield json.loads(gzip.decompress(data))
    else:
        for line in data.decode().splitlines():
            if line.startswith(("V5_SHARD ", "V6_SHARD ")):
                yield json.loads(line.split(" ", 1)[1])
            elif path.endswith(".jsonl") and line.strip():
                yield json.loads(line)


def archives(refs, artifact_dir):
    seen = set()
    for ref in refs:
        for line in git("ls-tree", "-r", ref, "--", *ROOTS).decode().splitlines():
            meta, path = line.split("\t", 1)
            oid = meta.split()[2]
            is_evidence = path.endswith((".json.gz", "shards.log")) or re.search(r"/shards-.+\.jsonl$", path)
            is_teacher = "/teacher" in path and re.search(r"/teacher-f9106-.+\.csv(?:\.gz)?$", path)
            if (is_evidence or is_teacher) and (path, oid) not in seen:
                seen.add((path, oid))
                yield f"{ref}:{path}", path, git("cat-file", "blob", oid)
    if artifact_dir:
        for path in sorted(artifact_dir.rglob("*")):
            if path.name.endswith(".json.gz") or re.search(r"shards-.+\.jsonl$", path.name):
                yield str(path), str(path), path.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("refs", nargs="+", help="archived Git revisions")
    parser.add_argument("--artifact-dir", type=Path, help="optional directory of extracted workflow artifacts")
    parser.add_argument("--artifact-plan", type=Path, help="TSV with run ID, artifact ID, artifact name, and workflow SHA")
    args = parser.parse_args()
    findings = defaultdict(list)
    counts = Counter()
    pairs_by_family = Counter()
    null_commits_by_family = Counter()
    seed_addresses = {}
    teacher = defaultdict(set)
    versions = defaultdict(dict)
    tournaments = defaultdict(set)
    archive_splits = defaultdict(set)
    summary_counts = Counter()
    sampled_artifacts = set()
    artifact_plan = {}
    if args.artifact_plan:
        with args.artifact_plan.open() as plan:
            for run, _, name, sha in csv.reader(plan, delimiter="\t"):
                artifact_plan[(run, name)] = sha
    logs = []

    for source, path, data in archives(args.refs, args.artifact_dir):
        if "/teacher" in path and re.search(r"/teacher-f9106-.+\.csv(?:\.gz)?$", path):
            shard = int(re.search(r"-s(\d+)\.csv", path)[1])
            name = Path(path).parent.name
            if path.endswith(".gz"):
                data = gzip.decompress(data)
            for row in csv.DictReader(io.StringIO(data.decode())):
                game, actual = int(row["game"]), int(row["seed"])
                counts[f"{name}_position_rows"] += 1
                if seed(9106, shard, game) != actual:
                    findings["teacher_seed_mismatches"].append([source, game, actual])
                teacher[name].add((shard, game, actual))
            continue

        for row in rows(path, data):
            a, b, family, shard, length = (row[key] for key in ("a", "b", "family", "shard", "pairs"))
            key = (a, b, family, shard)
            summary = tuple(row[k] for k in ("pairs", "wins", "ties", "losses", "winCredit"))
            if sum(summary[1:4]) != 2 * length or (summary[1] + summary[2] / 2) != round(summary[4] * 2 * length, 8):
                findings["invalid_summary"].append(source)
            raw = row.get("raw")
            if raw is None:
                fields = ("s1", "s2") if "s1" in row else ("pairCreditSum", "pairCreditSumSq")
                moments = tuple(row[k] for k in fields)
                if moments[0] != round(summary[4] * length, 8) or not moments[0] ** 2 / length <= moments[1] <= moments[0]:
                    findings["invalid_moments"].append([source, key])
                counts["summary_rows"] += 1
                summary_counts[(source, key)] += 1
                archive_splits[(source, a, b, family)].add((shard, length))
                logs.append((source, key, summary, row.get("commit"), moments))
                continue
            counts["raw_tournament_shards"] += 1
            counts["raw_tournament_pairs"] += length
            if args.artifact_dir and args.artifact_dir in Path(path).parents:
                run, artifact = Path(path).relative_to(args.artifact_dir).parts[:2]
                sampled_artifacts.add((run, artifact))
                counts["ci_raw_tournament_shards"] += 1
                counts["ci_raw_tournament_pairs"] += length
                if artifact != f"v5-tournament-{shard}" or (artifact_plan and artifact_plan.get((run, artifact)) != row.get("commit")):
                    findings["ci_provenance_mismatches"].append([run, artifact, key, row.get("commit")])
            pairs_by_family[family] += length
            if not row.get("commit"):
                null_commits_by_family[family] += 1
            if len(raw) != 5 * length or row["games"] != length * 2:
                findings["raw_length_mismatches"].append(source)
                continue
            if re.search(r"-f\d+-s\d+\.json\.gz$", path):
                expected = f"{a}_vs_{b}-f{family}-s{shard}.json.gz"
                if Path(path).name != expected:
                    findings["filename_mismatches"].append(source)
            wins = ties = losses = 0
            s1 = s2 = 0
            for pair in range(length):
                actual, a0, b1, a1, b0 = raw[pair * 5:pair * 5 + 5]
                address = (family, shard, pair)
                if actual != seed(*address):
                    findings["tournament_seed_mismatches"].append([source, pair, actual])
                previous = seed_addresses.setdefault(actual, address)
                if address != previous:
                    findings["colliding_tournament_seed_addresses"].append([actual, previous, address])
                match = (tuple(sorted((a, b))), family, actual)
                if tournaments[match] and address not in tournaments[match]:
                    findings["repeated_matchup_seeds"].append([source, match, address])
                tournaments[match].add(address)
                won = int(a0 > b1) + int(a1 > b0)
                tied = int(a0 == b1) + int(a1 == b0)
                wins += won
                ties += tied
                losses += 2 - won - tied
                credit = (won + tied / 2) / 2
                s1 += credit
                s2 += credit * credit
            if (wins, ties, losses) != summary[1:4]:
                findings["raw_score_mismatches"].append(source)
            signature = (summary, row.get("commit"), (s1, s2))
            digest = hashlib.sha256(json.dumps(raw, separators=(",", ":")).encode()).hexdigest()
            versions[key].setdefault((signature, digest), []).append(source)

    for key, candidates in versions.items():
        if len(candidates) > 1:
            findings["divergent_raw_versions"].append([key, list(candidates.values())])
    for (source, key), copies in sorted(summary_counts.items()):
        if copies > 1:
            findings["repeated_summary_rows"].append([source, key, copies])
    for source, key, summary, commit, moments in logs:
        if not versions.get(key):
            counts["summary_rows_without_raw"] += 1
            continue
        if any(summary == a and (commit is None or commit == b) and moments == c for (a, b, c), _ in versions[key]):
            counts["summary_rows_matched_to_raw"] += 1
        else:
            findings["summary_raw_disagreements"].append([source, key])

    shared = teacher["teacher"] & teacher["teacher-v72"]
    result = {
        "refs": {ref: git("rev-parse", ref).decode().strip() for ref in args.refs},
        "counts": counts,
        "tournament_pairs_by_family": pairs_by_family,
        "raw_shards_missing_commit_by_family": null_commits_by_family,
        "unique_tournament_seed_addresses": len(seed_addresses),
        "ci_artifacts_examined": len(sampled_artifacts),
        "ci_runs_examined": len({run for run, _ in sampled_artifacts}),
        "ci_artifacts_missing_from_plan": sorted(artifact_plan.keys() - sampled_artifacts),
        "summaries": [
            {"file": file, "a": a, "b": b, "family": family, "shards": len(plan), "pairs": sum(n for _, n in plan)}
            for (file, a, b, family), plan in sorted(archive_splits.items())
        ],
        "teacher_unique_game_seeds": {name: len(games) for name, games in teacher.items()},
        "teacher_shared_game_seeds_by_shard": Counter(s for s, _, _ in shared),
        "findings": dict(findings),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
