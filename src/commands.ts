import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { ConfigStore } from './db.ts';

// All config commands require Manage Server.
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
      .setDescription('Set the channel to post English translations to')
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
];

export async function handleCommand(i: ChatInputCommandInteraction, store: ConfigStore): Promise<void> {
  // Default permissions are overridable per guild; enforce at runtime too.
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return void i.reply({ content: '❌ Requires Manage Server.', flags: MessageFlags.Ephemeral });
  switch (i.commandName) {
    case 'set-source': {
      const id = i.options.getChannel('channel', true).id;
      if (id === store.get().destChannel)
        return void i.reply({ content: '❌ Source and destination must differ.', flags: MessageFlags.Ephemeral });
      store.set('sourceChannel', id);
      return void i.reply({ content: '✅ Source channel set.', flags: MessageFlags.Ephemeral });
    }
    case 'set-dest': {
      const id = i.options.getChannel('channel', true).id;
      if (id === store.get().sourceChannel)
        return void i.reply({ content: '❌ Source and destination must differ.', flags: MessageFlags.Ephemeral });
      store.set('destChannel', id);
      return void i.reply({ content: '✅ Destination channel set.', flags: MessageFlags.Ephemeral });
    }
    case 'set-model': {
      store.set('model', i.options.getString('model', true));
      return void i.reply({ content: '✅ Model updated.', flags: MessageFlags.Ephemeral });
    }
    case 'toggle': {
      const next = !store.get().enabled;
      store.set('enabled', next);
      return void i.reply({ content: next ? '▶️ Translation enabled.' : '⏸️ Translation disabled.', flags: MessageFlags.Ephemeral });
    }
    case 'status': {
      const c = store.get();
      return void i.reply({
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
