# Discord Verification & Migration System

Production-grade Discord OAuth2 verification system with automated server migration.

## Architecture

```
├── render.yaml                 # Render deployment blueprint
├── package.json
├── .env.example                # Environment variable template
├── .gitignore
└── src/
    ├── index.js                # Application entry point
    ├── config/
    │   └── index.js            # Centralized configuration
    ├── database/
    │   ├── pool.js             # PostgreSQL connection pool
    │   ├── migrate.js          # Migration runner
    │   ├── migrations/
    │   │   └── 001_initial.sql # Full schema
    │   └── queries/
    │       └── users.js        # All database queries
    ├── bot/
    │   ├── client.js           # Discord.js client setup
    │   ├── commands/
    │   │   ├── deploy.js       # Slash command deployment
    │   │   ├── verify.js       # /verify <userid> command
    │   │   ├── setup.js        # /setup [channel] command
    │   │   └── stats.js        # /stats command
    │   ├── events/
    │   │   ├── ready.js        # Bot ready handler
    │   │   ├── interactionCreate.js
    │   │   ├── guildMemberAdd.js
    │   │   └── messageCreate.js  # ?pull command handler
    │   └── buttons/
    │       └── verify.js       # Verify button handler
    ├── web/
    │   ├── server.js           # Express server
    │   ├── routes/
    │   │   ├── oauth.js        # OAuth2 flow routes
    │   │   └── health.js       # Health check endpoints
    │   └── middleware/
    │       └── errorHandler.js # Global error handler
    ├── services/
    │   ├── oauth.js            # OAuth2 token management
    │   ├── migration.js        # Migration engine
    │   └── encryption.js       # AES-256-GCM encryption
    └── utils/
        ├── logger.js           # Winston logging
        ├── rateLimiter.js      # Rate limiter & retry logic
        └── constants.js        # Shared constants
```

---

## Discord Developer Portal Setup

### 1. Create Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** → Name it → Create
3. Copy the **Application ID** (this is your `DISCORD_CLIENT_ID`)

### 2. Configure OAuth2

1. Go to **OAuth2** → **General**
2. Copy the **Client Secret** (this is `DISCORD_CLIENT_SECRET`)
3. Under **Redirects**, add:
   ```
   https://your-app-name.onrender.com/api/oauth/callback
   ```
   (Replace `your-app-name` with your actual Render service name)

### 3. Set OAuth2 Scopes

Under **OAuth2** → **URL Generator**, select:
- `identify` — Read user identity
- `guilds.join` — Add users to guilds

### 4. Create Bot

1. Go to **Bot** tab → **Add Bot** → Confirm
2. Copy the **Bot Token** (`DISCORD_TOKEN`)
3. Enable these **Privileged Gateway Intents**:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
4. Disable **Public Bot** (optional, recommended)

### 5. Invite Bot to Your Servers

