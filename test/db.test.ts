import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openConfigStore } from '../src/db.ts';

test('returns defaults on a fresh store', () => {
  const store = openConfigStore(':memory:');
  assert.deepEqual(store.get(), {
    sourceChannel: null,
    destChannel: null,
    model: 'gpt-4.1-nano',
    enabled: true,
  });
});

test('persists a set value', () => {
  const store = openConfigStore(':memory:');
  store.set('sourceChannel', '123');
  assert.equal(store.get().sourceChannel, '123');
});

test('overwrites an existing value', () => {
  const store = openConfigStore(':memory:');
  store.set('model', 'gpt-5.4-mini');
  store.set('model', 'gpt-4.1-nano');
  assert.equal(store.get().model, 'gpt-4.1-nano');
});

test('coerces the enabled flag to a boolean', () => {
  const store = openConfigStore(':memory:');
  store.set('enabled', false);
  assert.equal(store.get().enabled, false);
  store.set('enabled', true);
  assert.equal(store.get().enabled, true);
});

test('ignores a malformed row instead of throwing', () => {
  const store = openConfigStore(':memory:');
  store.set('sourceChannel', '123');
  store.setRaw('model', 'not-json'); // simulate a corrupt/hand-edited row
  const cfg = store.get(); // must not throw
  assert.equal(cfg.model, 'gpt-4.1-nano'); // bad row falls back to default
  assert.equal(cfg.sourceChannel, '123'); // good rows still load
});
