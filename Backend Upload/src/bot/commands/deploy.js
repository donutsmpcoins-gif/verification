const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

async function deployCommands() {
  const commands = [];
  const commandsPath = __dirname;
  const commandFiles = fs.readdirSync(commandsPath).filter(
    (file) => file.endsWith('.js') && file !== 'deploy.js'
  );

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) {
      commands.push(command.data.toJSON());
      logger.info(`Loaded command: ${command.data.name}`);
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  try {
    logger.info(`Deploying ${commands.length} slash commands...`);

    // Deploy to main guild (instant) for development
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.mainGuildId),
      { body: commands }
    );

    logger.info(`Successfully deployed ${commands.length} commands to guild ${config.discord.mainGuildId}`);

    // Optionally deploy globally (takes ~1 hour to propagate)
    if (process.argv.includes('--global')) {
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commands }
      );
      logger.info('Commands deployed globally (may take up to 1 hour to propagate)');
    }
  } catch (err) {
    logger.error('Failed to deploy commands', { error: err.message });
    throw err;
  }
}

// Run directly if executed as script
if (require.main === module) {
  deployCommands()
    .then(() => {
      logger.info('Command deployment complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Command deployment failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { deployCommands };
