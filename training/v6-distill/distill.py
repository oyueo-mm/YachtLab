"""PMF neural distillation (v6, technique 16): MLP state -> softmax over future points.
Softmax output guarantees non-negative mass summing to 1; support is masked to the exact
support length of each state (stored per state as one int). Loss = KL(exact || model).
Train on masks with hash % 10 != 0, report fit on train and held-out masks, then refit on all
states and export a bank (yachtlab-policy-pmf-1 format) for decision-level evaluation.
  python3 training/v6-distill/distill.py [hidden=512] [epochs=30]
"""
import json, sys, time, numpy as np
d = "training/checkpoints/v6/distill/"
meta = json.load(open(d + "meta.json")); n, F, B = meta["n"], meta["F"], meta["BINS"]
X = np.fromfile(d + "X.f32", np.float32).reshape(n, F)
Y = np.fromfile(d + "Y.f32", np.float32).reshape(n, B)
L = np.fromfile(d + "L.i32", np.int32); keys = np.fromfile(d + "keys.i32", np.int32)
H = int(sys.argv[1]) if len(sys.argv) > 1 else 512
EP = int(sys.argv[2]) if len(sys.argv) > 2 else 30
supp = np.arange(B)[None, :] < L[:, None]
masks = keys >> 6
held = ((masks.astype(np.int64) * 2654435761) % 2**32) % 10 == 0

def init(seed):
    r = np.random.default_rng(seed)
    return [r.normal(0, np.sqrt(2 / F), (F, H)).astype(np.float32), np.zeros(H, np.float32),
            r.normal(0, np.sqrt(2 / H), (H, H)).astype(np.float32), np.zeros(H, np.float32),
            r.normal(0, np.sqrt(1 / H), (H, B)).astype(np.float32), np.zeros(B, np.float32)]

def forward(P, x, s):
    h1 = np.maximum(x @ P[0] + P[1], 0); h2 = np.maximum(h1 @ P[2] + P[3], 0)
    z = h2 @ P[4] + P[5]; z = np.where(s, z, -1e30); z -= z.max(1, keepdims=True)
    e = np.exp(z) * s; q = e / e.sum(1, keepdims=True)
    return h1, h2, q

def train(idx, epochs, seed=1):
    P = init(seed); M = [np.zeros_like(p) for p in P]; V = [np.zeros_like(p) for p in P]
    lr, b1, b2, t, bs = 1e-3, 0.9, 0.999, 0, 512
    r = np.random.default_rng(seed)
    for ep in range(epochs):
        perm = r.permutation(idx); t0 = time.time(); tot = 0.0
        cur = lr * (0.5 * (1 + np.cos(np.pi * ep / epochs)))
        for i in range(0, len(perm), bs):
            j = perm[i:i + bs]; x, y, s = X[j], Y[j], supp[j]
            h1, h2, q = forward(P, x, s)
            tot += float(-(y * np.log(np.maximum(q, 1e-30))).sum())
            g = (q - y) / len(j)
            gW3 = h2.T @ g; gb3 = g.sum(0); g2 = (g @ P[4].T) * (h2 > 0)
            gW2 = h1.T @ g2; gb2 = g2.sum(0); g1 = (g2 @ P[2].T) * (h1 > 0)
            gW1 = x.T @ g1; gb1 = g1.sum(0)
            t += 1
            for k, gr in enumerate([gW1, gb1, gW2, gb2, gW3, gb3]):
                M[k] = b1 * M[k] + (1 - b1) * gr; V[k] = b2 * V[k] + (1 - b2) * gr * gr
                P[k] -= cur * (M[k] / (1 - b1 ** t)) / (np.sqrt(V[k] / (1 - b2 ** t)) + 1e-8)
        print(f"epoch {ep + 1}/{epochs} xent/state {tot / len(perm):.5f} {time.time() - t0:.1f}s", file=sys.stderr, flush=True)
    return P

def metrics(P, idx):
    out = {"states": int(len(idx))}
    tv, w1, crps, mean, tail = [], [], [], [], []
    for i in range(0, len(idx), 4096):
        j = idx[i:i + 4096]; q = forward(P, X[j], supp[j])[2].astype(np.float64); y = Y[j].astype(np.float64)
        y /= y.sum(1, keepdims=True)
        cd = np.cumsum(q, 1) - np.cumsum(y, 1)
        tv.append(0.5 * np.abs(q - y).sum(1)); w1.append(np.abs(cd).sum(1)); crps.append((cd ** 2).sum(1))
        g = np.arange(B); mean.append(np.abs((q * g).sum(1) - (y * g).sum(1)))
        # upper tail: P(G >= mean + 2 sd) of the exact PMF
        mu = (y * g).sum(1, keepdims=True); sd = np.sqrt((y * (g - mu) ** 2).sum(1, keepdims=True)); th = g >= mu + 2 * sd
        tail.append(np.abs((q * th).sum(1) - (y * th).sum(1)))
    for name, v in [("TV", tv), ("W1", w1), ("CRPS", crps), ("meanAbsErr", mean), ("tailAbsErr", tail)]:
        v = np.concatenate(v); out[name] = {"mean": float(v.mean()), "p99": float(np.quantile(v, 0.99)), "max": float(v.max())}
    return out

tr, te = np.where(~held)[0], np.where(held)[0]
res = {"hidden": H, "epochs": EP, "params": int(F * H + H + H * H + H + H * B + B), "features": F, "bins": B}
P = train(tr, EP)
res["train"] = metrics(P, tr); res["heldOutMasks"] = metrics(P, te)
print(json.dumps(res), flush=True)
P = train(np.arange(n), EP, seed=2)
res["allStatesFit"] = metrics(P, np.arange(n))
res["modelBytesFloat32"] = res["params"] * 4
np.savez(d + f"mlp{H}.npz", *P)
# export bank on the exact support lengths, renormalised in float64
q_all = np.concatenate([forward(P, X[i:i + 4096], supp[i:i + 4096])[2] for i in range(0, n, 4096)]).astype(np.float64)
with open(d + f"mlp{H}.f64bank", "wb") as f:
    f.write((json.dumps({"format": "yachtlab-policy-pmf-1", "name": f"DP Expert (MLP {H} distilled)", "states": int(n), "floats": int(L.sum())}) + "\n").encode())
    np.stack([keys, L], 1).astype(np.int32).tofile(f)
    for i in range(n):
        p = q_all[i, :L[i]]; (p / p.sum()).tofile(f)
json.dump(res, open(f"training/results/v6/distill-mlp{H}.json", "w"), indent=1)
print(json.dumps(res))