Use this URL pattern (replace `CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=268435456&scope=bot%20applications.commands
```

**Required bot permissions** (numeric: `268435456`):
- Manage Roles
- Create Instant Invite

**Additional recommended permissions:**
- Send Messages
- Embed Links
- Read Message History
- Use External Emojis

> **IMPORTANT:** The bot must be invited to BOTH the main server AND any target migration servers.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Bot token from Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | Application/Client ID |
| `DISCORD_CLIENT_SECRET` | ✅ | OAuth2 Client Secret |
| `OWNER_ID` | ✅ | Your Discord user ID |
| `MAIN_GUILD_ID` | ✅ | Primary server ID |
| `VERIFIED_ROLE_ID` | ✅ | Role to assign on verification |
| `UNVERIFIED_ROLE_ID` | ❌ | Role to remove on verification |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `BASE_URL` | ✅ | Public URL (e.g., `https://app.onrender.com`) |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars (32 bytes) for AES-256 |
| `PORT` | ❌ | Server port (default: 3000) |
| `NODE_ENV` | ❌ | `production` or `development` |
| `MIGRATION_CONCURRENCY` | ❌ | Joins/sec during migration (default: 5) |
| `MIGRATION_RETRY_ATTEMPTS` | ❌ | Retries on failure (default: 3) |
| `MIGRATION_PROGRESS_INTERVAL` | ❌ | Progress update frequency (default: 25) |

### Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Deployment on Render

### Option A: Blueprint (Recommended)

1. Push code to a GitHub repository
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **New** → **Blueprint**
4. Connect your repo → Render reads `render.yaml` automatically
5. Fill in the environment variables marked `sync: false`
6. Deploy

### Option B: Manual Setup

1. **Create PostgreSQL Database:**
   - Render Dashboard → New → PostgreSQL
   - Copy the **Internal Database URL**

2. **Create Web Service:**
   - Render Dashboard → New → Web Service
   - Connect GitHub repo
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`

3. **Set Environment Variables:**
   - Add all variables from the table above
   - Set `DATABASE_URL` to the PostgreSQL internal URL

4. **Set Redirect URI:**
   - After deploy, your URL will be `https://your-service.onrender.com`
   - Go to Discord Developer Portal → OAuth2 → Redirects
   - Add: `https://your-service.onrender.com/api/oauth/callback`
   - Update `BASE_URL` env var to match

---

## Usage

### Initial Setup

1. Deploy to Render (database schema auto-migrates on startup)
2. The bot will auto-deploy slash commands on startup
3. Run `/setup` or `/setup #channel` to send the verification panel

### Verification Flow

1. User clicks **✅ Verify** button in the verification channel
2. Button opens an ephemeral message with a **Verify Now** link
3. User is redirected to Discord's OAuth2 consent screen
4. After authorizing, tokens are encrypted and stored in PostgreSQL
5. User receives the **Verified** role automatically

### Manual Verification

```
/verify <userid>
```
- Owner-only
- Marks user as verified without OAuth
- These users CANNOT be auto-migrated (no tokens)

### Migration

```
?pull <newGuildId>
```
- Owner-only (prefix command in any channel the bot can see)
- Bot must already be in the target guild
- Processes all verified users:
  - **OAuth users:** Refreshes tokens and adds to guild via API
  - **Manual users:** Skipped (logged)
- Shows real-time progress bar in Discord
- Handles rate limits, retries, and resume on interruption

### Statistics

```
/stats
```
- Shows verification counts and migration readiness

---

## Security Implementation

### Token Encryption at Rest
- All OAuth access/refresh tokens encrypted with **AES-256-GCM**
- Each token uses a unique random IV (16 bytes)
- Authenticated encryption prevents tampering (auth tag)
- Encryption key stored as env var, never in code

### Refresh Token Rotation
- Tokens refreshed automatically when within 1 hour of expiry
- New refresh token stored on each rotation (Discord rotates them)
- Failed refreshes mark the token as revoked

### CSRF Protection
- OAuth state parameter with 32-byte random tokens
- States expire after 10 minutes
- Single-use (consumed on callback)

### Rate Limiting
- Express: 30 OAuth attempts / 15 min per IP
- Migration: Configurable concurrency (default 5/sec)
- Discord API: 429 responses handled with retry-after
- Exponential backoff with jitter on retries

### Owner-Only Commands
- All sensitive commands check `interaction.user.id === OWNER_ID`
- Prefix command `?pull` also owner-gated

### Error Handling
- All errors logged with Winston (structured JSON in prod)
- Express global error handler prevents stack trace leaks
- Database queries wrapped with error logging
- Graceful shutdown on SIGTERM/SIGINT

### Migration Resume
- Each migration run tracked in `migration_runs` table
- Each user attempt logged in `migration_user_log`
- If a `?pull` targets a guild with an incomplete run, it resumes
- Already-processed users are skipped

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `verified_users` | Core user data with encrypted tokens |
| `migration_runs` | Migration execution history |
| `migration_user_log` | Per-user migration results |
| `oauth_states` | CSRF state tokens (auto-cleaned) |
| `audit_log` | All admin actions logged as JSONB |
| `_migrations` | Schema version tracking |

### Key Indexes

- `idx_verified_users_active` — Fast lookup of non-revoked users
- `idx_verified_users_token_expiry` — Token refresh candidates
- `idx_migration_runs_status` — Find incomplete migrations
- `idx_audit_log_created` — Time-based audit queries

---

## Troubleshooting

### Bot not assigning roles
- Ensure the bot's role is **above** the Verified/Unverified roles in server settings
- Check bot has **Manage Roles** permission

### OAuth callback failing
- Verify `BASE_URL` matches your Render domain exactly
- Verify redirect URI in Developer Portal matches `BASE_URL/api/oauth/callback`
- Check `DISCORD_CLIENT_SECRET` is correct

### Migration failing
- Bot must be in the target guild before running `?pull`
- Tokens expire after ~7 days without refresh — run migrations promptly after verification
- Users who revoked your app's access will appear as "token_revoked"

### Database connection errors
- On Render, use the **Internal Database URL** (not external)
- Ensure `DATABASE_URL` includes `?sslmode=require` if needed

---

## License

ISC
