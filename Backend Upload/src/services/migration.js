const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const oauthService = require('./oauth');
const userQueries = require('../database/queries/users');
const { RateLimiter, retryWithBackoff, sleep } = require('../utils/rateLimiter');
const { MIGRATION_STATUS, COLORS, GUILD_JOIN_DELAY_MS } = require('../utils/constants');

/**
 * Execute a full migration: pull all verified users into a new guild.
 *
 * @param {import('discord.js').Client} client - Discord.js client
 * @param {import('discord.js').TextChannel} channel - Channel for progress updates
 * @param {string} targetGuildId - Target guild snowflake
 * @param {string} initiatedBy - Owner's Discord ID
 */
async function executeMigration(client, channel, targetGuildId, initiatedBy) {
  // ========================================
  // 1. VALIDATION
  // ========================================

  // Verify the bot is in the target guild
  const targetGuild = client.guilds.cache.get(targetGuildId);
  if (!targetGuild) {
    throw new Error(
      `Bot is not in guild \`${targetGuildId}\`. Invite the bot first, then retry.`
    );
  }

  // Verify bot has the required permission to add members
  const botMember = targetGuild.members.cache.get(client.user.id);
  if (botMember && !botMember.permissions.has('CreateInstantInvite')) {
    logger.warn('Bot may lack permissions in target guild', { targetGuildId });
  }

  // ========================================
  // 2. CHECK FOR RESUME (interrupted migration)
  // ========================================
  let migrationRun;
  let alreadyProcessed = new Map();

  const existingRun = await userQueries.getIncompleteMigrationRun(targetGuildId);
  if (existingRun) {
    alreadyProcessed = await userQueries.getProcessedUsersForRun(existingRun.id);
    migrationRun = existingRun;

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔄 Resuming Interrupted Migration')
          .setDescription(
            `Found an incomplete migration run (#${existingRun.id}) for this guild.\n` +
            `Already processed: **${alreadyProcessed.size}** users.\n` +
            `Resuming from where it left off...`
          )
          .setColor(COLORS.WARNING),
      ],
    });

    logger.info('Resuming interrupted migration', {
      runId: existingRun.id,
      alreadyProcessed: alreadyProcessed.size,
    });
  }

  // ========================================
  // 3. FETCH ALL VERIFIED USERS
  // ========================================
  const allUsers = await userQueries.getAllVerifiedUsers();

  if (allUsers.length === 0) {
    throw new Error('No verified users found in the database.');
  }

  // Filter out already-processed users for resumed runs
  const usersToProcess = alreadyProcessed.size > 0
    ? allUsers.filter((u) => !alreadyProcessed.has(u.discord_id))
    : allUsers;

  // Create new migration run if not resuming
  if (!migrationRun) {
    migrationRun = await userQueries.createMigrationRun(
      targetGuildId,
      initiatedBy,
      allUsers.length
    );
  }

  // Audit log
  await userQueries.writeAuditLog('migration_start', initiatedBy, targetGuildId, {
    runId: migrationRun.id,
    totalUsers: allUsers.length,
    newToProcess: usersToProcess.length,
    resumed: alreadyProcessed.size > 0,
  });

  // ========================================
  // 4. SEND INITIAL STATUS
  // ========================================
  const startEmbed = new EmbedBuilder()
    .setTitle('🚀 Migration Started')
    .setDescription(
      `**Target:** ${targetGuild.name} (\`${targetGuildId}\`)\n` +
      `**Total verified users:** ${allUsers.length}\n` +
      `**Users to process:** ${usersToProcess.length}\n` +
      `**Run ID:** #${migrationRun.id}`
    )
    .setColor(COLORS.MIGRATION)
    .setTimestamp();

  const statusMessage = await channel.send({ embeds: [startEmbed] });

  // ========================================
  // 5. PROCESS USERS
  // ========================================
  const rateLimiter = new RateLimiter({
    requestsPerSecond: config.migration.concurrency,
  });

  const counts = {
    added: 0,
    alreadyIn: 0,
    failed: 0,
    skippedManual: 0,
    tokenRevoked: 0,
    total: usersToProcess.length,
  };

  const progressInterval = config.migration.progressInterval;
  let processed = 0;
  const failedUsers = [];

  for (const user of usersToProcess) {
    processed++;

    try {
      const result = await processSingleUser(
        user,
        targetGuildId,
        migrationRun.id,
        rateLimiter
      );

      switch (result) {
        case MIGRATION_STATUS.ADDED:
          counts.added++;
          break;
        case MIGRATION_STATUS.ALREADY_IN:
          counts.alreadyIn++;
          break;
        case MIGRATION_STATUS.SKIPPED_MANUAL:
          counts.skippedManual++;
          break;
        case MIGRATION_STATUS.TOKEN_REVOKED:
        case MIGRATION_STATUS.REFRESH_FAILED:
          counts.tokenRevoked++;
          break;
        case MIGRATION_STATUS.FAILED:
        default:
          counts.failed++;
          failedUsers.push(user.discord_id);
          break;
      }
    } catch (err) {
      counts.failed++;
      failedUsers.push(user.discord_id);
      logger.error('Unexpected error processing user', {
        discordId: user.discord_id,
        error: err.message,
      });
    }

    // Send progress update every N users
    if (processed % progressInterval === 0 || processed === usersToProcess.length) {
      await sendProgressUpdate(statusMessage, counts, processed, migrationRun.id, targetGuild.name);
    }
  }

  // ========================================
  // 6. FINALIZE
  // ========================================
  // Add back counts from resumed run
  if (alreadyProcessed.size > 0) {
    for (const [, status] of alreadyProcessed) {
      switch (status) {
        case MIGRATION_STATUS.ADDED: counts.added++; break;
        case MIGRATION_STATUS.ALREADY_IN: counts.alreadyIn++; break;
        case MIGRATION_STATUS.SKIPPED_MANUAL: counts.skippedManual++; break;
        case MIGRATION_STATUS.TOKEN_REVOKED:
        case MIGRATION_STATUS.REFRESH_FAILED: counts.tokenRevoked++; break;
        default: counts.failed++; break;
      }
    }
  }

  await userQueries.completeMigrationRun(migrationRun.id, counts);

  await userQueries.writeAuditLog('migration_complete', initiatedBy, targetGuildId, {
    runId: migrationRun.id,
    counts,
  });

  // Final summary embed
  const finalEmbed = new EmbedBuilder()
    .setTitle('✅ Migration Complete')
    .setDescription(`**Target:** ${targetGuild.name}`)
    .addFields(
      { name: '✅ Added', value: `${counts.added}`, inline: true },
      { name: '📌 Already In', value: `${counts.alreadyIn}`, inline: true },
      { name: '📋 Manual (Skipped)', value: `${counts.skippedManual}`, inline: true },
      { name: '🔑 Token Revoked', value: `${counts.tokenRevoked}`, inline: true },
      { name: '❌ Failed', value: `${counts.failed}`, inline: true },
      { name: '📊 Total', value: `${allUsers.length}`, inline: true }
    )
    .setColor(counts.failed > 0 ? COLORS.WARNING : COLORS.SUCCESS)
    .setFooter({ text: `Run #${migrationRun.id}` })
    .setTimestamp();

  await channel.send({ embeds: [finalEmbed] });

  // Log failed users if any
  if (failedUsers.length > 0 && failedUsers.length <= 50) {
    const failedList = failedUsers.map((id) => `<@${id}>`).join(', ');
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Failed Users')
          .setDescription(failedList.substring(0, 4000))
          .setColor(COLORS.ERROR)
          .setFooter({
            text: `${failedUsers.length} users failed. Check logs for details.`,
          }),
      ],
    });
  } else if (failedUsers.length > 50) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Failed Users')
          .setDescription(
            `**${failedUsers.length}** users failed (too many to list).\n` +
            `Check the database \`migration_user_log\` table for details.\n` +
            `Run: \`SELECT * FROM migration_user_log WHERE migration_run_id = ${migrationRun.id} AND status = 'failed'\``
          )
          .setColor(COLORS.ERROR),
      ],
    });
  }

  logger.info('Migration completed', {
    runId: migrationRun.id,
    targetGuildId,
    counts,
  });
}

