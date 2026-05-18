/*
  # Audio Storage Bucket

  Creates a storage bucket for uploaded audio/video files
  and a policy allowing authenticated and anon users to upload/read.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio-files',
  'audio-files',
  false,
  524288000,
  ARRAY['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/m4a', 'audio/aac', 'video/mp4', 'video/quicktime', 'video/x-msvideo', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Anon can upload audio files"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'audio-files');

CREATE POLICY "Anon can read audio files"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'audio-files');

CREATE POLICY "Authenticated can upload audio files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audio-files');

CREATE POLICY "Authenticated can read audio files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'audio-files');

CREATE POLICY "Authenticated can delete audio files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'audio-files');
