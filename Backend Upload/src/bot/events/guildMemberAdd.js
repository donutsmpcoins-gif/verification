const logger = require('../../utils/logger');
const config = require('../../config');
const userQueries = require('../../database/queries/users');

module.exports = {
  name: 'guildMemberAdd',
  once: false,
  async execute(member) {
    // Only process for the main guild
    if (member.guild.id !== config.discord.mainGuildId) return;

    logger.info('New member joined', {
      userId: member.user.id,
      username: member.user.username,
      guildId: member.guild.id,
    });

    // Check if the user is already verified in the database
    try {
      const isVerified = await userQueries.isUserVerified(member.user.id);

      if (isVerified) {
        // Re-assign Verified role for returning verified users
        if (config.discord.verifiedRoleId) {
          await member.roles.add(
            config.discord.verifiedRoleId,
            'Returning verified user'
          );
          logger.info('Re-assigned Verified role to returning user', {
            userId: member.user.id,
          });
        }
      } else {
        // Assign Unverified role for new unverified users
        if (config.discord.unverifiedRoleId) {
          await member.roles.add(
            config.discord.unverifiedRoleId,
            'New unverified member'
          );
          logger.info('Assigned Unverified role to new member', {
            userId: member.user.id,
          });
        }
      }
    } catch (err) {
      logger.error('Failed to process new member', {
        userId: member.user.id,
        error: err.message,
      });
    }
  },
};
