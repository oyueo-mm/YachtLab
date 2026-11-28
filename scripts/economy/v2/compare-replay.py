"""Compare replay cells and the decompressed raw E1 corpus with the original archive."""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("legacy", type=Path, help="original docs/economy/v2")
parser.add_argument("replay", type=Path, help="runner --out")
parser.add_argument("report", type=Path)
args = parser.parse_args()
fields = {"everCapped", "reducedDayShare", "cappedDayShare"}


def compare(old, new, ptr, counts, unexpected):
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(old.keys() | new.keys()):
            loc = f"{ptr}/{key}"
            if key not in old or key not in new:
                unexpected.append([loc, key in old, key in new])
            elif key in fields:
                counts["capFieldsChecked"] += 1
                counts["capFieldsChanged"] += old[key] != new[key]
            else:
                compare(old[key], new[key], loc, counts, unexpected)
    elif old != new:
        unexpected.append([ptr, old, new])


report = {}
for i in range(8):
    name = f"E{i}"
    expected = json.loads((args.legacy / "results" / f"{name}.json").read_text())["cells"]
    path = args.replay / f"{name}.json"
    if not path.exists():
        report[name] = {"expected": len(expected), "status": "pending"}
        continue
    actual = json.loads(path.read_text())["cells"]
    changes = []
    counts = collections.Counter()
    compare(expected, actual, name, counts, changes)
    report[name] = {"expected": len(expected), "replayed": len(actual), **counts,
                    "otherChanged": len(changes), "firstDifferences": changes[:25]}

if (args.replay / "population.json").exists():
    source_pop = json.loads((args.legacy / "results" / "population.json").read_text())["populations"]
    replay_pop = json.loads((args.replay / "population.json").read_text())["populations"]
    changes = []
    compare(source_pop, replay_pop, "population", collections.Counter(), changes)
    report["population"] = {"otherChanged": len(changes), "firstDifferences": changes[:25]}

original = args.legacy / "raw" / "E1-users.csv.gz"
current = args.replay / "E1-users.csv.gz"
if current.exists():
    def digest(path):
        with gzip.open(path, "rb") as stream:
            header, *data = stream.read().splitlines()
        return {"sha256Sorted": hashlib.sha256(b"\n".join([header, *sorted(data)])).hexdigest(), "rows": len(data)}
    report["rawE1"] = {"original": digest(original), "replayed": digest(current)}

args.report.parent.mkdir(parents=True, exist_ok=True)
tmp = args.report.with_suffix(".tmp")
tmp.write_text(json.dumps(report, indent=2) + "\n")
tmp.replace(args.report)
