import { Client, GatewayIntentBits, type TextChannel, Events, MessageType, REST, Routes } from 'discord.js';
import OpenAI from 'openai';
import { openConfigStore } from './db.ts';
import { shouldSkip, sanitizeUsername, hasTranslatableText } from './logic.ts';
import { SerialQueue } from './queue.ts';
import { translate } from './translate.ts';
import { sendAsAuthor } from './webhook.ts';
import { commandDefs, handleCommand } from './commands.ts';

// Load .env if present (in Docker, vars may come straight from the environment).
try { process.loadEnvFile(); } catch { /* no .env file — rely on process.env */ }

const { DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID, DB_PATH = './data/config.db' } = process.env;
if (!DISCORD_TOKEN || !OPENAI_API_KEY || !GUILD_ID) {
  console.error('Missing required env: DISCORD_TOKEN, OPENAI_API_KEY, GUILD_ID');
  process.exit(1);
}

const store = openConfigStore(DB_PATH);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const queue = new SerialQueue();

// Message only: discord.js errors can carry request URLs, which embed webhook tokens.
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (c) => {
  try {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), { body: commandDefs });
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
    if (hasTranslatableText(msg.content)) {
      try {
        text = await translate(openai, cfg.model, msg.content);
      } catch (err) {
        console.error(`translation failed for message ${msg.id} (model ${cfg.model}), forwarding original: ${errText(err)}`);
        text = `⚠️ ${msg.content}`;
      }
    }

    const username = sanitizeUsername(msg.member?.displayName ?? msg.author.username, 'porotranslator');
    try {
      await sendAsAuthor(dest as TextChannel, { username, avatarURL: msg.author.displayAvatarURL() }, text);
    } catch (err) {
      // Retry already happened inside sendAsAuthor; this is a real drop.
      console.error(`DROPPED message ${msg.id} from ${username}: send failed after retry: ${errText(err)}`);
    }
  });
});

client.login(DISCORD_TOKEN);
