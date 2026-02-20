const db = require('../pool');
const logger = require('../../utils/logger');

/**
 * Upsert a verified user after OAuth flow.
 */
async function upsertVerifiedUser({
  discordId,
  username,
  discriminator,
  accessToken,
  refreshToken,
  tokenExpiresAt,
  scopes,
}) {
  const result = await db.query(
    `INSERT INTO verified_users (
      discord_id, username, discriminator, access_token, refresh_token,
      token_expires_at, scopes, manually_verified, verified_at, token_revoked
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), FALSE)
    ON CONFLICT (discord_id) DO UPDATE SET
      username = EXCLUDED.username,
      discriminator = EXCLUDED.discriminator,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = EXCLUDED.scopes,
      manually_verified = FALSE,
      verified_at = NOW(),
      token_revoked = FALSE,
      revoked_at = NULL
    RETURNING *`,
    [discordId, username, discriminator, accessToken, refreshToken, tokenExpiresAt, scopes]
  );
  return result.rows[0];
}

/**
 * Mark a user as manually verified (no OAuth tokens).
 */
async function manuallyVerifyUser(discordId) {
  const result = await db.query(
    `INSERT INTO verified_users (discord_id, manually_verified, verified_at)
     VALUES ($1, TRUE, NOW())
     ON CONFLICT (discord_id) DO UPDATE SET
       manually_verified = TRUE,
       verified_at = NOW()
     RETURNING *`,
    [discordId]
  );
  return result.rows[0];
}

/**
 * Get a single verified user by Discord ID.
 */
async function getVerifiedUser(discordId) {
  const result = await db.query(
    'SELECT * FROM verified_users WHERE discord_id = $1',
    [discordId]
  );
  return result.rows[0] || null;
}

/**
 * Get all verified users (non-revoked).
 */
async function getAllVerifiedUsers() {
  const result = await db.query(
    `SELECT * FROM verified_users
     WHERE token_revoked = FALSE
     ORDER BY verified_at ASC`
  );
  return result.rows;
}

/**
 * Get all OAuth-verified users with valid tokens for migration.
 */
async function getOAuthVerifiedUsers() {
  const result = await db.query(
    `SELECT * FROM verified_users
     WHERE manually_verified = FALSE
       AND token_revoked = FALSE
     ORDER BY verified_at ASC`
  );
  return result.rows;
}

/**
 * Update tokens after a refresh.
 */
async function updateTokens(discordId, { accessToken, refreshToken, tokenExpiresAt }) {
  const result = await db.query(
    `UPDATE verified_users
     SET access_token = $2,
         refresh_token = $3,
         token_expires_at = $4
     WHERE discord_id = $1
     RETURNING *`,
    [discordId, accessToken, refreshToken, tokenExpiresAt]
  );
  return result.rows[0];
}

/**
 * Mark a user's token as revoked.
 */
async function markTokenRevoked(discordId) {
  await db.query(
    `UPDATE verified_users
     SET token_revoked = TRUE,
         revoked_at = NOW(),
         access_token = NULL,
         refresh_token = NULL
     WHERE discord_id = $1`,
    [discordId]
  );
  logger.info('Token marked as revoked', { discordId });
}

/**
 * Count verified users.
 */
async function countVerifiedUsers() {
  const result = await db.query(
    'SELECT COUNT(*) as total FROM verified_users WHERE token_revoked = FALSE'
  );
  return parseInt(result.rows[0].total, 10);
}

/**
 * Check if a user is already verified.
 */
async function isUserVerified(discordId) {
  const result = await db.query(
    'SELECT 1 FROM verified_users WHERE discord_id = $1 AND token_revoked = FALSE',
    [discordId]
  );
  return result.rows.length > 0;
}

// =============================================
// OAUTH STATE MANAGEMENT
// =============================================

/**
 * Create an OAuth state for CSRF protection.
 */
async function createOAuthState(state, discordId, guildId) {
  await db.query(
    `INSERT INTO oauth_states (state, discord_id, guild_id)
     VALUES ($1, $2, $3)`,
    [state, discordId, guildId]
  );
}

/**
 * Consume an OAuth state (mark as used).
 */
