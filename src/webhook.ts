import { type TextChannel, type Webhook, WebhookClient } from 'discord.js';
import { splitMessage } from './logic.ts';

const WEBHOOK_NAME = 'porotranslator';
const cache = new Map<string, WebhookClient>();

/** Find-or-create the bot's webhook in a channel, cached per channel id. */
async function getWebhook(channel: TextChannel, refresh = false): Promise<WebhookClient> {
  if (!refresh) {
    const cached = cache.get(channel.id);
    if (cached) return cached;
  }
  const hooks = await channel.fetchWebhooks();
  let hook: Webhook | undefined = hooks.find((h) => h.name === WEBHOOK_NAME && h.token != null);
  if (!hook) hook = await channel.createWebhook({ name: WEBHOOK_NAME });

  const client = new WebhookClient({ id: hook.id, token: hook.token! });
  cache.set(channel.id, client);
  return client;
}

/**
 * Post `content` to `channel` impersonating the author, splitting if needed.
 * On send failure (e.g. the cached webhook was deleted) the cache is evicted and
 * the send is retried once with a freshly fetched/created webhook. Still failing
 * ⇒ throws, so the caller can surface the drop instead of losing it silently.
 */
export async function sendAsAuthor(
  channel: TextChannel,
  author: { username: string; avatarURL: string | null },
  content: string,
): Promise<void> {
  const chunks = splitMessage(content, 2000);
  for (const chunk of chunks) {
    const payload = {
      content: chunk,
      username: author.username,
      avatarURL: author.avatarURL ?? undefined,
      allowedMentions: { parse: [] as const }, // don't ping people on translated copies
    };
    try {
      await (await getWebhook(channel)).send(payload);
    } catch {
      cache.delete(channel.id);
      await (await getWebhook(channel, true)).send(payload); // one retry; throws if it fails again
    }
  }
}
