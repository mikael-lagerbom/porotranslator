import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  type TextChannel,
  type Webhook,
  WebhookClient,
  type WebhookMessageCreateOptions,
} from 'discord.js';
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
  let hook: Webhook | undefined = hooks.find((h) => h.owner?.id === channel.client.user.id && h.token != null);
  if (!hook) hook = await channel.createWebhook({ name: WEBHOOK_NAME });

  const client = new WebhookClient({ id: hook.id, token: hook.token! });
  cache.set(channel.id, client);
  return client;
}

export interface Attachment {
  url: string;
  name: string; // keeps a SPOILER_ prefix, so spoilered files stay spoilered
  description: string | null;
}

/**
 * Post `content` and re-uploaded `files` to `channel` impersonating the author, splitting text if
 * needed (files go on the last chunk). Files over the server's upload limit fall back to links,
 * which expire after ~24h. Throws on any other send failure, so the caller can surface the drop.
 */
export async function sendAsAuthor(
  channel: TextChannel,
  author: { username: string; avatarURL: string | null },
  content: string,
  files: Attachment[] = [],
): Promise<void> {
  const base = {
    username: author.username,
    avatarURL: author.avatarURL ?? undefined,
    allowedMentions: { parse: [] as const }, // don't ping people on translated copies
  };
  const chunks = splitMessage(content, 2000);
  if (chunks.length === 0) chunks.push(''); // attachment-only message
  for (const [n, chunk] of chunks.entries()) {
    const last = n === chunks.length - 1;
    const uploads = last ? files.map((f) => ({ attachment: f.url, name: f.name, description: f.description ?? undefined })) : [];
    try {
      await send(channel, { ...base, content: chunk || undefined, files: uploads });
    } catch (err) {
      if (!uploads.length || !isTooLarge(err)) throw err;
      const withLinks = [chunk, ...files.map((f) => f.url)].filter(Boolean).join('\n');
      for (const c of splitMessage(withLinks, 2000)) await send(channel, { ...base, content: c });
    }
  }
}

/**
 * If the cached webhook is gone (deleted/token reset), evict it and retry once with a freshly
 * fetched/created one. Other errors aren't retried (discord.js already retries 5xx; a blind retry
 * could double-post).
 */
async function send(channel: TextChannel, payload: WebhookMessageCreateOptions): Promise<void> {
  try {
    await (await getWebhook(channel)).send(payload);
  } catch (err) {
    if (!isGoneWebhook(err)) throw err;
    cache.delete(channel.id);
    await (await getWebhook(channel, true)).send(payload); // throws if it fails again
  }
}

const isGoneWebhook = (err: unknown) =>
  err instanceof DiscordAPIError &&
  (err.code === RESTJSONErrorCodes.UnknownWebhook || err.code === RESTJSONErrorCodes.InvalidWebhookToken);

const isTooLarge = (err: unknown) =>
  (err as { status?: number }).status === 413 ||
  (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.RequestEntityTooLarge);
