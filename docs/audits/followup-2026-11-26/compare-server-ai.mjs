// Run with node --import tsx; first argument is a clean original checkout.
import assert from 'node:assert/strict';
import { threadCpuUsage } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serverAiMove as candidate } from '../../../src/online/server-ai.ts';
import { categories } from '../../../src/engine.ts';

const oldRoot = resolve(process.argv[2]);
const { serverAiMove: baseline } = await import(pathToFileURL(resolve(oldRoot, 'src/online/server-ai.ts')));
let seed = 71458;
const random = max => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % max;
const sample = Array.from({ length: 300 }, (_, index) => {
  const dice = Array.from({ length: 5 }, () => 1 + random(6));
  const card = Object.fromEntries(categories.filter(() => random(23) < 9).map(category => [category, 0]));
  delete card.choice;
  return [dice, 1 + index % 3, card];
});
const worst = [1, 2, 3, 4, 5];
for (const roll of [1, 2, 3]) sample.push([worst, roll, {}], [[6, 6, 6, 6, 6], roll, {}]);
for (const input of sample) assert.deepEqual(candidate(...input), baseline(...input), JSON.stringify(input));
const results = [];
for (let run = 1; run <= 3; run++) {
  const order = run % 2 ? { baseline, candidate } : { candidate, baseline };
  for (const [name, decide] of Object.entries(order)) {
    const times = sample.map(input => {
      const start = threadCpuUsage();
      decide(...input);
      const { user, system } = threadCpuUsage(start);
      return (user + system) / 1000;
    }).sort((a, b) => a - b);
    results.push({
      name, run, n: times.length, mean: times.reduce((sum, time) => sum + time, 0) / times.length,
      p50: times[Math.floor(times.length * .5)], p99: times[Math.floor(times.length * .99)], max: times.at(-1),
    });
  }
}
console.log(JSON.stringify({ node: process.version, parityCases: sample.length, warmedThreadCpuMs: results }, null, 2));
