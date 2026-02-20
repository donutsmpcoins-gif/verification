require('dotenv').config();

const requiredVars = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'OWNER_ID',
  'MAIN_GUILD_ID',
  'VERIFIED_ROLE_ID',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'BASE_URL',
];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`FATAL: Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

// Validate ENCRYPTION_KEY is 64 hex chars (32 bytes)
if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
  console.error('FATAL: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
  process.exit(1);
}

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    ownerIds: process.env.OWNER_ID.split(',').map((id) => id.trim()),
    mainGuildId: process.env.MAIN_GUILD_ID,
    verifiedRoleId: process.env.VERIFIED_ROLE_ID,
    unverifiedRoleId: process.env.UNVERIFIED_ROLE_ID || null,
    verifyChannelId: process.env.VERIFY_CHANNEL_ID || null,
  },
  database: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT || '5000', 10),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    baseUrl: process.env.BASE_URL.replace(/\/$/, ''),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
  oauth: {
    redirectUri: `${process.env.BASE_URL.replace(/\/$/, '')}/api/oauth/callback`,
    scopes: ['identify', 'guilds.join'],
  },
  migration: {
    concurrency: parseInt(process.env.MIGRATION_CONCURRENCY || '5', 10),
    retryAttempts: parseInt(process.env.MIGRATION_RETRY_ATTEMPTS || '3', 10),
    progressInterval: parseInt(process.env.MIGRATION_PROGRESS_INTERVAL || '25', 10),
  },
};

module.exports = config;
