import OpenAI from 'openai';
import { stripPreamble } from './logic.ts';

const SYSTEM_PROMPT =
  'You translate Finnish to English. If the text is already English, return it unchanged. ' +
  'The text is chat from a Finnish community for Riftbound, the League of Legends trading card game. ' +
  'Keep card names, champion names, game keywords and TCG jargon in their English form; do not translate them literally. ' +
  'Preserve untouched: Discord mentions (<@...>, <#...>), custom emoji (<:name:id>), URLs, and markdown. ' +
  'Return ONLY the resulting text — no quotes, no notes, no preamble.';

const TIMEOUT_MS = 30_000;

/** Translate text via OpenAI. Throws on failure (caller forwards original + ⚠️). */
export async function translate(client: OpenAI, model: string, text: string): Promise<string> {
  const res = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    },
    { timeout: TIMEOUT_MS },
  );
  const out = stripPreamble(res.choices[0]?.message?.content ?? '');
  if (!out) throw new Error('empty translation');
  return out;
}
