import os
from dotenv import load_dotenv

load_dotenv()
from lib.supabase_client import supabase

res = supabase.table('publish_jobs').select('*').order('updated_at', desc=True).limit(5).execute()
for job in res.data:
    print(f"Platform: {job['platform']} | Status: {job['status']} | Error: {job.get('error_message')}")
