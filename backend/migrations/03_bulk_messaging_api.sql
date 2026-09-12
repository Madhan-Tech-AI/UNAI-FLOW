-- ==============================================================================
-- UNAI FLOW: Bulk Messaging API Platform Migration
-- Adds campaign management, usage analytics, webhook delivery logging,
-- and extends API keys with environment/rate-limit support.
-- Safe for fresh databases AND upgrading existing schemas.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTEND API KEYS: Add environment and rate_limit_override columns
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'environment'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN environment TEXT NOT NULL DEFAULT 'live';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'rate_limit_override'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN rate_limit_override INT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.api_keys ADD COLUMN description TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_keys_environment ON public.api_keys(environment);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. API CAMPAIGNS (WhatsApp Bulk Messaging Campaigns)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,

  -- Campaign metadata
  name TEXT NOT NULL,
  description TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Status lifecycle: draft → queued → sending → completed | partial_failure | failed | cancelled
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'queued', 'sending', 'completed', 'partial_failure', 'failed', 'cancelled'
  )),

  -- Aggregate counters (updated by campaign worker)
  total_recipients INT NOT NULL DEFAULT 0,
  queued_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,

  -- Rate control
  messages_per_second NUMERIC(5, 2) DEFAULT 1.0,

  -- Idempotency
  idempotency_key TEXT UNIQUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  launched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_campaigns_org ON public.api_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_campaigns_status ON public.api_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_api_campaigns_api_key ON public.api_campaigns(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_campaigns_created_at ON public.api_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_campaigns_idempotency ON public.api_campaigns(idempotency_key);

ALTER TABLE public.api_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage api campaigns" ON public.api_campaigns;
CREATE POLICY "Org members can manage api campaigns" ON public.api_campaigns
  FOR ALL USING (true);

-- Auto updated_at trigger
DROP TRIGGER IF EXISTS trg_api_campaigns_updated_at ON public.api_campaigns;
CREATE TRIGGER trg_api_campaigns_updated_at
  BEFORE UPDATE ON public.api_campaigns
  FOR EACH ROW EXECUTE PROCEDURE public.set_whapi_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. API CAMPAIGN RECIPIENTS (Per-recipient delivery tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.api_campaigns(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Recipient info
  recipient_jid TEXT NOT NULL,
  recipient_name TEXT,
  variables JSONB DEFAULT '{}'::jsonb,

  -- Status lifecycle: pending → queued → sending → sent → delivered | failed
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled'
  )),

  -- Provider tracking
  provider_message_id TEXT,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,

  -- Timestamps
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate recipients in a campaign
  CONSTRAINT uq_campaign_recipient_jid UNIQUE (campaign_id, recipient_jid)
);

CREATE INDEX IF NOT EXISTS idx_api_campaign_recipients_campaign ON public.api_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_api_campaign_recipients_status ON public.api_campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_api_campaign_recipients_org ON public.api_campaign_recipients(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_campaign_recipients_jid ON public.api_campaign_recipients(recipient_jid);

ALTER TABLE public.api_campaign_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage campaign recipients" ON public.api_campaign_recipients;
CREATE POLICY "Org members can manage campaign recipients" ON public.api_campaign_recipients
  FOR ALL USING (true);

-- Auto updated_at trigger
DROP TRIGGER IF EXISTS trg_api_campaign_recipients_updated_at ON public.api_campaign_recipients;
CREATE TRIGGER trg_api_campaign_recipients_updated_at
  BEFORE UPDATE ON public.api_campaign_recipients
  FOR EACH ROW EXECUTE PROCEDURE public.set_whapi_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. API REQUEST LOG (Usage analytics & audit trail)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_request_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,

  -- Request metadata
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INT NOT NULL,
  latency_ms INT,
  request_size_bytes INT,
  response_size_bytes INT,

  -- Context
  ip_address TEXT,
  user_agent TEXT,
  idempotency_key TEXT,
  request_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partitioned index for efficient time-range queries
CREATE INDEX IF NOT EXISTS idx_api_request_log_org_created ON public.api_request_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_api_key ON public.api_request_log(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_log_path ON public.api_request_log(path);
CREATE INDEX IF NOT EXISTS idx_api_request_log_created_at ON public.api_request_log(created_at DESC);

ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view request logs" ON public.api_request_log;
CREATE POLICY "Org members can view request logs" ON public.api_request_log
  FOR ALL USING (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. WEBHOOK DELIVERY LOG (Delivery attempt auditing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,

  -- Delivery tracking
  attempt_number INT NOT NULL DEFAULT 1,
  status_code INT,
  response_body TEXT,
  error_message TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  latency_ms INT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_webhook ON public.webhook_delivery_log(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_event ON public.webhook_delivery_log(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_created ON public.webhook_delivery_log(created_at DESC);

ALTER TABLE public.webhook_delivery_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view webhook delivery logs" ON public.webhook_delivery_log;
CREATE POLICY "Org members can view webhook delivery logs" ON public.webhook_delivery_log
  FOR ALL USING (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. EXTEND WEBHOOKS: Add failure tracking columns
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'consecutive_failures'
  ) THEN
    ALTER TABLE public.webhooks ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'disabled_at'
  ) THEN
    ALTER TABLE public.webhooks ADD COLUMN disabled_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'last_triggered_at'
  ) THEN
    ALTER TABLE public.webhooks ADD COLUMN last_triggered_at TIMESTAMPTZ;
  END IF;
END $$;
