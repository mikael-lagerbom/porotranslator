import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openConfigStore } from '../src/db.ts';

const tmpDb = () => join(mkdtempSync(join(tmpdir(), 'poro-')), 'config.db');

test('returns defaults on a fresh store', () => {
  const store = openConfigStore(':memory:');
  assert.deepEqual(store.get(), {
    sourceChannel: null,
    destChannel: null,
    model: 'gpt-6-luna',
    enabled: true,
  });
});

test('persists values across a reopen', () => {
  const path = tmpDb();
  const store = openConfigStore(path);
  store.set('sourceChannel', '123');
  store.set('model', 'gpt-6-luna');
  store.set('model', 'gpt-6.1-sol'); // overwrite
  store.set('enabled', false);
  store.close();

  const cfg = openConfigStore(path).get();
  assert.equal(cfg.sourceChannel, '123');
  assert.equal(cfg.model, 'gpt-6.1-sol');
  assert.equal(cfg.enabled, false);
});

test('ignores a malformed row instead of throwing', () => {
  const path = tmpDb();
  openConfigStore(path).set('sourceChannel', '123');
  const raw = new Database(path);
  raw.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('model', 'not-json')").run(); // corrupt/hand-edited row
  raw.close();

  const cfg = openConfigStore(path).get(); // must not throw
  assert.equal(cfg.model, 'gpt-6-luna'); // bad row falls back to default
  assert.equal(cfg.sourceChannel, '123'); // good rows still load
});

test('persists opt-outs across a reopen and can undo them', () => {
  const path = tmpDb();
  const store = openConfigStore(path);
  store.setOptedOut('u1', true);
  store.setOptedOut('u2', true);
  store.setOptedOut('u2', false);
  assert.equal(store.isOptedOut('u1'), true);
  store.close();

  const reopened = openConfigStore(path);
  assert.equal(reopened.isOptedOut('u1'), true);
  assert.equal(reopened.isOptedOut('u2'), false);
});
