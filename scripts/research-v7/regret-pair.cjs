// Paired comparison of regret files measured on the SAME state list (same family/games/K/shard).
//   node scripts/research-v7/regret-pair.cjs fileA.json[,fileB.json...] "X-Y,..."   (kinds may come from any file)
const files = process.argv[2].split(",").map((f) => require(require("path").resolve(f)));
const n = files[0].rows.length;
for (const f of files) { if (f.rows.length !== n) throw Error("different state lists"); for (let i = 0; i < n; i++) if (Math.abs(f.rows[i].exact - files[0].rows[i].exact) > 1e-12) throw Error("state mismatch at " + i); }
const reg = (k, i) => { for (const f of files) if (k in f.rows[i].regret) return f.rows[i].regret[k]; throw Error("kind " + k); };
const kinds = [...new Set(files.flatMap((f) => f.kinds))];
const stat = (d) => { const m = d.reduce((s, v) => s + v, 0) / d.length; const se = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1) / d.length); return { m: +(100 * m).toFixed(4), se: +(100 * se).toFixed(4) }; };
const out = { states: n, mean: {}, pairs: {} };
for (const k of kinds) out.mean[k] = stat(files[0].rows.map((_, i) => reg(k, i)));
for (const p of (process.argv[3] || "").split(",").filter(Boolean)) { const [x, y] = p.split("-"); out.pairs[p] = stat(files[0].rows.map((_, i) => reg(x, i) - reg(y, i))); }
console.log(JSON.stringify(out));
