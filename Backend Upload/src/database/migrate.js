const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');
const logger = require('../utils/logger');

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Get already-executed migrations
    const { rows: executed } = await client.query('SELECT filename FROM _migrations ORDER BY id');
    const executedSet = new Set(executed.map((r) => r.filename));

    // Read migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (executedSet.has(file)) {
        logger.info(`Migration already applied: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info(`Applying migration: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Migration applied successfully: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Migration failed: ${file}`, { error: err.message });
        throw err;
      }
    }

    logger.info('All migrations applied successfully');
  } finally {
    client.release();
  }
}

// Run directly if executed as script
if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migration script complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration script failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { runMigrations };
