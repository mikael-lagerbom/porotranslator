import { Client, GatewayIntentBits, type TextChannel, Events, MessageType, PermissionFlagsBits } from 'discord.js';
import OpenAI from 'openai';
import { openConfigStore } from './db.ts';
import { route, sanitizeUsername, hasTranslatableText, createRateLimiter } from './logic.ts';
import { SerialQueue } from './queue.ts';
import { translate } from './translate.ts';
import { sendAsAuthor } from './webhook.ts';
import { commandDefs, handleCommand } from './commands.ts';

const { DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID, DB_PATH = './data/config.db' } = process.env;
if (!DISCORD_TOKEN || !OPENAI_API_KEY || !GUILD_ID) {
  console.error('Missing required env: DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID');
  process.exit(1);
}

// Cost guards: past these, messages are still forwarded, just untranslated.
const MAX_PER_USER = 30; // translations per user per minute
const MAX_BACKLOG = 50; // per queue: translations past this go out untranslated, forwards are dropped

const store = openConfigStore(DB_PATH);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
// One queue per direction: each direction keeps its order and forwards never wait behind a slow translation.
// Trade-off: across directions, a forward can overtake an earlier translation still in flight.
const queues = { translate: new SerialQueue(), forward: new SerialQueue() };
const pending = () => queues.translate.pending + queues.forward.pending;
const allowUser = createRateLimiter(MAX_PER_USER, 60_000);
let stopping = false;

// Message only: discord.js errors can carry request URLs, which embed webhook tokens.
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on(Events.Error, (err) => console.error(`discord client error: ${errText(err)}`));

client.once(Events.ClientReady, async (c) => {
  try {
    await c.application.commands.set(commandDefs, GUILD_ID);
    console.log(`Ready as ${c.user.tag}. Registered ${commandDefs.length} commands to guild ${GUILD_ID}.`);
  } catch (err) {
    console.error(`Ready as ${c.user.tag}, but command registration failed (check GUILD_ID and applications.commands scope): ${errText(err)}`);
  }
  // Both channels receive webhook posts; warn now rather than DROPPED on every message.
  const { sourceChannel, destChannel } = store.get();
  for (const id of [sourceChannel, destChannel]) {
    if (!id) continue;
    const ch = c.channels.cache.get(id);
    const ok = ch && !ch.isDMBased() && ch.permissionsFor(c.user)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageWebhooks]);
    if (!ok) console.warn(`missing View Channel / Manage Webhooks in channel ${id}: messages posted there will be dropped`);
  }
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    await handleCommand(i, store);
  } catch (err) {
    console.error(`command ${i.commandName} failed: ${errText(err)}`);
  }
});

client.on(Events.MessageCreate, (msg) => {
  if (msg.type !== MessageType.Default && msg.type !== MessageType.Reply) return; // system messages (thread created, pins, …)
  const files = msg.attachments.map((a) => ({ url: a.url, name: a.name, description: a.description }));
  const incoming = { authorIsBot: msg.author.bot, channelId: msg.channelId, content: msg.content, hasAttachments: files.length > 0 };
  // Cheap filter at enqueue time; config is re-read at run time inside the task.
  const initial = route(incoming, store.get());
  if (!initial || store.isOptedOut(msg.author.id)) return;

  // Decided at arrival so a spammer can't burn through the limit while queued. Only API-bound messages count.
  const translatable = initial.translate && hasTranslatableText(msg.content);
  const throttled = translatable && (!allowUser(msg.author.id) || queues.translate.pending >= MAX_BACKLOG);

  if (!initial.translate && queues.forward.pending >= MAX_BACKLOG) {
    console.warn(`forward backlog full: dropping message ${msg.id}`); // flood/raid in the dest channel
    return;
  }

  queues[initial.translate ? 'translate' : 'forward'].push(async () => {
    const cfg = store.get(); // fresh: honor /toggle, /set-model, /set-dest made while queued
    // Re-checked: config or the author's opt-out may have changed while queued.
    const r = route(incoming, cfg);
    // Direction flipped (channels swapped while queued): drop rather than post with stale queue/throttle decisions.
    if (!r || r.translate !== initial.translate || store.isOptedOut(msg.author.id)) return;

    const target = await client.channels.fetch(r.to).catch(() => null);
    if (!target?.isTextBased() || target.isDMBased()) {
      console.error(`channel ${r.to} not a usable text channel; dropping message ${msg.id}`);
      return;
    }

    let text = msg.content; // forward direction, or only mentions/emoji/URLs → as-is, no API call
    if (r.translate && translatable) {
      if (throttled || stopping) {
        console.warn(`${stopping ? 'shutting down' : 'rate limit/backlog'}: forwarding message ${msg.id} untranslated`);
        text = `⚠️ ${msg.content}`;
      } else {
        try {
          text = await translate(openai, cfg.model, msg.content);
        } catch (err) {
          console.error(`translation failed for message ${msg.id} (model ${cfg.model}), forwarding original: ${errText(err)}`);
          text = `⚠️ ${msg.content}`;
        }
      }
    }

    const username = sanitizeUsername(msg.member?.displayName ?? msg.author.username);
    try {
      await sendAsAuthor(target as TextChannel, { username, avatarURL: msg.author.displayAvatarURL() }, text, files);
    } catch (err) {
      console.error(`DROPPED message ${msg.id} from ${username}: send failed: ${errText(err)}`);
    }
  }).catch((err) => console.error(`DROPPED message ${msg.id}: ${errText(err)}`));
});

// Stop intake and flush the queues untranslated (fast), bounded by DRAIN_DEADLINE_MS < compose stop_grace_period.
const DRAIN_DEADLINE_MS = 40_000;
async function shutdown(signal: string) {
  if (stopping) process.exit(1); // second signal: give up on draining
  stopping = true;
  console.log(`${signal}: draining ${pending()} queued message(s)`);
  client.removeAllListeners(Events.MessageCreate);
  setTimeout(() => {
    console.error(`drain deadline hit, ${pending()} message(s) lost`);
    process.exit(1);
  }, DRAIN_DEADLINE_MS).unref();
  await Promise.all([queues.translate.drain(), queues.forward.drain()]);
  try {
    await client.destroy();
  } finally {
    store.close();
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

client.login(DISCORD_TOKEN);
