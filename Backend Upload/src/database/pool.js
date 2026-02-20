const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: config.database.connectionString,
  ssl: config.database.ssl,
  max: config.database.max,
  idleTimeoutMillis: config.database.idleTimeoutMillis,
  connectionTimeoutMillis: config.database.connectionTimeoutMillis,
});

// Log pool events
pool.on('connect', () => {
  logger.debug('Database pool: new client connected');
});

pool.on('error', (err) => {
  logger.error('Database pool: unexpected error on idle client', { error: err.message });
});

pool.on('remove', () => {
  logger.debug('Database pool: client removed');
});

/**
 * Execute a query with automatic client acquisition/release.
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', {
      query: text.substring(0, 80),
      duration: `${duration}ms`,
      rows: result.rowCount,
    });
    return result;
  } catch (err) {
    logger.error('Query failed', {
      query: text.substring(0, 80),
      error: err.message,
    });
    throw err;
  }
}

/**
 * Get a dedicated client for transactions.
 */
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);

  // Monkey-patch release to prevent double-release
  let released = false;
  client.release = () => {
    if (released) {
      logger.warn('Client already released — ignoring duplicate release');
      return;
    }
    released = true;
    return originalRelease();
  };

  return client;
}

/**
 * Execute a function within a transaction.
 */
async function transaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test database connectivity.
 */
async function testConnection() {
  try {
    const result = await query('SELECT NOW() as now');
    logger.info('Database connected successfully', { serverTime: result.rows[0].now });
    return true;
  } catch (err) {
    logger.error('Database connection failed', { error: err.message });
    return false;
  }
}

/**
 * Gracefully shut down the pool.
 */
async function shutdown() {
  logger.info('Shutting down database pool...');
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = {
  pool,
  query,
  getClient,
  transaction,
  testConnection,
  shutdown,
};
