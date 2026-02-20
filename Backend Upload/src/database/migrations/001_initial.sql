-- 001_initial.sql
-- Full schema for Discord verification and migration system

-- Enable UUID extension (available by default on Render PostgreSQL)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- VERIFIED USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS verified_users (
    discord_id          VARCHAR(20)     PRIMARY KEY,
    username            VARCHAR(100),
    discriminator       VARCHAR(10),
    access_token        TEXT,               -- Encrypted at rest via application layer
    refresh_token       TEXT,               -- Encrypted at rest via application layer
    token_expires_at    TIMESTAMPTZ,        -- When the access_token expires
    scopes              TEXT,               -- Space-separated OAuth scopes granted
    manually_verified   BOOLEAN             NOT NULL DEFAULT FALSE,
    verified_at         TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    token_revoked       BOOLEAN             NOT NULL DEFAULT FALSE,
    revoked_at          TIMESTAMPTZ
);

-- Index for migration queries: fetch all verified, non-revoked users
CREATE INDEX IF NOT EXISTS idx_verified_users_active
    ON verified_users (manually_verified, token_revoked)
    WHERE token_revoked = FALSE;

-- Index for token expiry checks during migration
CREATE INDEX IF NOT EXISTS idx_verified_users_token_expiry
    ON verified_users (token_expires_at)
    WHERE manually_verified = FALSE AND token_revoked = FALSE;

-- =============================================
-- MIGRATION RUNS LOG TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS migration_runs (
    id                  SERIAL              PRIMARY KEY,
    target_guild_id     VARCHAR(20)         NOT NULL,
    initiated_by        VARCHAR(20)         NOT NULL,
    started_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    total_users         INTEGER             NOT NULL DEFAULT 0,
    added_count         INTEGER             NOT NULL DEFAULT 0,
    already_in_count    INTEGER             NOT NULL DEFAULT 0,
    failed_count        INTEGER             NOT NULL DEFAULT 0,
    skipped_manual      INTEGER             NOT NULL DEFAULT 0,
    token_revoked_count INTEGER             NOT NULL DEFAULT 0,
    status              VARCHAR(20)         NOT NULL DEFAULT 'running',
    error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_runs_status
    ON migration_runs (status);

CREATE INDEX IF NOT EXISTS idx_migration_runs_guild
    ON migration_runs (target_guild_id);

-- =============================================
-- MIGRATION USER LOG TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS migration_user_log (
    id                  SERIAL              PRIMARY KEY,
    migration_run_id    INTEGER             NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
    discord_id          VARCHAR(20)         NOT NULL,
    status              VARCHAR(30)         NOT NULL,
    error_message       TEXT,
    attempted_at        TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_user_log_run
    ON migration_user_log (migration_run_id);

CREATE INDEX IF NOT EXISTS idx_migration_user_log_status
    ON migration_user_log (status);

-- =============================================
-- OAUTH STATE TABLE (CSRF protection)
-- =============================================
CREATE TABLE IF NOT EXISTS oauth_states (
    state               VARCHAR(64)         PRIMARY KEY,
    discord_id          VARCHAR(20),
    guild_id            VARCHAR(20),
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ         NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used                BOOLEAN             NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry
    ON oauth_states (expires_at);

-- =============================================
-- AUDIT LOG TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS audit_log (
    id                  SERIAL              PRIMARY KEY,
    action              VARCHAR(50)         NOT NULL,
    actor_id            VARCHAR(20),
    target_id           VARCHAR(20),
    details             JSONB,
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action
    ON audit_log (action);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
    ON audit_log (created_at);

-- =============================================
-- FUNCTION: auto-update updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_verified_users_updated_at
    BEFORE UPDATE ON verified_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- CLEANUP: Expired OAuth states (run periodically)
-- =============================================
-- Can be called as: SELECT cleanup_expired_oauth_states();
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM oauth_states WHERE expires_at < NOW() OR used = TRUE;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
