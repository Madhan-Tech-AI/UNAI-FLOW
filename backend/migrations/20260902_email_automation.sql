-- ==============================================================================
-- UNAI FLOW: Production Email Automation Module Migration
-- ==============================================================================

-- 1. EMAIL CAMPAIGNS TABLE
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT 'UNAI Flow',
  reply_to TEXT,
  html_body TEXT NOT NULL,
  text_body TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'queued', 'sending', 'completed', 'partial_failure', 'failed', 'cancelled'
  )),
  total_recipients INT NOT NULL DEFAULT 0,
  queued_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  bounced_count INT NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON public.email_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON public.email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_at ON public.email_campaigns(created_at DESC);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own email campaigns" ON public.email_campaigns;
CREATE POLICY "Users can manage own email campaigns" ON public.email_campaigns
  FOR ALL USING (auth.uid() = user_id);


-- 2. EMAIL RECIPIENTS TABLE (IDEMPOTENT PER CAMPAIGN)
CREATE TABLE IF NOT EXISTS public.email_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'complained', 'cancelled'
  )),
  provider_message_id TEXT,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  variables JSONB DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_campaign_recipient_email UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign_id ON public.email_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_recipients_status ON public.email_recipients(status);
CREATE INDEX IF NOT EXISTS idx_email_recipients_email ON public.email_recipients(email);
CREATE INDEX IF NOT EXISTS idx_email_recipients_provider_msg_id ON public.email_recipients(provider_message_id);

ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own email recipients" ON public.email_recipients;
CREATE POLICY "Users can manage own email recipients" ON public.email_recipients
  FOR ALL USING (auth.uid() = user_id);


-- 3. EMAIL SUPPRESSIONS TABLE (UNSUBSCRIBED / BOUNCED / COMPLAINTS)
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained', 'manual')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_suppressed_email UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_user_email ON public.email_suppressions(user_id, email);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own email suppressions" ON public.email_suppressions;
CREATE POLICY "Users can manage own email suppressions" ON public.email_suppressions
  FOR ALL USING (auth.uid() = user_id);


-- 4. EMAIL WEBHOOK EVENTS TABLE (DELIVERY AUDIT LOG)
CREATE TABLE IF NOT EXISTS public.email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES public.email_recipients(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_campaign ON public.email_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_events_type ON public.email_events(event_type);
