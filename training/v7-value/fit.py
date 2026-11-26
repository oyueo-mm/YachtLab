"""v7 residual value learning on exact interactive teacher data (numpy only; no PyTorch in this environment).

Target: exact interactive turn-start win credit (scripts/research-v7/teacher.ts).
Base:   an estimator's turn-start value (default v_I2RO). Model predicts the residual in logit space.
Evaluation (grouped by game, no game in both train and test):
  A) 5-fold CV on all rows
  B) EXTRAPOLATION: train on max(k,ko) <= 4, test on max(k,ko) == 5  (proxy for early/mid-game generalisation)
Reports MAE / RMSE / bias (percentage points) and Brier-style squared error of base vs corrected values.

  python3 -I training/v7-value/fit.py training/data/v7/teacher-f9106-K5-s0.csv training/data/v7/teacher-f9106-K5-s1.csv
"""
import csv
import json
import sys

import numpy as np

BASES = ["v_R", "v_P", "v_I1RO", "v_I2RO", "v_I2RO1"]


def load(paths):
    rows = []
    for si, p in enumerate(paths):
        with open(p) as f:
            for r in csv.DictReader(f):
                r["gid"] = f"{si}:{r['game']}"
                rows.append(r)
    return rows


def feats(r):
    m, o = int(r["mask"]), int(r["omask"])
    f = [((m >> c) & 1) for c in range(12)] + [((o >> c) & 1) for c in range(12)]
    u, ou = int(r["u"]), int(r["ou"])
    f += [u / 63, ou / 63, float(u >= 63), float(ou >= 63), int(r["k"]) / 12, int(r["ko"]) / 12, float(r["D"]) / 50]
    lg = lambda v: np.log(np.clip(v, 1e-6, 1 - 1e-6) / (1 - np.clip(v, 1e-6, 1 - 1e-6)))
    f += [lg(float(r[b])) / 5 for b in BASES]
    return f


def logit(v):
    v = np.clip(v, 1e-4, 1 - 1e-4)
    return np.log(v / (1 - v))


def sig(z):
    return 1 / (1 + np.exp(-np.clip(z, -30, 30)))


def ridge(X, y, lam=1e-2):
    Xb = np.hstack([X, np.ones((len(X), 1))])
    w = np.linalg.solve(Xb.T @ Xb + lam * np.eye(Xb.shape[1]), Xb.T @ y)
    return lambda Z: np.hstack([Z, np.ones((len(Z), 1))]) @ w


def mlp(X, y, hidden=64, epochs=300, lr=3e-3, wd=1e-4, seed=0):
    rng = np.random.default_rng(seed)
    W1 = rng.normal(0, 1 / np.sqrt(X.shape[1]), (X.shape[1], hidden)); b1 = np.zeros(hidden)
    W2 = rng.normal(0, 1 / np.sqrt(hidden), (hidden, 1)); b2 = np.zeros(1)
    ps = [W1, b1, W2, b2]; m = [np.zeros_like(p) for p in ps]; v = [np.zeros_like(p) for p in ps]; t = 0
    n = len(X)
    for _ in range(epochs):
        idx = rng.permutation(n)
        for s in range(0, n, 256):
            bi = idx[s:s + 256]; xb, yb = X[bi], y[bi][:, None]
            h = np.maximum(0, xb @ W1 + b1); pred = h @ W2 + b2
            g = 2 * (pred - yb) / len(bi)
            gW2 = h.T @ g; gb2 = g.sum(0); gh = g @ W2.T * (h > 0); gW1 = xb.T @ gh; gb1 = gh.sum(0)
            t += 1
            for i, (p, gp) in enumerate(zip(ps, [gW1, gb1, gW2, gb2])):
                gp = gp + wd * p
                m[i] = 0.9 * m[i] + 0.1 * gp; v[i] = 0.999 * v[i] + 0.001 * gp * gp
                p -= lr * (m[i] / (1 - 0.9 ** t)) / (np.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8)
    return lambda Z: (np.maximum(0, Z @ W1 + b1) @ W2 + b2)[:, 0]


def metrics(pred, exact):
    e = (pred - exact) * 100
    return {"maePP": float(np.mean(np.abs(e))), "rmsePP": float(np.sqrt(np.mean(e ** 2))), "biasPP": float(np.mean(e)), "n": int(len(e))}


def evaluate(rows, train_idx, test_idx, base):
    X = np.array([feats(r) for r in rows]); ex = np.array([float(r["exact"]) for r in rows]); bv = np.array([float(r[base]) for r in rows])
    y = logit(ex) - logit(bv)
    mu, sd = X[train_idx].mean(0), X[train_idx].std(0) + 1e-9
    Xs = (X - mu) / sd
    out = {"base": metrics(bv[test_idx], ex[test_idx])}
    for name, fit in [("ridge", ridge), ("mlp64", mlp)]:
        f = fit(Xs[train_idx], y[train_idx])
        out[name] = metrics(sig(logit(bv[test_idx]) + f(Xs[test_idx])), ex[test_idx])
    return out


def main(paths):
    rows = load(paths)
    games = sorted({r["gid"] for r in rows})
    res = {"rows": len(rows), "games": len(games), "files": paths, "baseline_mae_by_estimator": {}}
    ex = np.array([float(r["exact"]) for r in rows])
    for b in BASES:
        res["baseline_mae_by_estimator"][b] = metrics(np.array([float(r[b]) for r in rows]), ex)
    rng = np.random.default_rng(1)
    fold = {g: i % 5 for i, g in enumerate(rng.permutation(games))}
    for base in ["v_P", "v_I2RO", "v_I2RO1"]:
        cv = []
        for k in range(5):
            tr = np.array([i for i, r in enumerate(rows) if fold[r["gid"]] != k], dtype=int); te = np.array([i for i, r in enumerate(rows) if fold[r["gid"]] == k], dtype=int)
            if len(te) == 0 or len(tr) == 0:
                continue
            cv.append(evaluate(rows, tr, te, base))
        res[f"cv5_{base}"] = {m: {k: float(np.mean([c[m][k] for c in cv])) for k in ["maePP", "rmsePP", "biasPP"]} for m in cv[0]}
        tr = np.array([i for i, r in enumerate(rows) if max(int(r["k"]), int(r["ko"])) <= 4], dtype=int); te = np.array([i for i, r in enumerate(rows) if max(int(r["k"]), int(r["ko"])) == 5], dtype=int)
        if len(te):
            res[f"extrapolate_le4_to_5_{base}"] = evaluate(rows, tr, te, base)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
