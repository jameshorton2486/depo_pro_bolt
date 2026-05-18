/*
  # Allow anon INSERT to audio-files via TUS

  The lockdown_audio_bucket migration removed all RLS policies on
  storage.objects. To enable browser-side TUS resumable uploads (which
  Supabase recommends for files larger than 6 MB), we need to allow the
  anon role to INSERT objects into the audio-files bucket.

  This policy is INSERT-only. SELECT/UPDATE/DELETE remain disabled for
  anon and authenticated — reads continue to flow only through edge
  functions using the service role key.

  Path scoping: required prefix "jobs/" provides a minimum sanity gate
  against arbitrary file uploads. The frontend always produces paths
  matching this prefix.
*/

CREATE POLICY "Anon can TUS-upload to audio-files jobs prefix"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'audio-files'
    AND (storage.foldername(name))[1] = 'jobs'
  );
