import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const bytes = await readFile("public/ai/dp-values.f64");
const compressed = gzipSync(bytes, { level: 9 });
const raw = await readFile("training/dp/preprocessing.json");
const report = JSON.parse(
  raw[0] === 255 && raw[1] === 254
    ? raw.subarray(2).toString("utf16le")
    : raw.toString("utf8").replace(/^\uFEFF/, ""),
);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = {
  ...report,
  format: 1,
  ruleSet: "YachtLab-12",
  objective: "expected final total under independent fair dice",
  precision: "IEEE754 Float64 LE",
  remainingMasks: 4096,
  upperStates: 64,
  diceMultisets: 252,
  partialMultisets: 462,
  sha256,
  asset: `dp-values-${sha256.slice(0, 12)}.f64.gz`,
  gzipBytes: compressed.length,
};
await writeFile(`public/ai/${metadata.asset}`, compressed);
await writeFile("src/dp-manifest.json", JSON.stringify(metadata, null, 2));
await writeFile(
  "public/ai/dp-metadata.json",
  JSON.stringify(metadata, null, 2),
);
await writeFile(
  "training/dp/preprocessing.json",
  JSON.stringify(metadata, null, 2),
);
console.log(metadata);
