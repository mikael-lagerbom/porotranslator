export interface Config {
  sourceChannel: string | null;
  destChannel: string | null;
  model: string;
  enabled: boolean;
}

export interface IncomingMessage {
  authorIsBot: boolean;
  channelId: string;
  content: string;
  hasAttachments: boolean;
}

export interface Route {
  to: string;
  translate: boolean;
}

/**
 * Where a message goes: source → dest translated, dest → source forwarded as-is.
 * null = ignore. Bot/webhook authors are skipped, which also stops the two directions looping.
 */
export function route(msg: IncomingMessage, cfg: Config): Route | null {
  if (!cfg.enabled || msg.authorIsBot) return null;
  if (!cfg.sourceChannel || !cfg.destChannel) return null; // both needed for either direction
  if (msg.content.trim().length === 0 && !msg.hasAttachments) return null;
  if (msg.channelId === cfg.sourceChannel) return { to: cfg.destChannel, translate: true };
  if (msg.channelId === cfg.destChannel) return { to: cfg.sourceChannel, translate: false };
  return null;
}

/** Split text into chunks no longer than `limit`, preferring newline, then space boundaries. */
export function splitMessage(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) {
      cut = limit; // no boundary in range → hard split
      if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--; // don't cut a surrogate pair (emoji) in half
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(/[\n ]/.test(rest[cut]) ? cut + 1 : cut);
  }
  chunks.push(rest);
  return chunks.filter((c) => c.trim().length > 0); // Discord rejects blank messages
}

const NON_TEXT_RE = /<a?:\w+:\d+>|<(@[!&]?|#|\/[\w -]+:)\d+>|<t:\d+(:\w)?>|https?:\/\/\S+/g;

/** True if anything is left to translate once mentions, emoji, timestamps and URLs are removed. */
export function hasTranslatableText(text: string): boolean {
  return /\p{L}{2,}/u.test(text.replace(NON_TEXT_RE, ''));
}

const PREAMBLE_RE = /^\s*(here is (the )?translation|translation|translated text)\s*:\s*/i;

/**
 * Strip common LLM preambles/quoting that slip past the "return only" instruction.
 * `source` is the original message: a label or quotes the user wrote themselves are kept.
 */
export function stripPreamble(text: string, source = ''): string {
  let out = text.trim();
  if (!/^\s*(käännös|translation|translated text)\s*:/i.test(source)) out = out.replace(PREAMBLE_RE, '').trim();
  // Only unwrap a *pure* wrapping quote pair. Inner quotes ⇒ real dialogue, leave it.
  if (!source.trim().startsWith('"') && out.length >= 2 && out.startsWith('"') && out.endsWith('"') && !out.slice(1, -1).includes('"')) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

const RESERVED = /discord|clyde/gi;

/** Coerce a display name into a Discord-legal webhook username. */
export function sanitizeUsername(name: string): string {
  // Repeat: removing one reserved word can join others into a new one ("disDISCORDcord").
  let cleaned = name;
  for (let prev = ''; prev !== cleaned; ) [prev, cleaned] = [cleaned, cleaned.replace(RESERVED, '')];
  cleaned = Array.from(cleaned.trim()).slice(0, 80).join('').trim(); // by code point: don't split an emoji
  return cleaned.length > 0 ? cleaned : 'porotranslator';
}

/** Fixed-window limiter: true while `key` has made fewer than `max` calls in the current `windowMs`. */
// ponytail: fixed window allows up to 2× max across a boundary, and one Map entry per user is never pruned —
// fine as a cost guard for one community; switch to a sliding window if the limit must be exact.
export function createRateLimiter(max: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()): boolean => {
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    return ++w.count <= max;
  };
}
