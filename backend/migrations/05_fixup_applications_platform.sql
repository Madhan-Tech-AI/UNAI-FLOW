-- ==============================================================================
-- UNAI FLOW: Fix-up Migration for Applications Platform & Multi-Tenancy
-- Fixes:
--   1. Adds missing revoked_at column to api_keys (upgrade from old schema)
--   2. Adds missing columns to api_keys (description, rate_limit_override, environment)
--   3. Drops rigid foreign keys referencing public.organizations(id)
--      (because UNAI FLOW uses auth.users.id as organization_id)
--   4. Configures RLS policies for organizations table
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


-- 2. DROP RIGID ORGANIZATIONS FOREIGN KEYS
-- Allows auth.users.id to be used safely as organization_id without FK failures
DO $drop_fks$
BEGIN
  -- Drop FK on applications
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'applications_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'applications'
  ) THEN
    ALTER TABLE public.applications DROP CONSTRAINT applications_organization_id_fkey;
  END IF;

  -- Drop FK on api_keys
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'api_keys_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'api_keys'
  ) THEN
    ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_organization_id_fkey;
  END IF;

  -- Drop FK on webhooks
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'webhooks_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'webhooks'
  ) THEN
    ALTER TABLE public.webhooks DROP CONSTRAINT webhooks_organization_id_fkey;
  END IF;

  -- Drop FK on api_campaigns
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'api_campaigns_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'api_campaigns'
  ) THEN
    ALTER TABLE public.api_campaigns DROP CONSTRAINT api_campaigns_organization_id_fkey;
  END IF;

  -- Drop FK on whatsapp_instances
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'whatsapp_instances_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'whatsapp_instances'
  ) THEN
    ALTER TABLE public.whatsapp_instances DROP CONSTRAINT whatsapp_instances_organization_id_fkey;
  END IF;

  -- Drop FK on social_connections
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'social_connections_organization_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'social_connections'
  ) THEN
    ALTER TABLE public.social_connections DROP CONSTRAINT social_connections_organization_id_fkey;
  END IF;
END $drop_fks$;


-- 3. ENSURE ORGANIZATIONS TABLE POLICIES
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all access for organizations" ON public.organizations;
CREATE POLICY "Enable all access for organizations" ON public.organizations
  FOR ALL USING (true);
