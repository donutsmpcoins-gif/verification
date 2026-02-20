const logger = require('../../utils/logger');
const config = require('../../config');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn('Unknown command received', { command: interaction.commandName });
        return;
      }

      try {
        logger.info('Slash command executed', {
          command: interaction.commandName,
          userId: interaction.user.id,
          guildId: interaction.guildId,
        });

        await command.execute(interaction);
      } catch (err) {
        logger.error('Slash command error', {
          command: interaction.commandName,
          error: err.message,
          stack: err.stack,
        });

        const content = '❌ An error occurred while executing this command.';

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // Handle button interactions
    if (interaction.isButton()) {
      const buttonId = interaction.customId;

      try {
        if (buttonId === 'verify_button') {
          const { handleVerifyButton } = require('../buttons/verify');
          await handleVerifyButton(interaction);
          return;
        }

        logger.warn('Unknown button interaction', { buttonId });
      } catch (err) {
        logger.error('Button interaction error', {
          buttonId,
          error: err.message,
        });

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ An error occurred. Please try again.',
            ephemeral: true,
          }).catch(() => {});
        }
      }
      return;
    }
  },
};
