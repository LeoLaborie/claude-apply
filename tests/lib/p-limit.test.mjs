import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pLimit } from '../../src/lib/p-limit.mjs';

test('pLimit — respects concurrency limit', async () => {
  const limit = pLimit(2);
  let active = 0;
  let maxActive = 0;

  const task = () =>
    limit(async () => {
      active++;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 50));
      active--;
    });

  await Promise.all([task(), task(), task(), task(), task()]);
  assert.equal(maxActive, 2);
});

test('pLimit — all promises resolve', async () => {
  const limit = pLimit(3);
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => n * 2)));
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('pLimit — rejection propagates without blocking queue', async () => {
  const limit = pLimit(2);
  const results = await Promise.allSettled([
    limit(async () => 'ok'),
    limit(async () => {
      throw new Error('boom');
    }),
    limit(async () => 'after-error'),
  ]);
  assert.equal(results[0].value, 'ok');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].value, 'after-error');
});

test('pLimit — concurrency 1 runs sequentially', async () => {
  const limit = pLimit(1);
  const order = [];
  await Promise.all([
    limit(async () => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
    }),
    limit(async () => {
      order.push('b-start');
      order.push('b-end');
    }),
  ]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('pLimit — throws on invalid concurrency', () => {
  assert.throws(() => pLimit(0), /positive integer/);
  assert.throws(() => pLimit(-1), /positive integer/);
  assert.throws(() => pLimit(NaN), /positive integer/);
});
