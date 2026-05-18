/*
  # Atomic increment for transcription_jobs.parts_completed

  Replaces the race-prone select-then-update pattern in transcribe-callback
  with a single atomic SQL increment. Multiple concurrent Deepgram callbacks
  for the same job will no longer step on each other.

  Returns the new (parts_completed, parts_total) values so the caller can
  decide whether to trigger finalization without a second round-trip.
*/

CREATE OR REPLACE FUNCTION increment_parts_completed(p_job_id uuid)
RETURNS TABLE (parts_completed integer, parts_total integer)
LANGUAGE sql
AS $$
  UPDATE transcription_jobs
    SET parts_completed = parts_completed + 1,
        phase           = 'Awaiting Deepgram ('
                        || (parts_completed + 1)::text || '/'
                        || parts_total::text || ' parts)',
        updated_at      = now()
    WHERE id = p_job_id
  RETURNING transcription_jobs.parts_completed, transcription_jobs.parts_total;
$$;

GRANT EXECUTE ON FUNCTION increment_parts_completed(uuid) TO service_role;
