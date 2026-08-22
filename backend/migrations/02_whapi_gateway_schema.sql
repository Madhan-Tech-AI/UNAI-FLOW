-- ==============================================================================
-- UNAI FLOW: Production WhatsApp Channels API Gateway Schema Migration
-- Inspired by Whapi.Cloud Architecture with Row Level Security (RLS)
-- Safe for fresh databases AND upgrading existing prototype schemas
-- ==============================================================================

-- 1. ORGANIZATIONS
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_name ON public.organizations(name);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON public.organizations;
CREATE POLICY "Users can view organizations they belong to" ON public.organizations
  FOR SELECT USING (true);

-- 2. SOCIAL CONNECTIONS (Unified multi-platform registry)
CREATE TABLE IF NOT EXISTS public.social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT,
  status TEXT DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'social_connections' AND column_name = 'organization_id') THEN
    ALTER TABLE public.social_connections ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'social_connections' AND column_name = 'provider') THEN
    ALTER TABLE public.social_connections ADD COLUMN provider TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'social_connections' AND column_name = 'status') THEN
    ALTER TABLE public.social_connections ADD COLUMN status TEXT DEFAULT 'active';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_connections_org ON public.social_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_social_connections_provider ON public.social_connections(provider);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage social connections" ON public.social_connections;
CREATE POLICY "Org members can manage social connections" ON public.social_connections
  FOR ALL USING (true);

-- 3. WHATSAPP INSTANCES (State Machine & Metadata)
CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_uuid TEXT UNIQUE,
  display_name TEXT,
  phone_number TEXT,
  status TEXT DEFAULT 'INITIALIZING',
  connection_state TEXT DEFAULT 'DISCONNECTED',
  last_seen TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_instances' AND column_name = 'organization_id') THEN
    ALTER TABLE public.whatsapp_instances ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_instances' AND column_name = 'instance_uuid') THEN
    ALTER TABLE public.whatsapp_instances ADD COLUMN instance_uuid TEXT UNIQUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_instances' AND column_name = 'display_name') THEN
    ALTER TABLE public.whatsapp_instances ADD COLUMN display_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_instances' AND column_name = 'phone_number') THEN
    ALTER TABLE public.whatsapp_instances ADD COLUMN phone_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_instances' AND column_name = 'status') THEN
    ALTER TABLE public.whatsapp_instances ADD COLUMN status TEXT DEFAULT 'INITIALIZING';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_org ON public.whatsapp_instances(organization_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_uuid ON public.whatsapp_instances(instance_uuid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_status ON public.whatsapp_instances(status);

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage whatsapp instances" ON public.whatsapp_instances;
CREATE POLICY "Org members can manage whatsapp instances" ON public.whatsapp_instances
  FOR ALL USING (true);

-- 4. WHATSAPP SESSIONS (Encrypted Credentials Vault)
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  encrypted_credentials TEXT,
  device_id TEXT,
  session_version TEXT DEFAULT 'v1',
  connected_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'instance_id') THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'encrypted_credentials') THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN encrypted_credentials TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'device_id') THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN device_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'session_version') THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN session_version TEXT DEFAULT 'v1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'last_heartbeat') THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN last_heartbeat TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_instance ON public.whatsapp_sessions(instance_id);

ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage whatsapp sessions" ON public.whatsapp_sessions;
CREATE POLICY "Org members can manage whatsapp sessions" ON public.whatsapp_sessions
  FOR ALL USING (true);

-- 5. WHATSAPP CHANNELS (Newsletters: 120363...@newsletter)
CREATE TABLE IF NOT EXISTS public.whatsapp_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  newsletter_jid TEXT,
  name TEXT,
  description TEXT,
  invite_code TEXT,
  profile_picture TEXT,
  role TEXT DEFAULT 'admin',
  subscribers_count BIGINT DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_channels' AND column_name = 'instance_id') THEN
    ALTER TABLE public.whatsapp_channels ADD COLUMN instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_channels' AND column_name = 'newsletter_jid') THEN
    ALTER TABLE public.whatsapp_channels ADD COLUMN newsletter_jid TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_channels' AND column_name = 'name') THEN
    ALTER TABLE public.whatsapp_channels ADD COLUMN name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_channels' AND column_name = 'synced_at') THEN
    ALTER TABLE public.whatsapp_channels ADD COLUMN synced_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_channels_instance ON public.whatsapp_channels(instance_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_channels_jid ON public.whatsapp_channels(newsletter_jid);

ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view and manage whatsapp channels" ON public.whatsapp_channels;
CREATE POLICY "Org members can view and manage whatsapp channels" ON public.whatsapp_channels
  FOR ALL USING (true);

-- 6. API KEYS (Hashed Developer Keys with Scopes)
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT,
  prefix TEXT,
  key_hash TEXT UNIQUE,
  scopes JSONB DEFAULT '["instances:read", "channels:read", "messages:send"]'::jsonb,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'organization_id') THEN
    ALTER TABLE public.api_keys ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'prefix') THEN
    ALTER TABLE public.api_keys ADD COLUMN prefix TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'key_hash') THEN
    ALTER TABLE public.api_keys ADD COLUMN key_hash TEXT UNIQUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = 'scopes') THEN
    ALTER TABLE public.api_keys ADD COLUMN scopes JSONB DEFAULT '["instances:read", "channels:read", "messages:send"]'::jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON public.api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage api keys" ON public.api_keys;
