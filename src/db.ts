import Database from 'better-sqlite3';
import type { Config } from './logic.ts';

const DEFAULTS: Config = {
  sourceChannel: null,
  destChannel: null,
  model: 'gpt-6-luna',
  enabled: true,
};

export interface ConfigStore {
  get(): Config;
  set<K extends keyof Config>(key: K, value: Config[K]): void;
  isOptedOut(userId: string): boolean;
  setOptedOut(userId: string, optedOut: boolean): void;
  close(): void;
}

// ponytail: key/value table over a typed Config — expandable without migrations.
export function openConfigStore(path: string): ConfigStore {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS optouts (user_id TEXT PRIMARY KEY)');

  const readAll = db.prepare('SELECT key, value FROM config');
  const upsert = db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  // Load once into memory; reads hit the object, writes update both.
  const current: Config = { ...DEFAULTS };
  for (const { key, value } of readAll.all() as { key: string; value: string }[]) {
    if (!(key in current)) continue;
    try {
      (current as unknown as Record<string, unknown>)[key] = JSON.parse(value);
    } catch {
      console.error(`config: ignoring malformed row "${key}", using default`);
    }
  }

  const optedOut = new Set((db.prepare('SELECT user_id FROM optouts').all() as { user_id: string }[]).map((r) => r.user_id));
  const addOptOut = db.prepare('INSERT OR IGNORE INTO optouts (user_id) VALUES (?)');
  const removeOptOut = db.prepare('DELETE FROM optouts WHERE user_id = ?');

  return {
    get: () => ({ ...current }),
    set(key, value) {
      upsert.run(key, JSON.stringify(value));
      (current as unknown as Record<string, unknown>)[key] = value;
    },
    isOptedOut: (userId) => optedOut.has(userId),
    setOptedOut(userId, out) {
      if (out) {
        addOptOut.run(userId);
        optedOut.add(userId);
      } else {
        removeOptOut.run(userId);
        optedOut.delete(userId);
      }
    },
    close: () => db.close(),
  };
}
