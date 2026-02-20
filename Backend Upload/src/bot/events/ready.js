const logger = require('../../utils/logger');
const userQueries = require('../../database/queries/users');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info('Discord bot ready', {
      tag: client.user.tag,
      id: client.user.id,
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
    });

    // Set bot activity
    client.user.setActivity('Verification System', { type: 3 }); // WATCHING

    // Log guild info
    for (const [id, guild] of client.guilds.cache) {
      logger.info('Connected to guild', {
        guildId: id,
        guildName: guild.name,
        memberCount: guild.memberCount,
      });
    }

    // Schedule periodic cleanup of expired OAuth states
    setInterval(async () => {
      try {
        const cleaned = await userQueries.cleanupExpiredStates();
        if (cleaned > 0) {
          logger.debug('Cleaned expired OAuth states', { count: cleaned });
        }
      } catch (err) {
        logger.error('Failed to cleanup OAuth states', { error: err.message });
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Log verified user count
    try {
      const count = await userQueries.countVerifiedUsers();
      logger.info('Verified users in database', { count });
    } catch (err) {
      logger.error('Failed to count verified users', { error: err.message });
    }
  },
};