/**
 * Process a single user for migration.
 *
 * @param {Object} user - User row from database
 * @param {string} targetGuildId
 * @param {number} migrationRunId
 * @param {RateLimiter} rateLimiter
 * @returns {string} Migration status
 */
async function processSingleUser(user, targetGuildId, migrationRunId, rateLimiter) {
  const discordId = user.discord_id;

  // Handle manually verified users (no OAuth tokens)
  if (user.manually_verified && !user.access_token) {
    logger.info('Skipping manual-only user', { discordId });
    await userQueries.logMigrationUser(
      migrationRunId,
      discordId,
      MIGRATION_STATUS.SKIPPED_MANUAL,
      'No OAuth tokens — manually verified only'
    );
    return MIGRATION_STATUS.SKIPPED_MANUAL;
  }

  // Ensure token is revoked check
  if (user.token_revoked) {
    await userQueries.logMigrationUser(
      migrationRunId,
      discordId,
      MIGRATION_STATUS.TOKEN_REVOKED,
      'Token previously revoked'
    );
    return MIGRATION_STATUS.TOKEN_REVOKED;
  }

  // Try to get a fresh access token
  let accessToken;
  try {
    accessToken = await oauthService.ensureFreshToken(user);
  } catch (err) {
    if (err.message === 'TOKEN_REVOKED') {
      await userQueries.logMigrationUser(
        migrationRunId,
        discordId,
        MIGRATION_STATUS.TOKEN_REVOKED,
        'Token revoked during refresh'
      );
      return MIGRATION_STATUS.TOKEN_REVOKED;
    }

    logger.error('Token refresh failed for user', { discordId, error: err.message });
    await userQueries.logMigrationUser(
      migrationRunId,
      discordId,
      MIGRATION_STATUS.REFRESH_FAILED,
      err.message
    );
    return MIGRATION_STATUS.REFRESH_FAILED;
  }

  // Add user to guild with rate limiting and retry
  await rateLimiter.acquire();

  const result = await retryWithBackoff(
    async (attempt) => {
      const joinResult = await oauthService.addUserToGuild(
        targetGuildId,
        discordId,
        accessToken
      );

      // Handle rate limit retry
      if (joinResult.status === 'rate_limited') {
        const waitMs = (joinResult.retryAfter + 0.5) * 1000;
        logger.warn('Rate limited, waiting...', { discordId, waitMs });
        await sleep(waitMs);
        throw new Error('RATE_LIMITED'); // Trigger retry
      }

      return joinResult;
    },
    {
      maxAttempts: config.migration.retryAttempts,
      baseDelay: 2000,
      maxDelay: 60000,
      retryOn: (err) => err.message === 'RATE_LIMITED',
    }
  );

  // Log result
  await userQueries.logMigrationUser(
    migrationRunId,
    discordId,
    result.status,
    result.error || null
  );

  if (result.status === MIGRATION_STATUS.ADDED) {
    logger.debug('User added to guild', { discordId, targetGuildId });
  } else if (result.status === MIGRATION_STATUS.ALREADY_IN) {
    logger.debug('User already in guild', { discordId, targetGuildId });
  } else {
    logger.warn('User join failed', { discordId, targetGuildId, result });
  }

  // Small delay between joins for safety
  await sleep(GUILD_JOIN_DELAY_MS);

  return result.status;
}

