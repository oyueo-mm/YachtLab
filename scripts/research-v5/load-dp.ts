import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../../src/dp-manifest.json";
/** Load the deployed DP Expert Float64 table (same bytes as the browser asset). */
export function loadDPTable(): Float64Array {
  const z = gunzipSync(readFileSync(new URL("../../public/ai/" + manifest.asset, import.meta.url)));
  const buf = z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
  return new Float64Array(buf);
}
