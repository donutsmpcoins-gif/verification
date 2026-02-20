const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
} = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');

let clientInstance = null;

/**
 * Create and configure the Discord.js client.
 */
function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.GuildMember,
    ],
    rest: {
      timeout: 30_000,
      retries: 3,
    },
    failIfNotExists: false,
  });

  // Commands collection for slash commands
  client.commands = new Collection();

  clientInstance = client;
  return client;
}

/**
 * Get the existing client instance.
 */
function getClient() {
  return clientInstance;
}

/**
 * Login and return the client.
 */
async function loginClient(client) {
  try {
    await client.login(config.discord.token);
    logger.info('Discord client logged in successfully');
    return client;
  } catch (err) {
    logger.error('Discord client login failed', { error: err.message });
    throw err;
  }
}

module.exports = {
  createClient,
  getClient,
  loginClient,
};
