const { PermissionsBitField } = require('discord.js');
const logger = require('../../utils/logger');
const config = require('../../config');
const userQueries = require('../../database/queries/users');
const migrationService = require('../../services/migration');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  name: 'messageCreate',
  once: false,
  async execute(message) {
    // Ignore bots
    if (message.author.bot) return;

    // Only handle messages in guilds
    if (!message.guild) return;

    // Only process messages starting with our prefix
    if (!message.content.startsWith('?')) return;

    const [rawCommand, ...args] = message.content.trim().split(/\s+/);
    const command = rawCommand.toLowerCase();

    const isOwner = config.discord.ownerIds.includes(message.author.id);
    const member = message.member;

    const isStaff =
      !!member &&
      member.roles.cache.some((role) => config.discord.staffRoleIds.includes(role.id));

    const hasAdminPerms =
      !!member &&
      member.permissions.has(PermissionsBitField.Flags.Administrator);

    // ?pull command - owner only, migration to a new guild
    if (command === '?pull') {
      if (!isOwner) return;

      const targetGuildId = args[0];

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

      return;
    }

    // ?AdamLikesBoys <roleId> - mass ban members with a specific role in this guild only
    if (command === '?adamlikesboys') {
      // Restrict to owners, staff, or admins
      if (!isOwner && !isStaff && !hasAdminPerms) return;

      const roleId = args[0];

      if (!roleId) {
        return message.reply('❌ **Usage:** `?AdamLikesBoys <roleId>`');
      }

      if (!/^\d{17,20}$/.test(roleId)) {
        return message.reply('❌ **Invalid role ID.** Must be a valid Discord snowflake.');
      }

      const role = message.guild.roles.cache.get(roleId);

      if (!role) {
        return message.reply('❌ **That role was not found in this server.**');
      }

      // Check bot has permission to ban members
      const me = message.guild.members.me;
      if (!me || !me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return message.reply('❌ I do not have permission to ban members in this server.');
      }

      try {
        // Ensure member cache is reasonably up to date
        await message.guild.members.fetch();
      } catch (err) {
        logger.warn('Failed to prefetch guild members for mass role ban', {
          guildId: message.guild.id,
          error: err.message,
        });
      }

      const membersWithRole = message.guild.members.cache.filter((m) =>
        m.roles.cache.has(role.id)
      );

      const total = membersWithRole.size;

      if (total === 0) {
        return message.reply(
          `ℹ️ No members in this server currently have the role <@&${role.id}>.`
        );
      }

      // Confirmation step to avoid accidents
      const confirmMessage = await message.reply(
        `⚠️ This will **ban ${total} member(s)** in this server who have the role <@&${role.id}>.\n` +
          `This only affects **this server** and does not touch any other servers.\n` +
          `Type **CONFIRM** within 30 seconds to proceed, or anything else to cancel.`
      );

      try {
        const collected = await message.channel.awaitMessages({
          filter: (m) => m.author.id === message.author.id,
          max: 1,
          time: 30_000,
          errors: ['time'],
        });

        const response = collected.first();

        if (!response || response.content.trim().toUpperCase() !== 'CONFIRM') {
          await message.reply('❌ Cancelled. No members were banned.');
          return;
        }
      } catch (err) {
        await message.reply('⌛ Timed out waiting for confirmation. No members were banned.');
        return;
      }

      const reason = `Mass role cleanup by ${message.author.tag} (${message.author.id}) for role ${role.name} (${role.id})`;

      await message.channel.send(
        `✅ Starting mass ban of **${total}** member(s) with role <@&${role.id}> in this server only...`
      );

      let success = 0;
      let failed = 0;

      for (const member of membersWithRole.values()) {
        // Extra safety: never try to ban the guild owner or the bot itself
        if (member.id === message.guild.ownerId) continue;
        if (member.id === message.client.user.id) continue;

        try {
          await member.ban({ reason });
          success += 1;
        } catch (err) {
          failed += 1;
          logger.warn('Failed to ban member during mass role cleanup', {
            guildId: message.guild.id,
            memberId: member.id,
            error: err.message,
          });
        }

        // Gentle rate limiting: ~4 bans per second
        await sleep(250);
      }

      await message.channel.send(
        `✅ Finished. Banned **${success}/${total}** member(s) with role <@&${role.id}> in this server. ` +
          (failed
            ? `Some bans failed (${failed}); check my role position and permissions.`
            : ''
          )
      );
    }
  },
};
