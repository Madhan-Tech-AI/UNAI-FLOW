-- ==============================================================================
-- UNAI FLOW: Realtime Database Trigger for WhatsApp Channel Publishing
-- ==============================================================================

-- 1. Enable pg_net extension if available for async HTTP webhook triggers
create extension if not exists "pg_net" with schema "extensions";

-- 2. Function to invoke the Supabase Edge Function on new queued WhatsApp publish jobs
create or replace function public.trigger_whatsapp_publish()
returns trigger as $$
declare
  -- Your Supabase Edge Function URL
  edge_function_url text := 'https://geifdxvvfobvbmmsqhry.supabase.co/rest/v1/whatsapp-publish-trigger';
  
  -- Replace with your Supabase Service Role Key (from Supabase Dashboard -> Project Settings -> API)
  service_role_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlaWZkeHZ2Zm9idmJtbXNxaHJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjI2ODc3NSwiZXhwIjoyMTAxODQ0Nzc1fQ.irJx0TxRnrfeqh156m8RRxncYo7QVdwvI1tBgaST74g';
begin
  -- Only trigger for newly queued jobs
  if (new.status = 'queued') then
    -- Invoke edge function asynchronously in realtime
    perform net.http_post(
      url := edge_function_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'whatsapp_publish_jobs',
        'record', row_to_json(new)
      )
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- 3. Create the Database Trigger on whatsapp_publish_jobs table
drop trigger if exists trg_auto_publish_whatsapp on public.whatsapp_publish_jobs;
create trigger trg_auto_publish_whatsapp
  after insert or update of status on public.whatsapp_publish_jobs
  for each row
  when (new.status = 'queued')
  execute procedure public.trigger_whatsapp_publish();
