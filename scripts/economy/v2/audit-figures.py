"""Generate SVG plots from C1's archived result files (requires matplotlib)."""
import argparse
import json
from pathlib import Path

import matplotlib as mpl
from matplotlib import pyplot as plt

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
args = parser.parse_args()
root = args.source
figures = root / "figures"
figures.mkdir(exist_ok=True)
mpl.rcParams.update({"svg.hashsalt": "yachtlab-c1", "font.size": 10, "axes.spines.right": False, "axes.spines.top": False})


def load(path):
    return json.loads((root / path).read_text())


def save(fig, filename):
    fig.savefig(figures / filename, bbox_inches="tight", metadata={"Date": None})
    plt.close(fig)


holdout = load("H1/summary.json")
points = holdout["objectives"]
offsets = {
    "BASE": (-43, -13), "C1-SAFE": (-42, 1), "C1-PRICE": (22, -9), "C1-LOOP": (-64, 5),
    "C1-LONG": (20, -11), "C1-PRICE-R": (-63, 5), "C1-QUEST": (13, 3), "C1-COMBO": (13, 8),
    "V2-CONS": (8, -7), "V2-BAL": (8, -8), "V2-EXP": (-53, 5),
}
fig, ax = plt.subplots(figsize=(8.1, 4.45))
front = holdout["pareto"]["existingDesiredVersusIssue"]
ax.plot([points[k]["issue90"] for k in front], [100 * points[k]["desired30"] for k in front],
        color="#147f87", linewidth=1.35, alpha=0.6, zorder=0)
for name, p in points.items():
    color = "#a0491a" if name == "C1-PRICE" else "#0d646e" if name in front else "#606e83"
    ax.scatter(p["issue90"], 100 * p["desired30"], c=color, s=30)
    ax.annotate(name, (p["issue90"], 100 * p["desired30"]), xytext=offsets[name], textcoords="offset points", color=color, fontsize=8)
ax.set(xlabel="90-day gross coins per account (equal mean of four cohorts)",
       ylabel="Existing players obtaining their target by day 30 (%)", xlim=(13200, 36500), ylim=(9, 26))
ax.grid(alpha=0.2)
save(fig, "holdout-pareto.svg")

fig, ax = plt.subplots(figsize=(8, 4.5))
choices = ["BASE", "C1-SAFE", "C1-PRICE", "C1-QUEST", "C1-LOOP", "C1-PRICE-R", "V2-CONS", "V2-BAL", "V2-EXP"]
for i, policy in enumerate(choices):
    s = holdout["cohorts"]["existing60"][policy]["firstDirect"]
    v = s["median"]
    if v is not None:
        color = "#a0491a" if policy == "C1-PRICE" else "#0d646e"
        ax.errorbar(v, i, xerr=[[v - s["lo"]], [s["hi"] - v]], fmt="o", color=color, capsize=3)
ax.set(xlabel="Active minutes from policy switch to first direct purchase", yticks=range(len(choices)), yticklabels=choices)
ax.invert_yaxis()
ax.grid(axis="x", alpha=0.2)
save(fig, "holdout-first-direct.svg")

rev2 = load("catalog-and-draw.json")["catalogs"]["Rev2"]
fig, ax = plt.subplots(figsize=(7, 4.2))
for style, color, legend in [("cheap-first", "#a0491a", "Common low-price holdings first"), ("tier-balanced", "#0d646e", "Holdings distributed across tiers")]:
    data = [x for x in rev2["coverage"] if x["kind"] == style]
    ax.plot([100 * row["owned"] / sum(x["count"] for x in rev2["byTier"].values()) for row in data],
            [next(d["newly"] for d in row["draws"] if d["n"] == 5) for row in data],
            color=color, marker="o", label=legend)
ax.set(xlabel="Share of standard draw pool owned (%)", ylabel="Expected distinct new items in five draws", ylim=(0, 5.1))
ax.grid(alpha=0.2)
ax.legend(frameon=False)
save(fig, "draw-coverage.svg")

if (root / "E9/E9.json").exists():
    rows = [v["h"]["1"] for v in sorted(load("E9/E9.json")["cells"].values(), key=lambda v: v["scenario"])
            if v["age"] == "60" and v["revision"] == "2"]
    labels = [v["scenario"] for v in sorted(load("E9/E9.json")["cells"].values(), key=lambda v: v["scenario"])
              if v["age"] == "60" and v["revision"] == "2"]
    keys = {"Match": ["match"], "Quest": ["quest", "quest-bonus"], "Achievement": ["achievement"], "Draw duplicates": ["draw-duplicate"]}
    fig, ax = plt.subplots(figsize=(8, 4.5))
    left = [0] * len(rows)
    for label, names in keys.items():
        values = [sum(v["bySource"].get(k, 0) for k in names) for v in rows]
        ax.barh(labels, values, left=left, label=label)
        left = [a + b for a, b in zip(left, values)]
    ax.set_xlabel("Average coins on the four-hour budget day (Rev.2)")
    ax.legend(frameon=False)
    save(fig, "four-hour-sources.svg")

e8 = list(load("E8/E8.json")["cells"].values())
c_levels, r_levels = [50, 60, 70, 80], [55, 70, 85]
e8_time = {x["candidate"]: x["h"]["30"]["audit"]["firstDirect"]["median"]
           for x in e8 if x["scenario"] == "existing60"}
grid = [[e8_time[f"C1-A{c}-{r}"] for r in r_levels] for c in c_levels]
fig, ax = plt.subplots(figsize=(5.0, 4.0))
image = ax.imshow(grid, cmap="Blues", vmin=0)
for i, row in enumerate(grid):
    for j, value in enumerate(row):
        ax.text(j, i, f"{value:.0f}", ha="center", va="center", color="white" if value > image.norm.vmax * 0.63 else "#0c4d54")
ax.set(xlabel="Rare price (% of baseline)", ylabel="Common price (% of baseline)",
       xticks=range(len(r_levels)), xticklabels=r_levels, yticks=range(len(c_levels)), yticklabels=c_levels)
fig.colorbar(image, ax=ax, label="Existing players: first direct purchase (min)")
save(fig, "price-grid.svg")

if (root / "E13/E13.json").exists():
    cells = [c for c in load("E13/E13.json")["cells"].values() if c["scenario"] == "new180"]
    fig, ax = plt.subplots(figsize=(7.7, 4.15))
    colors = {"BASE": "#0d646e", "C1-PRICE": "#a0491a", "C1-LOOP": "#7055a4", "C1-LONG": "#6f7750", "V2-EXP": "#657490"}
    for cell in cells:
        p = cell["candidate"]
        horizon = [1, 7, 30, 90, 180]
        ax.plot(horizon, [cell["h"][str(h)]["owned"]["mean"] for h in horizon], marker="o", color=colors[p], label=p,
                alpha=0.8 if p != "C1-PRICE" else 1, linewidth=2.2 if p == "C1-PRICE" else 1.2,
                linestyle="-" if p in ("BASE", "C1-PRICE", "V2-EXP") else "--")
    ax.set(xlabel="Days", ylabel="Mean items owned (new 60-minute cohort)", xticks=[1, 30, 90, 180])
    ax.legend(frameon=False)
    ax.grid(alpha=0.2)
    save(fig, "ownership-180.svg")
