const { Router } = require('express');
const config = require('../../config');
const logger = require('../../utils/logger');
const encryption = require('../../services/encryption');
const oauthService = require('../../services/oauth');
const userQueries = require('../../database/queries/users');
const { DISCORD_OAUTH_AUTHORIZE, COLORS } = require('../../utils/constants');

const router = Router();

/**
 * GET /api/oauth/authorize
 *
 * Initiates the OAuth2 flow. The Verify button in Discord directs here.
 * Query params:
 *   - guild_id (optional, from button metadata)
 *   - user_id (optional, from button metadata)
 */
router.get('/authorize', async (req, res) => {
  try {
    const guildId = req.query.guild_id || config.discord.mainGuildId;
    const userId = req.query.user_id || null;

    // Generate CSRF state
    const state = encryption.generateState();
    await userQueries.createOAuthState(state, userId, guildId);

    // Build OAuth2 URL
    const params = new URLSearchParams({
      client_id: config.discord.clientId,
      redirect_uri: config.oauth.redirectUri,
      response_type: 'code',
      scope: config.oauth.scopes.join(' '),
      state,
      prompt: 'consent', // Force consent to ensure we get refresh_token
    });

    const authorizeUrl = `${DISCORD_OAUTH_AUTHORIZE}?${params.toString()}`;
    logger.info('OAuth authorize redirect', { userId, guildId });

    return res.redirect(authorizeUrl);
  } catch (err) {
    logger.error('OAuth authorize error', { error: err.message });
    return res.status(500).send(renderErrorPage('Failed to initiate verification. Please try again.'));
  }
});

/**
 * GET /api/oauth/callback
 *
 * Discord redirects here after the user authorizes.
 * Exchanges code for tokens, stores user, assigns roles.
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle user denial
  if (error) {
    logger.warn('OAuth denied by user', { error, error_description });
    return res.status(400).send(
      renderErrorPage(`Verification cancelled: ${error_description || error}`)
    );
  }

  // Validate required params
  if (!code || !state) {
    logger.warn('OAuth callback missing code or state');
    return res.status(400).send(renderErrorPage('Invalid callback parameters.'));
  }

  try {
    // Validate CSRF state
    const stateRecord = await userQueries.consumeOAuthState(state);
    if (!stateRecord) {
      logger.warn('Invalid or expired OAuth state', { state: state.substring(0, 8) });
      return res.status(400).send(
        renderErrorPage('Verification link expired or already used. Please try again.')
      );
    }

    // Exchange code for tokens
    const tokens = await oauthService.exchangeCode(code);

    // Fetch user info
    const userInfo = await oauthService.fetchUserInfo(tokens.accessToken);
    logger.info('OAuth user identified', { userId: userInfo.id, username: userInfo.username });

    // Encrypt tokens before storage
    const encryptedAccess = encryption.encrypt(tokens.accessToken);
    const encryptedRefresh = encryption.encrypt(tokens.refreshToken);
    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Upsert user in database
    await userQueries.upsertVerifiedUser({
      discordId: userInfo.id,
      username: userInfo.username,
      discriminator: userInfo.discriminator,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      scopes: tokens.scope || config.oauth.scopes.join(' '),
    });

    // Audit log
    await userQueries.writeAuditLog('oauth_verify', userInfo.id, userInfo.id, {
      username: userInfo.username,
      guildId: stateRecord.guild_id,
    });

    // Assign roles in the main guild
    await assignVerifiedRoles(userInfo.id);

    logger.info('User verified successfully via OAuth', {
      userId: userInfo.id,
      username: userInfo.username,
    });

    return res.send(renderSuccessPage(userInfo.username));
  } catch (err) {
    logger.error('OAuth callback error', { error: err.message, stack: err.stack });
    return res.status(500).send(
      renderErrorPage('Verification failed. Please try again or contact an administrator.')
    );
  }
});

/**
 * Assign Verified role and remove Unverified role for a user in the main guild.
 */
async function assignVerifiedRoles(userId) {
  try {
    // Access the Discord client (set during server init)
    const client = require('../../bot/client').getClient();
    if (!client) {
      logger.warn('Discord client not available for role assignment');
      return;
    }

    const guild = client.guilds.cache.get(config.discord.mainGuildId);
    if (!guild) {
      logger.warn('Main guild not in cache', { guildId: config.discord.mainGuildId });
      return;
    }

    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch {
      logger.warn('User not found in guild for role assignment', { userId });
      return;
    }

    // Add Verified role
    if (config.discord.verifiedRoleId && !member.roles.cache.has(config.discord.verifiedRoleId)) {
      await member.roles.add(config.discord.verifiedRoleId, 'OAuth verification completed');
      logger.info('Verified role assigned', { userId });
    }

    // Remove Unverified role
    if (config.discord.unverifiedRoleId && member.roles.cache.has(config.discord.unverifiedRoleId)) {
      await member.roles.remove(config.discord.unverifiedRoleId, 'OAuth verification completed');
      logger.info('Unverified role removed', { userId });
    }
  } catch (err) {
    logger.error('Failed to assign roles', { userId, error: err.message });
    // Don't throw — role assignment failure shouldn't block verification
  }
}

/**
 * Render success HTML page.
 */
function renderSuccessPage(username) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: #16213e;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      max-width: 480px;
    }
    .checkmark { font-size: 4rem; margin-bottom: 1rem; }
    h1 { color: #57f287; margin-bottom: 0.5rem; font-size: 1.5rem; }
    p { color: #a0a0a0; line-height: 1.6; }
    .username { color: #5865f2; font-weight: 600; }
    .close-note { margin-top: 1.5rem; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✅</div>
    <h1>Verification Complete!</h1>
    <p>Welcome, <span class="username">${escapeHtml(username)}</span>!</p>
    <p>Your account has been verified. You can close this tab and return to Discord.</p>
    <p class="close-note">This window can be safely closed.</p>
  </div>
</body>
</html>`;
}

/**
 * Render error HTML page.
 */
function renderErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: #16213e;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      max-width: 480px;
    }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { color: #ed4245; margin-bottom: 0.5rem; font-size: 1.5rem; }
    p { color: #a0a0a0; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">❌</div>
    <h1>Verification Failed</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

module.exports = router;
module.exports.assignVerifiedRoles = assignVerifiedRoles;
