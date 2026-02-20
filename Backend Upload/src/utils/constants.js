module.exports = {
  // OAuth2 endpoints
  DISCORD_API_BASE: 'https://discord.com/api/v10',
  DISCORD_OAUTH_AUTHORIZE: 'https://discord.com/api/oauth2/authorize',
  DISCORD_OAUTH_TOKEN: 'https://discord.com/api/oauth2/token',
  DISCORD_OAUTH_REVOKE: 'https://discord.com/api/oauth2/token/revoke',

  // Rate limit safety margins
  GUILD_JOIN_DELAY_MS: 150, // ~6.5 joins/sec, under the 10/sec limit
  RATE_LIMIT_BUFFER_MS: 500,

  // Token refresh buffer — refresh if expires within 1 hour
  TOKEN_REFRESH_BUFFER_SECONDS: 3600,

  // Migration statuses
  MIGRATION_STATUS: {
    ADDED: 'added',
    ALREADY_IN: 'already_in_server',
    FAILED: 'failed',
    SKIPPED_MANUAL: 'skipped_manual',
    TOKEN_REVOKED: 'token_revoked',
    REFRESH_FAILED: 'refresh_failed',
  },

  // Embed colors
  COLORS: {
    SUCCESS: 0x57f287,
    ERROR: 0xed4245,
    WARNING: 0xfee75c,
    INFO: 0x5865f2,
    MIGRATION: 0xeb459e,
  },

  // Encryption constants
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',
  IV_LENGTH: 16,
  AUTH_TAG_LENGTH: 16,
};
