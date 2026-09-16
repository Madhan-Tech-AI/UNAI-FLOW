-- ==============================================================================
-- UNAI FLOW: Fix-up Migration for Applications Platform
-- Fixes:
--   1. Adds missing `revoked_at` column to `api_keys` (upgrade from old schema)
--   2. Adds missing columns to `api_keys` (description, rate_limit_override, environment)
--   3. Drops hard FK on `applications.organization_id` → uses soft UUID reference
--      (because the system uses auth.users.id as org_id, which may not be in organizations)
-- Safe to run multiple times (all operations are idempotent).
-- ==============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FIX API_KEYS: Add missing columns from 02_whapi_gateway_schema upgrade path
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- revoked_at: Defined in CREATE TABLE but missing in DO$$ upgrade block of 02_whapi
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'revoked_at'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN revoked_at TIMESTAMPTZ;
  END IF;

  -- description: Used by api_key_service but never migrated
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN description TEXT;
  END IF;

  -- environment: live/test partitioning
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'environment'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN environment TEXT DEFAULT 'live';
  END IF;

  -- rate_limit_override: Per-key rate limit override
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'rate_limit_override'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN rate_limit_override INTEGER;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FIX APPLICATIONS: Remove hard FK on organization_id
--    The system uses auth.users.id as organization_id, which may not exist
--    in the `organizations` table. Switch to a soft UUID reference.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Drop the FK constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'applications_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'applications'
  ) THEN
    ALTER TABLE public.applications DROP CONSTRAINT applications_organization_id_fkey;
  END IF;
END $$;
