const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/pool');
const { runMigrations } = require('./database/migrate');
const { createClient, loginClient } = require('./bot/client');
const { startServer } = require('./web/server');
const { deployCommands } = require('./bot/commands/deploy');

/**
 * Main application entry point.
 * Boots database, Express server, and Discord bot in the correct order.
 */
async function main() {
  logger.info('='.repeat(50));
  logger.info('Discord Verification & Migration System');
  logger.info('='.repeat(50));
  logger.info('Starting up...', {
    nodeVersion: process.version,
    env: config.server.nodeEnv,
    pid: process.pid,
  });

  // ========================================
  // 1. DATABASE
  // ========================================
  logger.info('[1/4] Connecting to database...');
  const dbConnected = await db.testConnection();
  if (!dbConnected) {
    logger.error('Cannot start: database connection failed');
    process.exit(1);
  }

  // Run pending migrations
  logger.info('[1/4] Running database migrations...');
  await runMigrations();

  // ========================================
  // 2. EXPRESS SERVER
  // ========================================
  logger.info('[2/4] Starting Express server...');
  const server = await startServer();

  // ========================================
  // 3. DISCORD BOT
  // ========================================
  logger.info('[3/4] Initializing Discord bot...');
  const client = createClient();

  // Load event handlers
  loadEvents(client);

  // Load slash commands into the client's collection
  loadCommands(client);

  // Login
  await loginClient(client);

  // ========================================
  // 4. DEPLOY SLASH COMMANDS
  // ========================================
  logger.info('[4/4] Deploying slash commands...');
  try {
    await deployCommands();
  } catch (err) {
    logger.warn('Slash command deployment failed (non-fatal)', { error: err.message });
  }

  // ========================================
  // GRACEFUL SHUTDOWN
  // ========================================
  setupGracefulShutdown(client, server);

  logger.info('='.repeat(50));
  logger.info('System fully operational');
  logger.info('='.repeat(50));
}

/**
 * Load all event handlers from the events directory.
 */
function loadEvents(client) {
  const eventsPath = path.join(__dirname, 'bot', 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }

    logger.debug(`Event loaded: ${event.name} (${file})`);
  }

  logger.info(`Loaded ${eventFiles.length} event handlers`);
}

/**
 * Load all slash commands into the client's commands collection.
 */
function loadCommands(client) {
  const commandsPath = path.join(__dirname, 'bot', 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(
    (f) => f.endsWith('.js') && f !== 'deploy.js'
  );

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      logger.debug(`Command loaded: ${command.data.name}`);
    }
  }

  logger.info(`Loaded ${client.commands.size} slash commands`);
}

/**
 * Set up graceful shutdown handlers.
 */
function setupGracefulShutdown(client, server) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // 1. Stop accepting new HTTP requests
    server.close(() => {
      logger.info('Express server stopped');
    });

    // 2. Destroy Discord client
    try {
      client.destroy();
      logger.info('Discord client destroyed');
    } catch (err) {
      logger.error('Error destroying Discord client', { error: err.message });
    }

    // 3. Close database pool
    await db.shutdown();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    // Don't exit on unhandled rejections — log and continue
  });
}

// ========================================
// BOOT
// ========================================
main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
