-- USERS handled by Supabase auth.users natively

-- PROFILES
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company text,
  role text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- PLATFORM CONNECTIONS
create table if not exists platform_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null check (platform in ('whatsapp','instagram','twitter')),
  access_token text not null,          -- store encrypted (pgsodium / vault)
  refresh_token text,
  token_expires_at timestamptz,
  platform_account_id text,            
  platform_account_name text,
  status text default 'active' check (status in ('active','expired','revoked')),
  connected_at timestamptz default now()
);

alter table platform_connections enable row level security;
create policy "Users can manage own connections" on platform_connections for all using (auth.uid() = user_id);

-- AUTOMATIONS
create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  campaign_name text,
  raw_content text not null,
  media_url text,
  tone text default 'professional',
  cta_link text,
  target_platforms text[] not null,     
  schedule_type text default 'now' check (schedule_type in ('now','scheduled','recurring')),
  scheduled_at timestamptz,
  created_at timestamptz default now()
);

alter table automations enable row level security;
create policy "Users can manage own automations" on automations for all using (auth.uid() = user_id);

-- CONTENT VARIANTS
create table if not exists content_variants (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  platform text not null,
  generated_text text not null,
  char_count int,
  hashtags text[],
  edited_by_user boolean default false,
  created_at timestamptz default now()
);

alter table content_variants enable row level security;
-- Variants are readable/writable if the user owns the parent automation
create policy "Users can manage own variants" on content_variants for all using (
  exists (select 1 from automations where id = content_variants.automation_id and user_id = auth.uid())
);

-- PUBLISH JOBS
create table if not exists publish_jobs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  variant_id uuid references content_variants(id),
  platform text not null,
  status text default 'queued' check (status in ('queued','processing','success','failed')),
  platform_post_id text,
  platform_post_url text,
  error_message text,
  attempts int default 0,
  updated_at timestamptz default now()
);

alter table publish_jobs enable row level security;
create policy "Users can view own jobs" on publish_jobs for select using (
  exists (select 1 from automations where id = publish_jobs.automation_id and user_id = auth.uid())
);

-- AUTOMATION LOGS
create table if not exists automation_logs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  event text not null,          
  meta jsonb,
  created_at timestamptz default now()
);

alter table automation_logs enable row level security;
create policy "Users can view own logs" on automation_logs for select using (
  exists (select 1 from automations where id = automation_logs.automation_id and user_id = auth.uid())
);

-- BRAND TAGLINES
create table if not exists brand_taglines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  platform text,
  tagline text
);

alter table brand_taglines enable row level security;
create policy "Users can manage own taglines" on brand_taglines for all using (auth.uid() = user_id);

-- Trigger to auto-create profile on signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
