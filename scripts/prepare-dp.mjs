import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { score, categories } = await server.ssrLoadModule("/src/engine.ts");
  const states = [];
  function visit(n, start, values) {
    if (!n) {
      states.push(values);
      return;
    }
    for (let v = start; v <= 6; v++) visit(n - 1, v, [...values, v]);
  }
  for (let n = 0; n <= 5; n++) visit(n, 1, []);
  const index = new Map(states.map((v, i) => [v.join(""), i]));
  const children = states
    .slice(0, 210)
    .map((v) =>
      [1, 2, 3, 4, 5, 6].map((face) => index.get([...v, face].sort().join(""))),
    );
  const holds = states.slice(210).map((v) => {
    const found = new Set();
    for (let mask = 0; mask < 32; mask++)
      found.add(index.get(v.filter((_, i) => mask & (1 << i)).join("")));
    return [...found];
  });
  const points = states
    .slice(210)
    .map((v) => categories.map((c) => score(v, c)));
  const f = [1, 1, 2, 6, 24, 120];
  const probabilities = states
    .slice(210)
    .map(
      (v) =>
        120 /
        [1, 2, 3, 4, 5, 6].reduce(
          (a, n) => a * f[v.filter((x) => x === n).length],
          1,
        ) /
        7776,
    );
  const kernel = { states, children, holds, points, probabilities };
  await mkdir("training/dp", { recursive: true });
  await mkdir("public/ai", { recursive: true });
  await writeFile("src/dp-kernel.json", JSON.stringify(kernel));
  const offsets = [0],
    flat = [];
  for (const h of holds) {
    flat.push(...h);
    offsets.push(flat.length);
  }
  const array = (type, name, data) =>
    `static const ${type} ${name}${Array.isArray(data[0]) ? `[${data.length}][${data[0].length}]` : `[${data.length}]`} = ${JSON.stringify(data).replaceAll("[", "{").replaceAll("]", "}")};\n`;
  await writeFile(
    "training/dp/kernel.h",
    array("unsigned short", "children", children) +
      array("unsigned short", "holdOffsets", offsets) +
      array("unsigned short", "held", flat) +
      array("unsigned char", "points", points) +
      array("double", "probabilities", probabilities),
  );
  console.log({
    multisets: states.length,
    fullStates: 252,
    holdEdges: flat.length,
    chanceEdges: children.length * 6,
  });
} finally {
  await server.close();
}
