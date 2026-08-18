-- Run this in Supabase SQL Editor to ensure storage bucket 'media' is public and readable by Instagram/Facebook servers

-- 1. Ensure 'media' bucket exists and is set to public
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Allow public access to read files from 'media' bucket
DROP POLICY IF EXISTS "Public Access Media" ON storage.objects;
CREATE POLICY "Public Access Media" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');

-- 3. Allow uploads into 'media' bucket
DROP POLICY IF EXISTS "Public Insert Media" ON storage.objects;
CREATE POLICY "Public Insert Media" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'media');
