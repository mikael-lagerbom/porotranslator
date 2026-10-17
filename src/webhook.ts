import {
  DiscordAPIError,
  GuildPremiumTier,
  RESTJSONErrorCodes,
  type TextChannel,
  type Webhook,
  WebhookClient,
  type WebhookMessageCreateOptions,
} from 'discord.js';
import { splitMessage } from './logic.ts';

const WEBHOOK_NAME = 'porotranslator';
// Promise per channel: concurrent callers (one queue per direction) share one find-or-create.
const cache = new Map<string, Promise<WebhookClient>>();

/**
 * Find-or-create the bot's webhook in a channel, cached per channel id. Pass the promise that
 * just failed as `stale` to replace it — unless another caller already did.
 */
function getWebhook(channel: TextChannel, stale?: Promise<WebhookClient>): Promise<WebhookClient> {
  const cached = cache.get(channel.id);
  if (cached && cached !== stale) return cached;
  const fresh = (async () => {
    const hooks = await channel.fetchWebhooks();
    let hook: Webhook | undefined = hooks.find((h) => h.owner?.id === channel.client.user.id && h.token != null);
    if (!hook) hook = await channel.createWebhook({ name: WEBHOOK_NAME });
    return new WebhookClient({ id: hook.id, token: hook.token! });
  })();
  cache.set(channel.id, fresh);
  fresh.catch(() => cache.get(channel.id) === fresh && cache.delete(channel.id)); // don't cache a failure
  return fresh;
}

export interface Attachment {
  url: string;
  name: string;
  description: string | null;
  spoiler: boolean;
  size: number;
}

const MB = 1024 * 1024;
// ponytail: hardcoded per-tier upload limits; update if Discord changes them.
const UPLOAD_LIMIT: Record<GuildPremiumTier, number> = {
  [GuildPremiumTier.None]: 10 * MB,
  [GuildPremiumTier.Tier1]: 10 * MB,
  [GuildPremiumTier.Tier2]: 50 * MB,
  [GuildPremiumTier.Tier3]: 100 * MB,
};

/**
 * Post `content` and re-uploaded `files` to `channel` impersonating the author, splitting text if
 * needed (files go on the last chunk). Files over the server's upload limit are posted as links
 * (expire after ~24h) instead of being downloaded. Throws on other send failures, so the caller
 * can surface the drop.
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
  const limit = UPLOAD_LIMIT[channel.guild.premiumTier];
  const tooBig = files.filter((f) => f.size > limit);
  const uploadable = files.filter((f) => f.size <= limit);

  const chunks = splitMessage([content, ...tooBig.map(link)].filter(Boolean).join('\n'), 2000);
  if (chunks.length === 0) chunks.push(''); // attachment-only message
  for (const [n, chunk] of chunks.entries()) {
    const uploads = n === chunks.length - 1 ? uploadable.map(toUpload) : [];
    try {
      await send(channel, { ...base, content: chunk || undefined, files: uploads });
    } catch (err) {
      if (!uploads.length || !isTooLarge(err)) throw err; // e.g. combined size over the limit
      for (const c of splitMessage([chunk, ...uploadable.map(link)].filter(Boolean).join('\n'), 2000)) {
        await send(channel, { ...base, content: c });
      }
    }
  }
}

/**
 * If the cached webhook is gone (deleted/token reset), replace it and retry once. Other errors
 * aren't retried (discord.js already retries 5xx; a blind retry could double-post).
 */
async function send(channel: TextChannel, payload: WebhookMessageCreateOptions): Promise<void> {
  const hook = getWebhook(channel);
  try {
    await (await hook).send(payload);
  } catch (err) {
    if (!isGoneWebhook(err)) throw err;
    await (await getWebhook(channel, hook)).send(payload); // throws if it fails again
  }
}

// Uploads are still marked as spoilers by a SPOILER_ filename prefix.
const toUpload = (f: Attachment) => ({
  attachment: f.url,
  name: `${f.spoiler ? 'SPOILER_' : ''}${f.name.replace(/^SPOILER_/, '')}`,
  description: f.description ?? undefined,
});

const link = (f: Attachment) => (f.spoiler ? `||${f.url}||` : f.url);

const isGoneWebhook = (err: unknown) =>
  err instanceof DiscordAPIError &&
  (err.code === RESTJSONErrorCodes.UnknownWebhook || err.code === RESTJSONErrorCodes.InvalidWebhookToken);

const isTooLarge = (err: unknown) =>
  (err as { status?: number }).status === 413 ||
  (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.RequestEntityTooLarge);
