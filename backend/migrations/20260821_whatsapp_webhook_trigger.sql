-- ==============================================================================
-- UNAI FLOW: Realtime Database Trigger for WhatsApp Channel Publishing
-- ==============================================================================

-- 1. Enable pg_net extension if available for async HTTP webhook triggers
create extension if not exists "pg_net" with schema "extensions";

-- 2. Function to invoke the Supabase Edge Function on new queued WhatsApp publish jobs
create or replace function public.trigger_whatsapp_publish()
returns trigger as $$
declare
  edge_function_url text := 'https://your-project-ref.supabase.co/functions/v1/whatsapp-publish-trigger';
  service_role_key text := 'YOUR_SUPABASE_SERVICE_ROLE_KEY';
begin
  -- Only trigger for newly queued jobs
  if (new.status = 'queued') then
    -- If pg_net is available, invoke edge function asynchronously in realtime
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
