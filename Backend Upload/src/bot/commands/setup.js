const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const config = require('../../config');
const logger = require('../../utils/logger');
const { sendVerificationPanel } = require('../buttons/verify');
const { COLORS } = require('../../utils/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Send the verification panel to a channel (Owner only)')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to send the verification panel to')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Owner-only check
    if (!config.discord.ownerIds.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ This command is restricted to the bot owner.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    try {
      const message = await sendVerificationPanel(channel);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Verification Panel Deployed')
            .setDescription(
              `The verification panel has been sent to <#${channel.id}>.\n` +
              `Message ID: \`${message.id}\``
            )
            .setColor(COLORS.SUCCESS),
        ],
      });
    } catch (err) {
      logger.error('Setup command error', { error: err.message });
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Setup Failed')
            .setDescription(`Failed to send verification panel: ${err.message}`)
            .setColor(COLORS.ERROR),
        ],
      });
    }
  },
};