/**
 * Send/edit a progress update embed.
 */
async function sendProgressUpdate(statusMessage, counts, processed, runId, guildName) {
  const total = counts.total;
  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
  const progressBar = createProgressBar(percentage);

  const embed = new EmbedBuilder()
    .setTitle('⏳ Migration In Progress')
    .setDescription(
      `**Target:** ${guildName}\n` +
      `**Progress:** ${processed}/${total} (${percentage}%)\n` +
      `${progressBar}\n\n` +
      `✅ Added: **${counts.added}**\n` +
      `📌 Already in: **${counts.alreadyIn}**\n` +
      `📋 Manual skip: **${counts.skippedManual}**\n` +
      `🔑 Revoked: **${counts.tokenRevoked}**\n` +
      `❌ Failed: **${counts.failed}**`
    )
    .setColor(COLORS.MIGRATION)
    .setFooter({ text: `Run #${runId}` })
    .setTimestamp();

  try {
    await statusMessage.edit({ embeds: [embed] });
  } catch (err) {
    logger.warn('Could not update progress message', { error: err.message });
  }
}

/**
 * Create a visual progress bar string.
 */
function createProgressBar(percentage) {
  const filled = Math.round(percentage / 5);
  const empty = 20 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage}%`;
}

module.exports = {
  executeMigration,
};
