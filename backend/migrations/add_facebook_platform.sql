-- Run this SQL in Supabase SQL Editor to add 'facebook' to the platform check constraint

-- 1. Drop the existing check constraint on platform_connections.platform
ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;

-- 2. Re-add with 'facebook' included
ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('whatsapp','instagram','twitter','facebook'));
