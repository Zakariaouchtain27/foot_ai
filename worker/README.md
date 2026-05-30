# PitchSight Live — processing worker

This is the GPU worker that turns an uploaded match video into live player
positions. The website (`/upload`) stores a video in Supabase Storage and
creates a row in `processing_jobs`; this worker picks the job up, runs
detection, and streams positions into `live_match_tracking` so the dashboard
plays the match back.

```
 browser /upload ─▶ Supabase Storage (match-uploads) + processing_jobs (queued)
                                              │
                                  this worker (GPU) polls ▼
                       download video → YOLOv8 detect → pitch coords
                                              │
                          insert into live_match_tracking (streamed)
                                              │
                              dashboard plays it back ✅
```

## What it needs

Environment variables (the worker uses the **service_role** key — keep it
server-side, never in the browser):

```
SUPABASE_URL=https://kafrpvzbtlusurcknovl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key from Supabase → Settings → API Keys>
```

## Run it

**Option A — any machine/VM with a GPU (or CPU for short clips):**
```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...
python process_job.py          # long-running: polls and processes uploads
```

**Option B — serverless GPU via Modal (no machine to manage):** see
`modal_app.py`. `modal run modal_app.py` drains the queue once on a T4;
`modal deploy modal_app.py` runs it every 2 minutes automatically.

Other hosts (RunPod, Replicate, a cloud GPU VM) work the same way — they just
need the two env vars and `python process_job.py`.

## Current accuracy (important)

This is the **Stage 1** pipeline — good for a fixed, wide "tactical" camera, not
yet for broadcast:

- `pixel_to_pitch()` is a **placeholder** (assumes a top-down camera). Angled or
  broadcasting footage needs a real homography from detected pitch lines.
- **No team detection** — every player defaults to `home`.
- **No tracking** — jersey numbers are per-frame indices, so they flicker.

Stage 2 (ByteTrack tracking, kit-colour team classification, pitch-line
homography) is what makes the numbers trustworthy.
