-- ==============================================================================
-- UNAI FLOW: Developer Application / Integration Platform Migration
-- Introduces the Application entity and links existing tables to it.
-- Safe for fresh databases AND upgrading existing schemas.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. APPLICATIONS (Developer Integrations / CRM Credentials)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,                        -- auth.users.id used as org_id

  -- Application identity
  client_id           TEXT NOT NULL UNIQUE,               -- e.g. "unai_client_8f92a3b4c5d6e7f8"
  name                TEXT NOT NULL,
  description         TEXT,

  -- Configuration
  environment         TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  default_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  scopes              JSONB NOT NULL DEFAULT '["messages:send","campaigns:read","campaigns:write","usage:read"]'::jsonb,

  -- Quotas (placeholder for future enforcement)
  quotas              JSONB DEFAULT '{}'::jsonb,

  -- Webhook signing secret for this application
  webhook_secret      TEXT,

  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_org ON public.applications(organization_id);
CREATE INDEX IF NOT EXISTS idx_applications_client_id ON public.applications(client_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(status);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage applications" ON public.applications;
CREATE POLICY "Org members can manage applications" ON public.applications
  FOR ALL USING (true);

-- Auto updated_at trigger
DROP TRIGGER IF EXISTS trg_applications_updated_at ON public.applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE PROCEDURE public.set_whapi_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EXTEND API KEYS: Add application_id FK (nullable for backward compat)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'application_id'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_keys_application ON public.api_keys(application_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EXTEND WEBHOOKS: Add application_id FK (nullable for backward compat)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'application_id'
  ) THEN
    ALTER TABLE public.webhooks ADD COLUMN application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_webhooks_application ON public.webhooks(application_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. EXTEND API CAMPAIGNS: Add application_id FK
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_campaigns' AND column_name = 'application_id'
  ) THEN
    ALTER TABLE public.api_campaigns ADD COLUMN application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_campaigns_application ON public.api_campaigns(application_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. EXTEND API REQUEST LOG: Add application_id column
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_request_log' AND column_name = 'application_id'
  ) THEN
    ALTER TABLE public.api_request_log ADD COLUMN application_id UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_request_log_application ON public.api_request_log(application_id);