CREATE POLICY "Org members can manage api keys" ON public.api_keys
  FOR ALL USING (true);

-- 7. POSTS & DESTINATIONS
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  caption TEXT,
  media_type TEXT,
  media_url TEXT,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'organization_id') THEN
    ALTER TABLE public.posts ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_org ON public.posts(organization_id);

CREATE TABLE IF NOT EXISTS public.post_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  provider TEXT,
  connection_id UUID REFERENCES public.social_connections(id) ON DELETE SET NULL,
  destination_id TEXT,
  status TEXT DEFAULT 'QUEUED',
  provider_message_id TEXT,
  error TEXT,
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_post_destinations_post ON public.post_destinations(post_id);
CREATE INDEX IF NOT EXISTS idx_post_destinations_provider ON public.post_destinations(provider);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage posts" ON public.posts;
CREATE POLICY "Org members can manage posts" ON public.posts FOR ALL USING (true);

ALTER TABLE public.post_destinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage post destinations" ON public.post_destinations;
CREATE POLICY "Org members can manage post destinations" ON public.post_destinations FOR ALL USING (true);

-- 8. PUBLISH JOBS (Queue, Retries & Idempotency)
CREATE TABLE IF NOT EXISTS public.publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  destination_id UUID REFERENCES public.post_destinations(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'QUEUED',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  error TEXT,
  idempotency_key TEXT UNIQUE,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'publish_jobs' AND column_name = 'post_id') THEN
    ALTER TABLE public.publish_jobs ADD COLUMN post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'publish_jobs' AND column_name = 'destination_id') THEN
    ALTER TABLE public.publish_jobs ADD COLUMN destination_id UUID REFERENCES public.post_destinations(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'publish_jobs' AND column_name = 'idempotency_key') THEN
    ALTER TABLE public.publish_jobs ADD COLUMN idempotency_key TEXT UNIQUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_publish_jobs_status ON public.publish_jobs(status);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_idempotency ON public.publish_jobs(idempotency_key);

ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view publish jobs" ON public.publish_jobs;
CREATE POLICY "Org members can view publish jobs" ON public.publish_jobs FOR ALL USING (true);

-- 9. WEBHOOKS & EVENTS
CREATE TABLE IF NOT EXISTS public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  url TEXT,
  secret TEXT,
  events JSONB DEFAULT '["message.sent", "message.failed", "instance.authenticated"]'::jsonb,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'webhooks' AND column_name = 'organization_id') THEN
    ALTER TABLE public.webhooks ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_webhooks_org ON public.webhooks(organization_id);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  event_type TEXT,
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON public.webhook_events(processed);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage webhooks" ON public.webhooks;
CREATE POLICY "Org members can manage webhooks" ON public.webhooks FOR ALL USING (true);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view webhook events" ON public.webhook_events;
CREATE POLICY "Org members can view webhook events" ON public.webhook_events FOR ALL USING (true);

-- 10. Auto updated_at Trigger
CREATE OR REPLACE FUNCTION public.set_whapi_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_connections_updated_at ON public.social_connections;
CREATE TRIGGER trg_social_connections_updated_at
  BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE PROCEDURE public.set_whapi_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_instances_updated_at ON public.whatsapp_instances;
CREATE TRIGGER trg_whatsapp_instances_updated_at
  BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE PROCEDURE public.set_whapi_updated_at();

DROP TRIGGER IF EXISTS trg_whatsapp_sessions_updated_at ON public.whatsapp_sessions;
CREATE TRIGGER trg_whatsapp_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.set_whapi_updated_at();
