# PitchSight Live ⚽

Real-time, in-game **tactical telemetry dashboard** for football coaches to use on
the bench during a live match.

Player positions stream from an ingestion layer (mock simulator or YOLOv8 computer
vision) into Supabase, replicate to the browser over Supabase Realtime, and render
on an HTML5 Canvas pitch with live spatial tactical metrics (centroids, defensive
line height, compactness, convex-hull space control).

```
 ┌───────────────┐     insert     ┌────────────────────┐   realtime    ┌────────────────────┐
 │  tracker.py   │ ─────────────▶ │ Supabase Postgres  │ ────────────▶ │  Next.js dashboard │
 │ (mock / YOLO) │   200ms batch  │ live_match_tracking│  replication  │  Canvas + metrics  │
 └───────────────┘                └────────────────────┘               └────────────────────┘
```

## Repository layout

```
foot_ai/
├── supabase/migrations/0001_init_live_match_tracking.sql   # DB schema, RLS, realtime
├── ingestion/
│   ├── tracker.py            # mock simulator + YOLOv8 modes
│   ├── requirements.txt
│   └── .env.example
└── web/                      # Next.js (App Router) + TypeScript + Tailwind
    ├── app/                  # pages & layout
    ├── components/           # PitchCanvas, MetricsPanel, MatchControls
    ├── hooks/useMatchRealtime.ts
    ├── lib/                  # supabaseClient, tactics math
    └── types/
```

## 1. Database setup

Run the migration in the Supabase SQL editor (or via the Supabase CLI):

```bash
supabase db push                      # if using the CLI
# or paste supabase/migrations/0001_init_live_match_tracking.sql into the dashboard
```

This creates `live_match_tracking`, enables RLS with permissive hackathon policies,
and adds the table to the `supabase_realtime` publication so inserts are pushed to
clients instantly.

## 2. Ingestion layer

```bash
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                  # fill in SUPABASE_URL / SUPABASE_KEY

# Mock simulator (recommended for demos) — shifting 4-3-3 blocks, 22 players @ 200ms
python tracker.py --mode mock --match-id demo-001

# YOLOv8 computer-vision mode (video file or webcam index)
python tracker.py --mode yolo --source match.mp4 --match-id demo-001
```

## 3. Frontend

```bash
cd web
npm install
cp .env.local.example .env.local      # NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
npm run dev                            # http://localhost:3000
```

Open the dashboard, type the same `match-id` you streamed to, and watch the pitch
update live.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | ingestion/.env | Project URL |
| `SUPABASE_KEY` | ingestion/.env | service_role or anon key for inserts |
| `NEXT_PUBLIC_SUPABASE_URL` | web/.env.local | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web/.env.local | anon (public) key |

> The RLS policies in the migration are intentionally permissive for hackathon
> speed. Tighten them before any production use.
