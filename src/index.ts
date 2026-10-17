import { Client, GatewayIntentBits, type TextChannel, Events, MessageType } from 'discord.js';
import OpenAI from 'openai';
import { openConfigStore } from './db.ts';
import { shouldSkip, sanitizeUsername, hasTranslatableText, createRateLimiter } from './logic.ts';
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
const MAX_PER_USER = 10; // translations per user per minute
const MAX_BACKLOG = 50; // queued messages before translation is skipped to catch up

const store = openConfigStore(DB_PATH);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const queue = new SerialQueue();
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
  // Cheap filter at enqueue time; config is re-read at run time inside the task.
  if (shouldSkip({ authorIsBot: msg.author.bot, channelId: msg.channelId, content: msg.content }, store.get())) return;

  // Decided at arrival so a spammer can't burn through the limit while queued. Only API-bound messages count.
  const translatable = hasTranslatableText(msg.content);
  const throttled = translatable && (!allowUser(msg.author.id) || queue.pending >= MAX_BACKLOG);

  // Serial queue → dest order matches source order.
  queue.push(async () => {
    const cfg = store.get(); // fresh: honor /toggle, /set-model, /set-dest made while queued
    if (shouldSkip({ authorIsBot: msg.author.bot, channelId: msg.channelId, content: msg.content }, cfg)) return;

    const dest = await client.channels.fetch(cfg.destChannel!).catch(() => null);
    if (!dest?.isTextBased() || dest.isDMBased()) {
      console.error(`dest channel ${cfg.destChannel} not a usable text channel; dropping message ${msg.id}`);
      return;
    }

    let text = msg.content; // only mentions/emoji/URLs → forward as-is, no API call
    if (translatable && (throttled || stopping)) {
      console.warn(`${stopping ? 'shutting down' : 'rate limit/backlog'}: forwarding message ${msg.id} untranslated`);
      text = `⚠️ ${msg.content}`;
    } else if (translatable) {
      try {
        text = await translate(openai, cfg.model, msg.content);
      } catch (err) {
        console.error(`translation failed for message ${msg.id} (model ${cfg.model}), forwarding original: ${errText(err)}`);
        text = `⚠️ ${msg.content}`;
      }
    }

    const username = sanitizeUsername(msg.member?.displayName ?? msg.author.username);
    try {
      await sendAsAuthor(dest as TextChannel, { username, avatarURL: msg.author.displayAvatarURL() }, text);
    } catch (err) {
      console.error(`DROPPED message ${msg.id} from ${username}: send failed: ${errText(err)}`);
    }
  }).catch((err) => console.error(`DROPPED message ${msg.id}: ${errText(err)}`));
});

// Stop intake and flush the queue untranslated (fast), bounded by DRAIN_DEADLINE_MS < compose stop_grace_period.
const DRAIN_DEADLINE_MS = 40_000;
async function shutdown(signal: string) {
  if (stopping) process.exit(1); // second signal: give up on draining
  stopping = true;
  console.log(`${signal}: draining ${queue.pending} queued message(s)`);
  client.removeAllListeners(Events.MessageCreate);
  setTimeout(() => {
    console.error(`drain deadline hit, ${queue.pending} message(s) lost`);
    process.exit(1);
  }, DRAIN_DEADLINE_MS).unref();
  await queue.drain();
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
