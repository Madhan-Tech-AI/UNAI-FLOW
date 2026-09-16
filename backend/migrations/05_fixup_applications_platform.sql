-- ==============================================================================
-- UNAI FLOW: Fix-up Migration for Applications Platform
-- Fixes:
--   1. Adds missing revoked_at column to api_keys (upgrade from old schema)
--   2. Adds missing columns to api_keys (description, rate_limit_override, environment)
--   3. Drops hard FK on applications.organization_id
-- Safe to run multiple times (all operations are idempotent).
-- ==============================================================================


-- 1. FIX API_KEYS: Add missing columns
DO $fix_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'revoked_at'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN revoked_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN description TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'environment'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN environment TEXT DEFAULT 'live';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'rate_limit_override'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN rate_limit_override INTEGER;
  END IF;
END $fix_keys$;


-- 2. FIX APPLICATIONS: Remove hard FK on organization_id
DO $fix_apps$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'applications_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'applications'
  ) THEN
    ALTER TABLE public.applications DROP CONSTRAINT applications_organization_id_fkey;
  END IF;
END $fix_apps$;
