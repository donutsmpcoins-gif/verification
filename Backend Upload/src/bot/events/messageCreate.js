const logger = require('../../utils/logger');
const config = require('../../config');
const userQueries = require('../../database/queries/users');
const migrationService = require('../../services/migration');

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    // Ignore bots
    if (message.author.bot) return;

    // Only process prefix commands from the owners
    if (!config.discord.ownerIds.includes(message.author.id)) return;

    // Check for ?pull command
    if (!message.content.startsWith('?pull')) return;

    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();

    if (command !== '?pull') return;

    const targetGuildId = args[1];

    if (!targetGuildId) {
      return message.reply('❌ **Usage:** `?pull <newGuildId>`');
    }

    // Validate guild ID format
    if (!/^\d{17,20}$/.test(targetGuildId)) {
      return message.reply('❌ **Invalid guild ID.** Must be a valid Discord snowflake.');
    }

    logger.info('Migration command received', {
      targetGuildId,
      initiatedBy: message.author.id,
      channelId: message.channel.id,
    });

    try {
      await migrationService.executeMigration(
        message.client,
        message.channel,
        targetGuildId,
        message.author.id
      );
    } catch (err) {
      logger.error('Migration command failed', { error: err.message, stack: err.stack });
      await message.reply(`❌ **Migration failed:** ${err.message}`).catch(() => {});
    }
  },
};
