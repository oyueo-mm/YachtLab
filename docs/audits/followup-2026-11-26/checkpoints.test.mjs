import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { aggregate, checkpoint, openExperiment } from './checkpoints.mjs';

test('identity, interruption, idempotent replay, integrity and overlapping ranges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yacht-exp-'));
  try {
    const runner = join(dir, 'runner.mjs');
    const model = join(dir, 'model');
    await writeFile(runner, 'runner-v1');
    await writeFile(model, 'model-v1');
    const spec = { rules: 'YachtLab-12', commit: '1'.repeat(40), runner,
      competitors: ['dp', 'greedy'], seedPlan: { algorithm: 'previous-seed-grid-v1', family: 9099, shard: 997, pairs: 4 },
      inputs: { model }, runtime: 'node-v24', options: { a: 1, b: true } };
    const base = await openExperiment(dir, spec);
    assert.equal((await openExperiment(dir, { ...spec, options: { b: true, a: 1 } })).key, base.key);
    assert.notEqual((await openExperiment(dir, { ...spec, seedPlan: { ...spec.seedPlan, pairs: 5 } })).key, base.key);
    await checkpoint(base, 0, [0, .75]);
    assert.deepEqual(await aggregate(base), { pairs: 2, sum: .75, sumSquares: .5625, missing: [{ start: 2, end: 4 }], complete: false });
    const resumed = await openExperiment(dir, spec);
    await Promise.all([checkpoint(resumed, 2, [1, .25]), checkpoint(resumed, 2, [1, .25])]);
    await assert.rejects(checkpoint(resumed, 2, [.5, .75]), /already occupies/);
    const complete = await aggregate(resumed);
    assert.deepEqual(complete, { pairs: 4, sum: 2, sumSquares: 1.625, missing: [], complete: true });
    await checkpoint(resumed, 1, [.5]);
    await assert.rejects(aggregate(resumed), /overlapping/);
    await rm(join(resumed.folder, '1.checkpoint.json'));
    const blockFile = join(resumed.folder, '2.checkpoint.json');
    await writeFile(blockFile, JSON.stringify({ block: { start: 2, experiment: resumed.key, credits: [.5, .25] }, digest: 'a'.repeat(64) }));
    await assert.rejects(aggregate(resumed), /checksum/);
    await writeFile(model, 'model-v2');
    assert.notEqual((await openExperiment(dir, spec)).key, base.key);
  } finally { await rm(dir, { force: true, recursive: true }); }
});
