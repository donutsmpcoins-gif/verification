const { request } = require('undici');
const config = require('../config');
const logger = require('../utils/logger');
const encryption = require('./encryption');
const userQueries = require('../database/queries/users');
const {
  DISCORD_API_BASE,
  DISCORD_OAUTH_TOKEN,
  TOKEN_REFRESH_BUFFER_SECONDS,
} = require('../utils/constants');

/**
 * Exchange an OAuth2 authorization code for tokens.
 */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauth.redirectUri,
  });

  const response = await request(DISCORD_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.body.json();

  if (response.statusCode !== 200) {
    logger.error('Token exchange failed', {
      status: response.statusCode,
      error: data.error,
      description: data.error_description,
    });
    throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

/**
 * Refresh an OAuth2 access token.
 */
async function refreshToken(encryptedRefreshToken) {
  const decryptedRefresh = encryption.decrypt(encryptedRefreshToken);

  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: decryptedRefresh,
  });

  const response = await request(DISCORD_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.body.json();

  if (response.statusCode !== 200) {
    logger.error('Token refresh failed', {
      status: response.statusCode,
      error: data.error,
      description: data.error_description,
    });
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/**
 * Fetch the Discord user profile using an access token.
 */
async function fetchUserInfo(accessToken) {
  const response = await request(`${DISCORD_API_BASE}/users/@me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.body.json();

  if (response.statusCode !== 200) {
    logger.error('Failed to fetch user info', { status: response.statusCode });
    throw new Error('Failed to fetch user info');
  }

  return {
    id: data.id,
    username: data.username,
    discriminator: data.discriminator || '0',
    globalName: data.global_name,
  };
}

/**
 * Check if a token needs refreshing and refresh if necessary.
 * Returns the (possibly new) decrypted access token.
 */
async function ensureFreshToken(user) {
  const now = new Date();
  const expiresAt = new Date(user.token_expires_at);
  const bufferMs = TOKEN_REFRESH_BUFFER_SECONDS * 1000;

  // If token hasn't expired yet (with buffer), return the current one
  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return encryption.decrypt(user.access_token);
  }

  logger.info('Refreshing token for user', { discordId: user.discord_id });

  try {
    const newTokens = await refreshToken(user.refresh_token);

    const encryptedAccess = encryption.encrypt(newTokens.accessToken);
    const encryptedRefresh = encryption.encrypt(newTokens.refreshToken);
    const newExpiresAt = new Date(Date.now() + newTokens.expiresIn * 1000);

    await userQueries.updateTokens(user.discord_id, {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt: newExpiresAt,
    });

    logger.info('Token refreshed successfully', { discordId: user.discord_id });
    return newTokens.accessToken;
  } catch (err) {
    // If refresh fails, mark as revoked
    if (
      err.message.includes('invalid_grant') ||
      err.message.includes('revoked')
    ) {
      await userQueries.markTokenRevoked(user.discord_id);
      logger.warn('Token revoked during refresh', { discordId: user.discord_id });
      throw new Error('TOKEN_REVOKED');
    }
    throw err;
  }
}

/**
 * Add a user to a guild using their OAuth2 access token.
 * Uses PUT /guilds/{guild.id}/members/{user.id}
 */
async function addUserToGuild(guildId, userId, accessToken) {
  const response = await request(
    `${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${config.discord.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    }
  );

  // 201 = user added, 204 = user already in guild
  if (response.statusCode === 201) {
    return { status: 'added' };
  }

  if (response.statusCode === 204) {
    return { status: 'already_in_server' };
  }

  // Handle rate limits
  if (response.statusCode === 429) {
    const data = await response.body.json();
    const retryAfter = data.retry_after || 5;
    logger.warn('Rate limited on guild join', { guildId, userId, retryAfter });
    return { status: 'rate_limited', retryAfter };
  }

  // Other errors
  let errorData;
  try {
    errorData = await response.body.json();
  } catch {
    errorData = { message: 'Unknown error' };
  }

  logger.error('Failed to add user to guild', {
    guildId,
    userId,
    status: response.statusCode,
    error: errorData,
  });

  return {
    status: 'failed',
    statusCode: response.statusCode,
    error: errorData.message || JSON.stringify(errorData),
  };
}

module.exports = {
  exchangeCode,
  refreshToken,
  fetchUserInfo,
  ensureFreshToken,
  addUserToGuild,
};
