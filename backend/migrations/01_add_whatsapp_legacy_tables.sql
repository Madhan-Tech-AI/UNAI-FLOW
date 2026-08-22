-- ==============================================================================
-- UNAI FLOW: Legacy WhatsApp Tables Migration
-- Adds columns/tables needed by the dashboard's legacy code path
-- (session_manager.py, channel_manager.py, connection_manager.py)
-- Safe to run multiple times (all operations are IF NOT EXISTS / defensive)
-- ==============================================================================

-- 1. Ensure whatsapp_sessions has the columns the legacy SessionManager expects
DO $$
BEGIN
  -- user_id: links session to auth.users
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN user_id UUID;
  END IF;

  -- session_identifier: unique session key (e.g. sess_abc123)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'session_identifier'
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN session_identifier TEXT;
  END IF;

  -- status: CONNECTING, INITIALIZING, WAITING_FOR_SCAN, CONNECTED, ERROR, etc.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN status TEXT DEFAULT 'CONNECTING';
  END IF;

  -- provider: whatsapp_web, meta_cloud, etc.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'provider'
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN provider TEXT DEFAULT 'whatsapp_web';
  END IF;

  -- phone_number: discovered after QR scan
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'phone_number'
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN phone_number TEXT;
  END IF;

  -- last_connected_at: timestamp of last successful connection
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_sessions' AND column_name = 'last_connected_at'
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD COLUMN last_connected_at TIMESTAMPTZ;
  END IF;
END $$;

-- Index for fast user session lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_user ON public.whatsapp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_identifier ON public.whatsapp_sessions(session_identifier);

-- 2. Create the `channels` table used by ChannelManager
--    (separate from whatsapp_channels which is used by the v1 gateway)
CREATE TABLE IF NOT EXISTS public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  picture_url TEXT,
  followers BIGINT DEFAULT 0,
  role TEXT DEFAULT 'UNKNOWN',
  is_selected BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channels_session ON public.channels(whatsapp_session_id);
CREATE INDEX IF NOT EXISTS idx_channels_channel_id ON public.channels(channel_id);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage channels" ON public.channels;
CREATE POLICY "Users can manage channels" ON public.channels FOR ALL USING (true);

-- 3. Create whatsapp_publish_jobs table used by PublishingWorker
CREATE TABLE IF NOT EXISTS public.whatsapp_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'text',
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'QUEUED',
  message_id TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_publish_jobs_status ON public.whatsapp_publish_jobs(status);

ALTER TABLE public.whatsapp_publish_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage wa publish jobs" ON public.whatsapp_publish_jobs;
CREATE POLICY "Users can manage wa publish jobs" ON public.whatsapp_publish_jobs FOR ALL USING (true);
