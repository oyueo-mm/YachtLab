"""Build five local experiments from a clean checkout. Changes stay in the scratch copy."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

repo = Path(os.environ.get("YACHT_SOURCE_CHECKOUT", Path.cwd())).resolve()
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
scratch = out / "source"
scratch.mkdir()
for name in ("src",):
    shutil.copytree(repo / name, scratch / name)
for name in ("vite.config.ts", "index.html", "package.json"):
    shutil.copyfile(repo / name, scratch / name)
for name in ("public", "node_modules", "training", "benchmarks", "docs"):
    (scratch / name).symlink_to(repo / name, target_is_directory=True)

edits = {
    "initial-dom": [("src/play/Tutorial.tsx", "<DiceArea state={game}", '<DiceArea forceRenderer="2.5d" state={game}')],
    "defer-3d": [
        ("src/play/Tutorial.tsx", 'const wants3d = diceRenderer(settings).startsWith("3d");', "const wants3d = false;"),
        ("src/play/Tutorial.tsx", "<DiceArea state={game}", '<DiceArea forceRenderer="2.5d" state={game}'),
        ("src/App.tsx", 'if (diceRenderer().startsWith("3d")) preloadDiceTableWhenIdle();',
         'if (!tutorialReturn && diceRenderer().startsWith("3d")) preloadDiceTableWhenIdle();'),
    ],
    "delayed-precache": [
        ("src/main.tsx", 'void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" }).catch(() => undefined);',
         'window.setTimeout(() => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" }).catch(() => undefined), 5000);'),
    ],
    "split": [
        ("vite.config.ts", 'worker: { format: "es" },',
         '''worker: { format: "es" },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return "three-runtime";
    if (/[\\/]node_modules[\\/]cannon-es[\\/]/.test(id)) return "dice-physics";
  } } } },'''),
    ],
}

# All variants have the same timing probes. Render calls after the first are left uninstrumented.
instrument = [
    ("src/dice3d-loader.ts", 'loading ??= import("./dice3d/table")',
     'if (!loading) performance.mark("dice-load-start");\n  loading ??= import("./dice3d/table")'),
    ("src/dice3d-loader.ts", ".then((m) => (loaded = m))",
     '.then((m) => { performance.mark("dice-load-end"); return loaded = m; })'),
    ("src/dice3d/table.ts", 'this.renderer = new THREE.WebGLRenderer',
     'performance.mark("dice-context-start");\n    this.renderer = new THREE.WebGLRenderer'),
    ("src/dice3d/table.ts", 'host.appendChild(this.canvas);', 'host.appendChild(this.canvas);\n    performance.mark("dice-context-end");'),
]
tracked = {name: (scratch / name).read_text() for name, *_ in [*instrument, *(row for variant in edits.values() for row in variant)]}
if os.environ.get("YACHT_WARMUP_PROBES"):
    instrument.extend([
        ("src/dice3d/table.ts", "this.warmed = true;", 'this.warmed = true;\n    performance.mark("dice-warm-start");'),
        ("src/dice3d/table.ts", "this.renderer.compile(this.scene, this.camera);",
         'this.renderer.compile(this.scene, this.camera);\n      performance.mark("dice-warm-compiled");'),
        ("src/dice3d/table.ts", "this.renderer.initTexture(this.blob);",
         'this.renderer.initTexture(this.blob);\n      performance.mark("dice-warm-textures");'),
        ("src/dice3d/table.ts", "for (const id of hidden) this.setVisible(id, this.meshes.get(id)!, false);",
         'for (const id of hidden) this.setVisible(id, this.meshes.get(id)!, false);\n    performance.mark("dice-warm-end");'),
    ])
tracked.update({name: (scratch / name).read_text() for name, *_ in instrument})
variants = ["baseline", *edits]
only = os.environ.get("YACHT_PROFILE_ONLY")
if only:
    variants = [only]
    if only != "baseline" and only not in edits:
        raise ValueError(f"Unknown variant {only}")
for variant in variants:
    for name, source in tracked.items():
        (scratch / name).write_text(source)
    for name, before, after in [*instrument, *edits.get(variant, [])]:
        path = scratch / name
        source = path.read_text()
        if source.count(before) != 1:
            raise ValueError(f"Expected one anchor in {name}: {before}")
        path.write_text(source.replace(before, after))
    subprocess.run([str(repo / "node_modules/.bin/vite"), "build", "--outDir", str(out / variant)],
                   cwd=scratch, check=True, stdout=(out / f"{variant}-build.txt").open("w"))
(out / "build-context.json").write_text(json.dumps({"commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(), "variants": variants}, indent=2))
