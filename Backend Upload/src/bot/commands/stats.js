const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const config = require('../../config');
const userQueries = require('../../database/queries/users');
const { COLORS } = require('../../utils/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View verification statistics (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!config.discord.ownerIds.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ This command is restricted to the bot owner.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const allUsers = await userQueries.getAllVerifiedUsers();

      const oauthUsers = allUsers.filter((u) => !u.manually_verified);
      const manualUsers = allUsers.filter((u) => u.manually_verified);
      const revokedCount = allUsers.filter((u) => u.token_revoked).length;

      const embed = new EmbedBuilder()
        .setTitle('📊 Verification Statistics')
        .addFields(
          { name: 'Total Verified', value: `${allUsers.length}`, inline: true },
          { name: 'OAuth Verified', value: `${oauthUsers.length}`, inline: true },
          { name: 'Manually Verified', value: `${manualUsers.length}`, inline: true },
          { name: 'Tokens Revoked', value: `${revokedCount}`, inline: true },
          {
            name: 'Migratable (OAuth)',
            value: `${oauthUsers.filter((u) => !u.token_revoked).length}`,
            inline: true,
          }
        )
        .setColor(COLORS.INFO)
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({
        content: `❌ Failed to fetch stats: ${err.message}`,
      });
    }
  },
};
