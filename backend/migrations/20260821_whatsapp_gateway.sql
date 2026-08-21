-- ==============================================================================
-- UNAI FLOW: Production WhatsApp Gateway & YouTube Automation Migration
-- ==============================================================================

-- 1. WHATSAPP CONNECTIONS (Multi-Tenant User Connection Root)
create table if not exists public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id text not null unique,
  status text not null default 'DISCONNECTED' check (status in (
    'DISCONNECTED', 'INITIALIZING', 'QR_READY', 'WAITING_FOR_SCAN', 'AUTHENTICATING', 'CONNECTED', 'FAILED', 'REVOKED'
  )),
  phone_number text,
  platform_account_name text,
  metadata jsonb default '{}'::jsonb,
  connected_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_whatsapp_conn_user_id on public.whatsapp_connections(user_id);
create index if not exists idx_whatsapp_conn_conn_id on public.whatsapp_connections(connection_id);

alter table public.whatsapp_connections enable row level security;
create policy "Users can manage own whatsapp connections" on public.whatsapp_connections
  for all using (auth.uid() = user_id);

-- 2. WHATSAPP SESSIONS (Session Persistence & Heartbeats)
create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  connection_id text not null references public.whatsapp_connections(connection_id) on delete cascade,
  session_reference text not null, -- Encrypted vault reference / directory key
  state text not null default 'inactive' check (state in ('active', 'inactive', 'connecting', 'reconnecting', 'expired')),
  last_seen timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_whatsapp_sessions_conn_id on public.whatsapp_sessions(connection_id);

alter table public.whatsapp_sessions enable row level security;
create policy "Users can manage own whatsapp sessions" on public.whatsapp_sessions
  for all using (
    exists (select 1 from public.whatsapp_connections where connection_id = whatsapp_sessions.connection_id and user_id = auth.uid())
  );

-- 3. WHATSAPP CHANNELS (Discovered & Configured Channels / Newsletters)
create table if not exists public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  connection_id text not null references public.whatsapp_connections(connection_id) on delete cascade,
  channel_id text not null, -- e.g. 120363171744447809@newsletter
  channel_name text not null,
  channel_link text,
  role text default 'admin' check (role in ('admin', 'owner', 'subscriber', 'guest')),
  subscribers_count int default 0,
  verified boolean default false,
  selected boolean default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(connection_id, channel_id)
);

create index if not exists idx_whatsapp_channels_conn_id on public.whatsapp_channels(connection_id);

alter table public.whatsapp_channels enable row level security;
create policy "Users can manage own whatsapp channels" on public.whatsapp_channels
  for all using (
    exists (select 1 from public.whatsapp_connections where connection_id = whatsapp_channels.connection_id and user_id = auth.uid())
  );

-- 4. WHATSAPP PUBLISH JOBS (Queue, Retry Engine, Logs)
create table if not exists public.whatsapp_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id text not null references public.whatsapp_connections(connection_id) on delete cascade,
  channel_id text not null,
  automation_id uuid references public.automations(id) on delete set null,
  content_type text not null default 'text' check (content_type in ('text', 'image', 'video', 'document')),
  content text,
  media_url text,
  caption text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'success', 'failed', 'retrying')),
  platform_post_id text,
  attempts int default 0,
  max_attempts int default 3,
  last_error text,
  fingerprint text,
  scheduled_at timestamptz default now(),
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_whatsapp_pub_jobs_user on public.whatsapp_publish_jobs(user_id);
create index if not exists idx_whatsapp_pub_jobs_status on public.whatsapp_publish_jobs(status);
create index if not exists idx_whatsapp_pub_jobs_fingerprint on public.whatsapp_publish_jobs(fingerprint);

alter table public.whatsapp_publish_jobs enable row level security;
create policy "Users can manage own whatsapp publish jobs" on public.whatsapp_publish_jobs
  for all using (auth.uid() = user_id);

-- 5. YOUTUBE AUTOMATION MONITORS (YouTube to WhatsApp Ingestion)
create table if not exists public.youtube_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_url text not null,
  channel_id text,
  channel_title text,
  whatsapp_channel_id text,
  auto_publish boolean default false,
  last_checked_at timestamptz default now(),
  last_video_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.youtube_monitors enable row level security;
create policy "Users can manage own youtube monitors" on public.youtube_monitors
  for all using (auth.uid() = user_id);

-- 6. Helper function to update updated_at timestamp
create or replace function public.set_current_timestamp_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger trg_whatsapp_connections_updated_at
  before update on public.whatsapp_connections
  for each row execute procedure public.set_current_timestamp_updated_at();

create or replace trigger trg_whatsapp_channels_updated_at
  before update on public.whatsapp_channels
  for each row execute procedure public.set_current_timestamp_updated_at();

create or replace trigger trg_whatsapp_publish_jobs_updated_at
  before update on public.whatsapp_publish_jobs
  for each row execute procedure public.set_current_timestamp_updated_at();
