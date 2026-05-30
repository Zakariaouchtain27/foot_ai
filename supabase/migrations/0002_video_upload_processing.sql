-- ============================================================================
-- PitchSight Live — video upload & processing
-- processing_jobs: tracks each uploaded video through the analysis pipeline.
-- match-uploads bucket: stores the raw uploaded videos for the worker to fetch.
-- ============================================================================

create table if not exists public.processing_jobs (
    id          uuid        primary key default gen_random_uuid(),
    match_id    text        not null,
    video_path  text        not null,   -- object path inside the match-uploads bucket
    status      text        not null default 'queued'
                            check (status in ('queued','processing','done','error')),
    message     text,
    progress    int         not null default 0,   -- 0..100
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists processing_jobs_status_idx
    on public.processing_jobs (status, created_at);

-- Permissive RLS, consistent with live_match_tracking (tighten for production).
alter table public.processing_jobs enable row level security;

drop policy if exists "jobs public read" on public.processing_jobs;
create policy "jobs public read" on public.processing_jobs
    for select to anon, authenticated using (true);

drop policy if exists "jobs public insert" on public.processing_jobs;
create policy "jobs public insert" on public.processing_jobs
    for insert to anon, authenticated with check (true);

drop policy if exists "jobs public update" on public.processing_jobs;
create policy "jobs public update" on public.processing_jobs
    for update to anon, authenticated using (true) with check (true);

-- Realtime so the upload page can watch status change live.
do $$
begin
  if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'processing_jobs'
  ) then
      alter publication supabase_realtime add table public.processing_jobs;
  end if;
end $$;

alter table public.processing_jobs replica identity full;

-- Storage bucket for uploaded match videos (public read keeps the worker simple).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'match-uploads', 'match-uploads', true, 524288000,
    array['video/mp4','video/quicktime','video/x-matroska','video/webm','video/avi','application/octet-stream']
)
on conflict (id) do nothing;

drop policy if exists "match uploads read" on storage.objects;
create policy "match uploads read" on storage.objects
    for select to anon, authenticated using (bucket_id = 'match-uploads');

drop policy if exists "match uploads insert" on storage.objects;
create policy "match uploads insert" on storage.objects
    for insert to anon, authenticated with check (bucket_id = 'match-uploads');
