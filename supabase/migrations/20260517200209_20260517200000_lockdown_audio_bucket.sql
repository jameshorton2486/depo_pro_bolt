/*
  # Lock down audio-files bucket

  Removes direct anon and authenticated access to the audio-files bucket.
  All uploads now go through the create-upload-url edge function, which uses
  the service role to issue presigned PUT URLs.

  The bucket remains private (public = false from the base migration).
  Service-role access (used by edge functions) bypasses RLS, so the existing
  transcribe-audio and transcribe-callback functions continue to work.

  ## Reasoning
  The previous policies allowed any anon-key holder to upload and read any
  file in the bucket. The anon key is published in client bundles by design,
  so this was effectively a public file-share endpoint billed to this project.

  ## Changes
  - Drops all anon and authenticated direct-access policies on storage.objects
    scoped to the audio-files bucket
  - No replacement policies added — service role bypasses RLS and handles
    all file reads/writes inside edge functions

  ## Future hardening
  When auth is added, add policies scoped to:
    (storage.foldername(name))[1] = auth.uid()::text
*/

DROP POLICY IF EXISTS "Anon can upload audio files"          ON storage.objects;
DROP POLICY IF EXISTS "Anon can read audio files"            ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload audio files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read audio files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete audio files" ON storage.objects;
