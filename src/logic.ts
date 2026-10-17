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
}

/** True if the message should not be translated/forwarded. */
export function shouldSkip(msg: IncomingMessage, cfg: Config): boolean {
  if (!cfg.enabled) return true;
  if (msg.authorIsBot) return true;
  if (!cfg.sourceChannel || msg.channelId !== cfg.sourceChannel) return true;
  if (!cfg.destChannel) return true; // nowhere to post → don't enqueue
  if (msg.content.trim().length === 0) return true;
  return false;
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

/** Strip common LLM preambles/quoting that slip past the "return only" instruction. */
export function stripPreamble(text: string): string {
  let out = text.trim().replace(PREAMBLE_RE, '').trim();
  // Only unwrap a *pure* wrapping quote pair. Inner quotes ⇒ real dialogue, leave it.
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"') && !out.slice(1, -1).includes('"')) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

const RESERVED = /discord|clyde/gi;

/** Coerce a display name into a Discord-legal webhook username, or fall back. */
export function sanitizeUsername(name: string, fallback: string): string {
  const cleaned = name.replace(RESERVED, '').trim().slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback.replace(RESERVED, '').trim().slice(0, 80) || 'user';
}
