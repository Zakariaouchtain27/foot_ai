-- ============================================================================
-- PitchSight Live — ingest by URL (YouTube / direct video link)
-- Adds an alternative source to file uploads, and an optional time cap so a
-- full match can be sampled to its first N seconds.
-- ============================================================================

alter table public.processing_jobs add column if not exists source_url  text;
alter table public.processing_jobs add column if not exists max_seconds int;   -- null = whole video

-- A job now has EITHER a video_path (uploaded file) OR a source_url (link).
alter table public.processing_jobs alter column video_path drop not null;
