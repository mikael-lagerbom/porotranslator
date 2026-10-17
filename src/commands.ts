import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { ConfigStore } from './db.ts';

// Config commands require Manage Server; /optout and /optin are for everyone.
const admin = (b: SlashCommandBuilder) =>
  b.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).toJSON();

export const commandDefs = [
  admin(
    new SlashCommandBuilder()
      .setName('set-source')
      .setDescription('Set the channel to read Finnish messages from')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Source channel').addChannelTypes(ChannelType.GuildText).setRequired(true),
      ) as SlashCommandBuilder,
  ),
  admin(
    new SlashCommandBuilder()
      .setName('set-dest')
      .setDescription('Set the English channel (receives translations, its messages are forwarded back)')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText).setRequired(true),
      ) as SlashCommandBuilder,
  ),
  admin(
    new SlashCommandBuilder()
      .setName('set-model')
      .setDescription('Set the OpenAI model used for translation')
      .addStringOption((o) => o.setName('model').setDescription('Model id, e.g. gpt-6-luna').setRequired(true)) as SlashCommandBuilder,
  ),
  admin(new SlashCommandBuilder().setName('status').setDescription('Show current translator config')),
  admin(new SlashCommandBuilder().setName('toggle').setDescription('Enable or disable translation')),
  new SlashCommandBuilder().setName('optout').setDescription('Stop the translator from processing or reposting your messages').toJSON(),
  new SlashCommandBuilder().setName('optin').setDescription('Let the translator process and repost your messages again').toJSON(),
];

// Replies are returned, not voided, so a failed reply (e.g. expired interaction) reaches the caller's catch.
export async function handleCommand(i: ChatInputCommandInteraction, store: ConfigStore): Promise<unknown> {
  if (i.commandName === 'optout' || i.commandName === 'optin') {
    const out = i.commandName === 'optout';
    store.setOptedOut(i.user.id, out);
    return i.reply({
      content: out
        ? '✅ Opted out. Your messages will no longer be sent for translation or reposted. Use /optin to undo.'
        : '✅ Opted in. Your messages will be translated and forwarded again.',
      flags: MessageFlags.Ephemeral,
    });
  }
  // Default permissions are overridable per guild; enforce at runtime too.
  if (!i.inCachedGuild() || !i.memberPermissions.has(PermissionFlagsBits.ManageGuild))
    return i.reply({ content: '❌ Requires Manage Server.', flags: MessageFlags.Ephemeral });
  const deny = (content: string) => i.reply({ content: `❌ ${content}`, flags: MessageFlags.Ephemeral });
  const me = i.guild.members.me!;
  switch (i.commandName) {
    case 'set-source':
    case 'set-dest': {
      const isSource = i.commandName === 'set-source';
      const ch = i.options.getChannel('channel', true, [ChannelType.GuildText]);
      const other = isSource ? store.get().destChannel : store.get().sourceChannel;
      if (ch.id === other) return deny('Source and destination must differ.');
      // The bot posts into both channels by webhook (translations one way, forwards the other), and webhook
      // posts bypass channel send permissions, so don't let anyone target a channel they can't post in.
      if (!ch.permissionsFor(i.member).has(PermissionFlagsBits.SendMessages)) return deny(`You can't post in ${ch}.`);
      if (!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageWebhooks]))
        return deny(`I need View Channel and Manage Webhooks in ${ch}.`);
      store.set(isSource ? 'sourceChannel' : 'destChannel', ch.id);
      return i.reply({ content: `✅ ${isSource ? 'Source' : 'Destination'} channel set.`, flags: MessageFlags.Ephemeral });
    }
    case 'set-model': {
      store.set('model', i.options.getString('model', true));
      return i.reply({ content: '✅ Model updated.', flags: MessageFlags.Ephemeral });
    }
    case 'toggle': {
      const next = !store.get().enabled;
      store.set('enabled', next);
      return i.reply({ content: next ? '▶️ Translation enabled.' : '⏸️ Translation disabled.', flags: MessageFlags.Ephemeral });
    }
    case 'status': {
      const c = store.get();
      return i.reply({
        flags: MessageFlags.Ephemeral,
        content:
          `**Translator status**\n` +
          `Enabled: ${c.enabled ? 'yes' : 'no'}\n` +
          `Source: ${c.sourceChannel ? `<#${c.sourceChannel}>` : '_unset_'}\n` +
          `Dest: ${c.destChannel ? `<#${c.destChannel}>` : '_unset_'}\n` +
          `Model: \`${c.model}\``,
      });
    }
  }
}
