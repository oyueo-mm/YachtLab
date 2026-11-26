// Standalone prototype for future, independently named experiments.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const digest = data => createHash('sha256').update(data).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const encode = value => JSON.stringify(canonical(value));
const isDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hashFile = async file => digest(await readFile(file));

async function publish(file, body) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temp, 'wx');
    try { await handle.writeFile(body); await handle.sync(); }
    finally { await handle.close(); }
    try { await link(temp, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.equal(await readFile(file, 'utf8'), body, 'a different result already occupies this range');
    }
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function openExperiment(root, { rules, commit, runner, competitors, seedPlan, inputs, runtime, options }) {
  assert(typeof rules === 'string' && rules.length > 0);
  assert(typeof runtime === 'string' && runtime.length > 0);
  assert(typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit));
  assert(Array.isArray(competitors) && competitors.length === 2);
  assert(competitors.every(name => typeof name === 'string' && name.length > 0));
  assert(typeof seedPlan.algorithm === 'string' && seedPlan.algorithm.length > 0);
  assert(Number.isSafeInteger(seedPlan.family) && Number.isSafeInteger(seedPlan.shard));
  assert(Number.isSafeInteger(seedPlan.pairs) && seedPlan.pairs > 0);
  const hashes = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([name, file]) => [name, await hashFile(file)])));
  const spec = { schema: 1, rules, commit, runner: await hashFile(runner), competitors, seedPlan, inputs: hashes, runtime, options };
  const key = digest(encode(spec));
  const folder = join(root, key);
  await mkdir(folder, { recursive: true });
  await publish(join(folder, 'experiment.json'), encode({ key, spec }));
  return { key, folder, pairs: seedPlan.pairs };
}

function validate({ key, pairs }, block) {
  assert.equal(block.experiment, key);
  assert(Number.isSafeInteger(block.start) && block.start >= 0);
  assert(Array.isArray(block.credits) && block.credits.length > 0);
  assert(block.start + block.credits.length <= pairs);
  assert(block.credits.every(x => [0, .25, .5, .75, 1].includes(x)));
}

export async function checkpoint(experiment, start, credits) {
  const block = { experiment: experiment.key, start, credits };
  validate(experiment, block);
  const body = encode({ block, digest: digest(encode(block)) });
  await publish(join(experiment.folder, start + '.checkpoint.json'), body);
}

export async function aggregate(experiment) {
  const seen = new Set();
  let sum = 0;
  let sumSquares = 0;
  for (const filename of await readdir(experiment.folder)) {
    if (!/^\d+\.checkpoint\.json$/.test(filename)) continue;
    const { block, digest: checksum } = JSON.parse(await readFile(join(experiment.folder, filename), 'utf8'));
    validate(experiment, block);
    assert(isDigest(checksum) && checksum === digest(encode(block)), 'checkpoint checksum mismatch');
    assert.equal(filename, block.start + '.checkpoint.json');
    block.credits.forEach((credit, index) => {
      const pair = block.start + index;
      assert(!seen.has(pair), 'overlapping pair ranges');
      seen.add(pair);
      sum += credit;
      sumSquares += credit * credit;
    });
  }
  const missing = [];
  for (let index = 0; index < experiment.pairs; index++) {
    if (seen.has(index)) continue;
    const previous = missing.at(-1);
    if (previous?.end === index) previous.end++;
    else missing.push({ start: index, end: index + 1 });
  }
  return { pairs: seen.size, sum, sumSquares, missing, complete: seen.size === experiment.pairs };
}
