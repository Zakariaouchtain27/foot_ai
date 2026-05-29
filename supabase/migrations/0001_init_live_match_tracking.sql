-- ============================================================================
-- PitchSight Live — initial schema
-- Table: live_match_tracking
-- Stores normalized (0-100) player coordinates streamed from the ingestion layer.
-- ============================================================================

-- 1. Core tracking table -----------------------------------------------------
create table if not exists public.live_match_tracking (
    id            uuid        primary key default gen_random_uuid(),
    match_id      text        not null,
    team          text        not null check (team in ('home', 'away')),
    player_jersey int         not null,
    x_pos         float       not null,  -- normalized 0.0..100.0 (pitch width)
    y_pos         float       not null,  -- normalized 0.0..100.0 (pitch length)
    "timestamp"   timestamptz not null default now()
);

-- Index for the most common query: "give me the latest rows for this match".
create index if not exists live_match_tracking_match_id_idx
    on public.live_match_tracking (match_id);

-- Composite index that accelerates "latest position per player" lookups.
create index if not exists live_match_tracking_match_ts_idx
    on public.live_match_tracking (match_id, "timestamp" desc);

-- 2. Row Level Security ------------------------------------------------------
-- NOTE: These policies are intentionally permissive for hackathon speed.
--       Tighten (or scope by auth.uid()) before any production deployment.
alter table public.live_match_tracking enable row level security;

drop policy if exists "Public read access" on public.live_match_tracking;
create policy "Public read access"
    on public.live_match_tracking
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Public insert access" on public.live_match_tracking;
create policy "Public insert access"
    on public.live_match_tracking
    for insert
    to anon, authenticated
    with check (true);

drop policy if exists "Public update access" on public.live_match_tracking;
create policy "Public update access"
    on public.live_match_tracking
    for update
    to anon, authenticated
    using (true)
    with check (true);

drop policy if exists "Public delete access" on public.live_match_tracking;
create policy "Public delete access"
    on public.live_match_tracking
    for delete
    to anon, authenticated
    using (true);

-- 3. Realtime replication ----------------------------------------------------
-- CRITICAL: add the table to the supabase_realtime publication so client
-- subscriptions receive INSERT events instantly.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'live_match_tracking'
    ) then
        alter publication supabase_realtime add table public.live_match_tracking;
    end if;
end $$;

-- Ensure UPDATE/DELETE events carry the full row (handy if you switch the
-- ingestion layer to upserts instead of inserts).
alter table public.live_match_tracking replica identity full;
