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
  /** Test-only: write a raw (possibly non-JSON) value to exercise corrupt rows. */
  setRaw(key: string, value: string): void;
}

// ponytail: key/value table over a typed Config — expandable without migrations.
export function openConfigStore(path: string): ConfigStore {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)');

  const readAll = db.prepare('SELECT key, value FROM config');
  const upsert = db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  // Load once into memory; reads hit the object, writes update both.
  const load = (): Config => {
    const cfg: Config = { ...DEFAULTS };
    for (const { key, value } of readAll.all() as { key: string; value: string }[]) {
      if (!(key in cfg)) continue;
      try {
        (cfg as unknown as Record<string, unknown>)[key] = JSON.parse(value);
      } catch {
        console.error(`config: ignoring malformed row "${key}", using default`);
      }
    }
    return cfg;
  };

  let current = load();

  return {
    get: () => ({ ...current }),
    set(key, value) {
      upsert.run(key, JSON.stringify(value));
      (current as unknown as Record<string, unknown>)[key] = value;
    },
    setRaw(key, value) {
      upsert.run(key, value);
      current = load();
    },
  };
}
