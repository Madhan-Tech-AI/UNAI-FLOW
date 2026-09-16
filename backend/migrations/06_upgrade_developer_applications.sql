-- Migration: 06_upgrade_developer_applications.sql
-- Description: Adds developer application credentials, OAuth identifiers,
--              WhatsApp mobile number association, and audit timestamps.

ALTER TABLE applications
ADD COLUMN IF NOT EXISTS client_secret_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS client_secret_preview VARCHAR(64),
ADD COLUMN IF NOT EXISTS oauth_client_id VARCHAR(128),
ADD COLUMN IF NOT EXISTS oauth_client_secret_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(32),
ADD COLUMN IF NOT EXISTS whatsapp_session_id VARCHAR(128),
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Create index on client_id for ultra-fast lookup
CREATE INDEX IF NOT EXISTS idx_applications_client_id ON applications(client_id);

-- Create index on oauth_client_id
CREATE INDEX IF NOT EXISTS idx_applications_oauth_client_id ON applications(oauth_client_id);

-- Create index on whatsapp_number
CREATE INDEX IF NOT EXISTS idx_applications_whatsapp_number ON applications(whatsapp_number);

COMMENT ON COLUMN applications.client_secret_hash IS 'SHA-256 hash of the application client secret for API authentication';
COMMENT ON COLUMN applications.client_secret_preview IS 'Masked preview string (e.g. unai_sec_••••••••••••3a9f) safe for frontend display';
COMMENT ON COLUMN applications.oauth_client_id IS 'Public OAuth 2.0 client identifier';
COMMENT ON COLUMN applications.oauth_client_secret_hash IS 'SHA-256 hash of the OAuth client secret';
COMMENT ON COLUMN applications.whatsapp_number IS 'Associated WhatsApp mobile phone number in E.164 format (e.g. +919876543210)';
COMMENT ON COLUMN applications.whatsapp_session_id IS 'Associated WhatsApp session reference in whatsapp_sessions';
COMMENT ON COLUMN applications.last_used_at IS 'Timestamp of the most recent API call made with this application credentials';