async function consumeOAuthState(state) {
  const result = await db.query(
    `UPDATE oauth_states
     SET used = TRUE
     WHERE state = $1
       AND used = FALSE
       AND expires_at > NOW()
     RETURNING *`,
    [state]
  );
  return result.rows[0] || null;
}

/**
 * Clean up expired states.
 */
async function cleanupExpiredStates() {
  const result = await db.query('SELECT cleanup_expired_oauth_states() as count');
  return result.rows[0].count;
}

// =============================================
// MIGRATION RUNS
// =============================================

/**
 * Create a migration run record.
 */
async function createMigrationRun(targetGuildId, initiatedBy, totalUsers) {
  const result = await db.query(
    `INSERT INTO migration_runs (target_guild_id, initiated_by, total_users)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [targetGuildId, initiatedBy, totalUsers]
  );
  return result.rows[0];
}

/**
 * Update migration run counters.
 */
async function updateMigrationRun(runId, updates) {
  const setClauses = [];
  const values = [runId];
  let paramIndex = 2;

  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    setClauses.push(`${snakeKey} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  if (setClauses.length === 0) return;

  await db.query(
    `UPDATE migration_runs SET ${setClauses.join(', ')} WHERE id = $1`,
    values
  );
}

/**
 * Complete a migration run.
 */
async function completeMigrationRun(runId, counts) {
  await db.query(
    `UPDATE migration_runs
     SET completed_at = NOW(),
         status = 'completed',
         added_count = $2,
         already_in_count = $3,
         failed_count = $4,
         skipped_manual = $5,
         token_revoked_count = $6
     WHERE id = $1`,
    [
      runId,
      counts.added,
      counts.alreadyIn,
      counts.failed,
      counts.skippedManual,
      counts.tokenRevoked,
    ]
  );
}

/**
 * Mark a migration run as failed.
 */
async function failMigrationRun(runId, errorMessage) {
  await db.query(
    `UPDATE migration_runs
     SET completed_at = NOW(),
         status = 'failed',
         error_message = $2
     WHERE id = $1`,
    [runId, errorMessage]
  );
}

/**
 * Log a single user migration attempt.
 */
async function logMigrationUser(migrationRunId, discordId, status, errorMessage = null) {
  await db.query(
    `INSERT INTO migration_user_log (migration_run_id, discord_id, status, error_message)
     VALUES ($1, $2, $3, $4)`,
    [migrationRunId, discordId, status, errorMessage]
  );
}

/**
 * Get users already processed in a migration run (for resume).
 */
async function getProcessedUsersForRun(migrationRunId) {
  const result = await db.query(
    `SELECT discord_id, status FROM migration_user_log
     WHERE migration_run_id = $1`,
    [migrationRunId]
  );
  return new Map(result.rows.map((r) => [r.discord_id, r.status]));
}

/**
 * Get the last incomplete migration run for a guild.
 */
async function getIncompleteMigrationRun(targetGuildId) {
  const result = await db.query(
    `SELECT * FROM migration_runs
     WHERE target_guild_id = $1 AND status = 'running'
     ORDER BY started_at DESC
     LIMIT 1`,
    [targetGuildId]
  );
  return result.rows[0] || null;
}

// =============================================
// AUDIT LOG
// =============================================

/**
 * Write an entry to the audit log.
 */
async function writeAuditLog(action, actorId, targetId, details = {}) {
  await db.query(
    `INSERT INTO audit_log (action, actor_id, target_id, details)
     VALUES ($1, $2, $3, $4)`,
    [action, actorId, targetId, JSON.stringify(details)]
  );
}

module.exports = {
  upsertVerifiedUser,
  manuallyVerifyUser,
  getVerifiedUser,
  getAllVerifiedUsers,
  getOAuthVerifiedUsers,
  updateTokens,
  markTokenRevoked,
  countVerifiedUsers,
  isUserVerified,
  createOAuthState,
  consumeOAuthState,
  cleanupExpiredStates,
  createMigrationRun,
  updateMigrationRun,
  completeMigrationRun,
  failMigrationRun,
  logMigrationUser,
  getProcessedUsersForRun,
  getIncompleteMigrationRun,
  writeAuditLog,
};
