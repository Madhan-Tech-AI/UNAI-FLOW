-- Migration: Add ownership and metadata columns to whatsapp_channels
-- Run this against your Supabase database

-- Add new columns for ownership verification and channel metadata
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS description text DEFAULT '';
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS is_owned boolean DEFAULT false;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS can_publish boolean DEFAULT false;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified';
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS verification_method text;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS last_discovered_at timestamptz;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS metadata_updated_at timestamptz;

-- Update existing channels to populate the new columns from metadata JSONB
UPDATE whatsapp_channels
SET
    is_owned = COALESCE((metadata->>'is_owned')::boolean, false),
    is_admin = COALESCE((metadata->>'is_admin')::boolean, false),
    can_publish = COALESCE((metadata->>'can_publish')::boolean, false),
    avatar_url = COALESCE(metadata->>'picture_url', ''),
    description = COALESCE(metadata->>'description', ''),
    last_discovered_at = NOW()
WHERE metadata IS NOT NULL AND metadata != 'null'::jsonb;

-- Set verification_status for channels that already have publish rights
UPDATE whatsapp_channels
SET verification_status = 'verified', verification_method = 'session_admin_access'
WHERE can_publish = true OR is_owned = true OR is_admin = true;
