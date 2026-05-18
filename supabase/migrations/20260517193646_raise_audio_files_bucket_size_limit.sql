/*
  # Raise audio-files bucket file size limit to 5 GB

  ## Changes
  - Updates the `audio-files` storage bucket's `file_size_limit` from 500 MB (524288000)
    to 5 GB (5368709120) to accommodate large deposition recordings.

  ## Reason
  Legal deposition audio files can exceed 500 MB for multi-hour recordings. The previous
  limit caused upload rejections before any application code ran.
*/

UPDATE storage.buckets
  SET file_size_limit = 5368709120
  WHERE id = 'audio-files';
