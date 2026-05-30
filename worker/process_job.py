"""PitchSight Live — video processing worker.

Polls the ``processing_jobs`` table for queued work, obtains the video (either an
uploaded file from the ``match-uploads`` Supabase Storage bucket, or a pasted
URL downloaded with yt-dlp), runs YOLOv8 person detection on sampled frames,
maps detections onto the normalized 0..100 pitch plane, and streams the
positions into ``live_match_tracking`` so the dashboard plays the match back.

Run it anywhere with a GPU and outbound internet:

    SUPABASE_URL=...                     your project URL
    SUPABASE_SERVICE_ROLE_KEY=...        service_role key (server-side only!)
    python process_job.py                # long-running poll loop (VM / container)

Or invoke ``drain_once()`` from a serverless GPU runner (see modal_app.py).

KNOWN LIMITATIONS (Stage 2 work, same as the local tracker):
  * pixel_to_pitch() is a PLACEHOLDER that assumes a top-down camera. Angled or
    broadcast footage needs a real homography from detected pitch lines.
  * No team classification — every player defaults to "home".
  * No multi-frame tracking, so jersey numbers are per-frame indices.
These are fine for a fixed-camera demo; they are NOT accurate analysis yet.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
import traceback
from datetime import datetime, timezone
from typing import Callable

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # dotenv is optional in hosted environments
    pass

from supabase import Client, create_client

BUCKET = "match-uploads"
TICK_SECONDS = 0.2   # stream ~5 position-frames/sec, pacing playback like a live match
TARGET_FPS = 5       # sample the source down to this many frames/sec
POLL_SECONDS = 5


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service_role) in the env."
        )
    return create_client(url, key)


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def pixel_to_pitch(cx: float, cy: float, w: int, h: int) -> tuple[float, float]:
    """PLACEHOLDER homography — assumes a top-down camera (just rescales pixels).

    Replace with a real perspective transform for angled / broadcast footage:
        H = cv2.getPerspectiveTransform(detected_corners, pitch_corners)
    """
    x_norm = _clamp(cx / w * 100.0)
    y_norm = _clamp((1.0 - cy / h) * 100.0)  # flip: image y grows down, pitch y up
    return round(x_norm, 2), round(y_norm, 2)


def _update_job(sb: Client, job_id: str, **fields) -> None:
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    sb.table("processing_jobs").update(fields).eq("id", job_id).execute()


def _download_from_url(url: str, max_seconds: int | None) -> tuple[str, Callable[[], None]]:
    """Download a video from a URL (YouTube or direct link) with yt-dlp.

    When ``max_seconds`` is set, only that opening window is fetched (so a full
    match doesn't have to download in full).
    """
    import yt_dlp

    tmpdir = tempfile.mkdtemp(prefix="pitchsight-")
    opts: dict = {
        # Prefer a single progressive mp4 <=720p so no ffmpeg merge is required.
        "format": "best[height<=720][ext=mp4]/best[ext=mp4]/best[height<=720]/best",
        "outtmpl": os.path.join(tmpdir, "source.%(ext)s"),
        "quiet": True,
        "noprogress": True,
        "noplaylist": True,
    }
    if max_seconds:
        opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [(0, float(max_seconds))])
        opts["force_keyframes_at_cuts"] = True

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)

    files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir)]
    if not files:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise RuntimeError("yt-dlp produced no file for that URL")
    return files[0], lambda: shutil.rmtree(tmpdir, ignore_errors=True)


def _download_from_storage(sb: Client, path: str) -> tuple[str, Callable[[], None]]:
    blob = sb.storage.from_(BUCKET).download(path)
    suffix = os.path.splitext(path)[1] or ".mp4"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(blob)
    tmp.flush()
    tmp.close()
    return tmp.name, lambda: os.unlink(tmp.name)


def _resolve_source(sb: Client, job: dict) -> tuple[str, Callable[[], None]]:
    max_seconds = job.get("max_seconds")
    if job.get("source_url"):
        return _download_from_url(job["source_url"], max_seconds)
    if job.get("video_path"):
        return _download_from_storage(sb, job["video_path"])
    raise RuntimeError("job has neither source_url nor video_path")


def process(sb: Client, job: dict) -> None:
    import cv2  # imported lazily so the poll loop can start without CV deps
    from ultralytics import YOLO

    match_id = job["match_id"]
    max_seconds = job.get("max_seconds")
    print(f"[worker] processing job {job['id']} -> match '{match_id}'")

    local_path, cleanup = _resolve_source(sb, job)
    try:
        model = YOLO("yolov8n.pt")  # nano weights auto-download on first run
        cap = cv2.VideoCapture(local_path)
        if not cap.isOpened():
            raise RuntimeError("could not open the downloaded video")

        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        stride = max(1, int(round(src_fps / TARGET_FPS)))

        # How many frames we expect to process (for the progress bar).
        target_frames = total
        if max_seconds:
            capped = int(max_seconds * src_fps)
            target_frames = min(total, capped) if total else capped

        # Clear any previous positions for this match so playback starts clean.
        sb.table("live_match_tracking").delete().eq("match_id", match_id).execute()

        idx = 0
        last_pct = -1
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if max_seconds and idx / src_fps > max_seconds:
                    break
                if idx % stride == 0:
                    h, w = frame.shape[:2]
                    results = model(frame, classes=[0], verbose=False)  # 0 == person
                    rows: list[dict] = []
                    jersey = 0
                    for r in results:
                        for box in r.boxes:
                            x1, y1, x2, y2 = box.xyxy[0].tolist()
                            cx = (x1 + x2) / 2.0
                            cy = y2  # feet (bottom-center) sit on the ground plane
                            x_norm, y_norm = pixel_to_pitch(cx, cy, w, h)
                            jersey += 1
                            rows.append(
                                {
                                    "match_id": match_id,
                                    "team": "home",  # TODO: kit-colour team classification
                                    "player_jersey": jersey,
                                    "x_pos": x_norm,
                                    "y_pos": y_norm,
                                }
                            )
                    if rows:
                        sb.table("live_match_tracking").insert(rows).execute()

                    if target_frames:
                        pct = min(99, int(idx / target_frames * 100))
                        if pct != last_pct:
                            _update_job(sb, job["id"], progress=pct)
                            last_pct = pct

                    time.sleep(TICK_SECONDS)  # pace inserts so the dashboard animates smoothly
                idx += 1
        finally:
            cap.release()
    finally:
        cleanup()


def _claim_next(sb: Client) -> dict | None:
    res = (
        sb.table("processing_jobs")
        .select("*")
        .eq("status", "queued")
        .order("created_at")
        .limit(1)
        .execute()
    )
    jobs = res.data or []
    return jobs[0] if jobs else None


def _run_one(sb: Client, job: dict) -> None:
    _update_job(sb, job["id"], status="processing", progress=0, message=None)
    try:
        process(sb, job)
        _update_job(sb, job["id"], status="done", progress=100, message="Completed")
        print(f"[worker] job {job['id']} done")
    except Exception as exc:  # noqa: BLE001 — surface any failure into the job row
        traceback.print_exc()
        _update_job(sb, job["id"], status="error", message=str(exc)[:500])


def drain_once() -> int:
    """Process every currently-queued job, then return how many were handled.

    Suits serverless GPU runners (Modal/RunPod) triggered on a schedule.
    """
    sb = get_client()
    handled = 0
    while True:
        job = _claim_next(sb)
        if not job:
            break
        _run_one(sb, job)
        handled += 1
    return handled


def main() -> None:
    """Long-running poll loop for a VM or always-on container."""
    sb = get_client()
    print("[worker] up; polling processing_jobs for queued work…")
    while True:
        job = _claim_next(sb)
        if job is None:
            time.sleep(POLL_SECONDS)
            continue
        _run_one(sb, job)


if __name__ == "__main__":
    main()
