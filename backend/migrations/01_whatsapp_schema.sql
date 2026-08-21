-- Clean up existing tables to avoid schema conflicts during development
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS whatsapp_published_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_publish_jobs CASCADE;
DROP TABLE IF EXISTS channel_permissions CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;

-- 1. API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  key_hash text NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own api keys" ON api_keys FOR ALL USING (auth.uid() = api_keys.user_id);

-- 2. WhatsApp Sessions
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_identifier text UNIQUE,
  phone_number text,
  status text DEFAULT 'DISCONNECTED',
  provider text,
  encrypted_session_data text,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own whatsapp sessions" ON whatsapp_sessions FOR ALL USING (auth.uid() = whatsapp_sessions.user_id);

-- 3. Channels
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_session_id uuid REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  name text,
  description text,
  picture_url text,
  followers int,
  role text,
  is_selected boolean DEFAULT false,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (whatsapp_session_id, channel_id)
);

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own channels" ON channels FOR ALL USING (
  EXISTS (SELECT 1 FROM whatsapp_sessions WHERE whatsapp_sessions.id = channels.whatsapp_session_id AND whatsapp_sessions.user_id = auth.uid())
);

-- 4. Channel Permissions
CREATE TABLE IF NOT EXISTS channel_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  role text,
  can_publish boolean DEFAULT false,
  can_edit boolean DEFAULT false,
  can_manage boolean DEFAULT false,
  checked_at timestamptz DEFAULT now(),
  UNIQUE (channel_id)
);

ALTER TABLE channel_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own channel permissions" ON channel_permissions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM channels 
    JOIN whatsapp_sessions ON whatsapp_sessions.id = channels.whatsapp_session_id 
    WHERE channels.id = channel_permissions.channel_id AND whatsapp_sessions.user_id = auth.uid()
  )
);

-- 5. WhatsApp Publish Jobs
CREATE TABLE IF NOT EXISTS whatsapp_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb,
  status text DEFAULT 'QUEUED',
  attempts int DEFAULT 0,
  max_attempts int DEFAULT 3,
  message_id text,
  error_code text,
  error_message text,
  idempotency_key text UNIQUE,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE whatsapp_publish_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own whatsapp publish jobs" ON whatsapp_publish_jobs FOR ALL USING (auth.uid() = whatsapp_publish_jobs.user_id);

-- 6. WhatsApp Published Messages
CREATE TABLE IF NOT EXISTS whatsapp_published_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_job_id uuid REFERENCES whatsapp_publish_jobs(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  message_id text,
  type text,
  content text,
  media_url text,
  status text,
  provider_response jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE whatsapp_published_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own whatsapp published messages" ON whatsapp_published_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM whatsapp_publish_jobs WHERE whatsapp_publish_jobs.id = whatsapp_published_messages.publish_job_id AND whatsapp_publish_jobs.user_id = auth.uid())
);

-- 7. Webhook Events
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text,
  payload jsonb,
  processed boolean DEFAULT false,
  processing_error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

-- Webhook events are processed backend-only.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
-- No access to users; backend access via service_role key.
