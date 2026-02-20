const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const config = require('../../config');
const logger = require('../../utils/logger');
const userQueries = require('../../database/queries/users');
const { assignVerifiedRoles } = require('../../web/routes/oauth');
const { COLORS } = require('../../utils/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Manually verify a user (Staff only)')
    .addStringOption((option) =>
      option
        .setName('userid')
        .setDescription('The Discord user ID to verify')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Staff/owner check
    const isOwner = config.discord.ownerIds.includes(interaction.user.id);
    const isStaff = interaction.member && config.discord.staffRoleIds.some(
      (roleId) => interaction.member.roles.cache.has(roleId)
    );

    if (!isOwner && !isStaff) {
      return interaction.reply({
        content: '❌ This command is restricted to staff members.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('userid').trim();

    // Validate user ID format (Discord snowflake)
    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Invalid User ID')
            .setDescription(`\`${userId}\` is not a valid Discord user ID.`)
            .setColor(COLORS.ERROR),
        ],
      });
    }

    try {
      // Check if user is already verified
      const existingUser = await userQueries.getVerifiedUser(userId);
      if (existingUser && !existingUser.token_revoked) {
        const verifiedType = existingUser.manually_verified ? 'manually' : 'via OAuth';
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('⚠️ Already Verified')
              .setDescription(
                `<@${userId}> is already verified (${verifiedType}).\n` +
                `Verified at: <t:${Math.floor(new Date(existingUser.verified_at).getTime() / 1000)}:F>`
              )
              .setColor(COLORS.WARNING),
          ],
        });
      }

      // Verify user in database
      await userQueries.manuallyVerifyUser(userId);

      // Audit log
      await userQueries.writeAuditLog('manual_verify', interaction.user.id, userId, {
        guildId: interaction.guildId,
        command: '/verify',
      });

      logger.info('User manually verified', {
        targetUserId: userId,
        verifiedBy: interaction.user.id,
        guildId: interaction.guildId,
      });

      // Try to assign roles
      let roleStatus = '';
      try {
        await assignVerifiedRoles(userId);
        roleStatus = '\n✅ Verified role assigned.';
      } catch (err) {
        if (err.message.includes('Unknown Member') || err.message.includes('not found')) {
          roleStatus = '\n⚠️ User not in server — role will be assigned when they join.';
        } else {
          roleStatus = `\n⚠️ Could not assign role: ${err.message}`;
        }
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ User Manually Verified')
            .setDescription(
              `<@${userId}> has been marked as verified.${roleStatus}`
            )
            .setColor(COLORS.SUCCESS)
            .setTimestamp(),
        ],
      });
    } catch (err) {
      logger.error('Manual verify command error', {
        targetUserId: userId,
        error: err.message,
        stack: err.stack,
      });

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Verification Failed')
            .setDescription(`Failed to verify user: ${err.message}`)
            .setColor(COLORS.ERROR),
        ],
      });
    }
  },
};
