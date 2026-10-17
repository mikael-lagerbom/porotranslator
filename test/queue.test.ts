import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../src/queue.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('runs tasks one at a time in submission order', async () => {
  const q = new SerialQueue();
  const order: number[] = [];
  // First task is slow; if it ran in parallel, 2 would finish before 1.
  q.push(async () => { await tick(30); order.push(1); });
  q.push(async () => { await tick(1); order.push(2); });
  await q.push(async () => { order.push(3); });
  assert.deepEqual(order, [1, 2, 3]);
});

test('a failing task does not halt the queue', async () => {
  const q = new SerialQueue();
  const order: number[] = [];
  q.push(async () => { throw new Error('boom'); }).catch(() => {});
  await q.push(async () => { order.push(2); });
  assert.deepEqual(order, [2]);
});

test('tracks pending tasks and drains', async () => {
  const q = new SerialQueue();
  q.push(() => tick(10));
  q.push(() => tick(10));
  assert.equal(q.pending, 2);
  await q.drain();
  assert.equal(q.pending, 0);
});
