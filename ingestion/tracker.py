#!/usr/bin/env python3
"""PitchSight Live — ingestion layer.

Streams normalized player coordinates (0..100 on both axes) into the Supabase
``live_match_tracking`` table. Two modes are supported:

    mock  : a deterministic-but-lively 22-player simulator (11 home / 11 away)
            arranged in shifting 4-3-3 blocks that slide up and down the pitch.
            Ideal for a stable live demo. Streams every 200 ms.

    yolo  : a baseline YOLOv8 computer-vision pipeline that reads a video file
            or webcam, detects 'person' boxes, maps box centers to a flat 2D
            pitch plane via a (placeholder) homography, and streams them.

Usage
-----
    python tracker.py --mode mock --match-id demo-001
    python tracker.py --mode yolo --source match.mp4 --match-id demo-001
    python tracker.py --mode yolo --source 0 --match-id demo-001   # webcam

Environment (.env)
------------------
    SUPABASE_URL=...
    SUPABASE_KEY=...
"""
from __future__ import annotations

import argparse
import math
import os
import random
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Iterable

from dotenv import load_dotenv

try:
    from supabase import Client, create_client
except ImportError:  # pragma: no cover - clearer error than a raw traceback
    print("Missing dependency: run `pip install -r requirements.txt`", file=sys.stderr)
    raise

TABLE = "live_match_tracking"
TICK_SECONDS = 0.2  # 200 ms stream cadence

# A normalized 4-3-3 template. Coordinates are (x, y) in 0..100 where x is pitch
# WIDTH (touchline to touchline) and y is pitch LENGTH (own goal -> opponent).
# This template is for a team attacking "up" (increasing y). The away side is
# mirrored at runtime.
FORMATION_433: list[tuple[str, float, float]] = [
    # role,         x,    y
    ("GK", 50.0, 5.0),
    ("RB", 82.0, 22.0),
    ("RCB", 62.0, 18.0),
    ("LCB", 38.0, 18.0),
    ("LB", 18.0, 22.0),
    ("RCM", 68.0, 42.0),
    ("CM", 50.0, 38.0),
    ("LCM", 32.0, 42.0),
    ("RW", 80.0, 70.0),
    ("ST", 50.0, 78.0),
    ("LW", 20.0, 70.0),
]


# ---------------------------------------------------------------------------
# Supabase client + concurrent writer
# ---------------------------------------------------------------------------
def get_client() -> Client:
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print(
            "SUPABASE_URL / SUPABASE_KEY are not set. Copy .env.example to .env "
            "and fill them in.",
            file=sys.stderr,
        )
        sys.exit(1)
    return create_client(url, key)


class FrameWriter:
    """Pushes a frame (list of player rows) to Supabase off the main thread.

    Each frame is a single bulk insert, which keeps the number of round-trips to
    one-per-tick instead of one-per-player. Writes run on a small thread pool so
    a slow network round-trip never stalls the simulation loop (we simply drop
    to the next tick rather than queueing unbounded backlog).
    """

    def __init__(self, client: Client, max_workers: int = 4) -> None:
        self._client = client
        self._pool = ThreadPoolExecutor(max_workers=max_workers)
        self._inflight = 0

    def submit(self, rows: list[dict]) -> None:
        if not rows:
            return
        # Backpressure: if writes are piling up, skip this frame rather than
        # blowing out memory / the connection pool. Stale positions are useless
        # in a real-time context anyway.
        if self._inflight >= 8:
            print("[writer] backpressure — dropping frame", file=sys.stderr)
            return
        self._inflight += 1
        fut = self._pool.submit(self._insert, rows)
        fut.add_done_callback(self._on_done)

    def _insert(self, rows: list[dict]) -> None:
        self._client.table(TABLE).insert(rows).execute()

    def _on_done(self, fut) -> None:
        self._inflight -= 1
        exc = fut.exception()
        if exc is not None:
            print(f"[writer] insert failed: {exc}", file=sys.stderr)

    def close(self) -> None:
        self._pool.shutdown(wait=True)


# ---------------------------------------------------------------------------
# Mock simulator
# ---------------------------------------------------------------------------
@dataclass
class Player:
    team: str
    jersey: int
    base_x: float
    base_y: float
    # Per-player jitter phase so movement looks organic, not lock-stepped.
    phase: float = field(default_factory=lambda: random.uniform(0, math.tau))


def build_squads() -> list[Player]:
    """Create 22 players from the 4-3-3 template (home attacking up, away down)."""
    players: list[Player] = []
    for jersey, (_role, x, y) in enumerate(FORMATION_433, start=1):
        players.append(Player(team="home", jersey=jersey, base_x=x, base_y=y))
    for jersey, (_role, x, y) in enumerate(FORMATION_433, start=1):
        # Mirror the away team: flip both axes so they attack "down" the pitch.
        players.append(Player(team="away", jersey=jersey, base_x=100.0 - x, base_y=100.0 - y))
    return players


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def simulate_frame(players: Iterable[Player], match_id: str, t: float) -> list[dict]:
    """Compute one frame of positions.

    The whole block oscillates up/down the pitch (a coordinated team shift), and
    each player adds small individual jitter so the shape breathes. A goalkeeper
    stays mostly anchored to its own goal.
    """
    # Team-wide tactical shift: both blocks slide together along the length of
    # the pitch on a slow sine wave (period ~30s) — like pressing high then
    # dropping into a mid block.
    block_shift = 14.0 * math.sin(t / 30.0 * math.tau)
    # A gentle lateral sway (ball moving across the pitch).
    lateral_sway = 6.0 * math.sin(t / 18.0 * math.tau + 1.0)

    rows: list[dict] = []
    for p in players:
        is_gk = p.jersey == 1
        # Home shifts with +block_shift, away mirrors with -block_shift so the
        # two teams stay coherent relative to each other.
        direction = 1.0 if p.team == "home" else -1.0
        shift = 0.0 if is_gk else block_shift * direction

        jitter_x = (1.2 if is_gk else 3.5) * math.sin(t * 1.7 + p.phase)
        jitter_y = (1.0 if is_gk else 3.0) * math.cos(t * 1.3 + p.phase)

        x = clamp(p.base_x + lateral_sway + jitter_x)
        y = clamp(p.base_y + shift + jitter_y)

        rows.append(
            {
                "match_id": match_id,
                "team": p.team,
                "player_jersey": p.jersey,
                "x_pos": round(x, 2),
                "y_pos": round(y, 2),
            }
        )
    return rows


def run_mock(match_id: str) -> None:
    client = get_client()
    writer = FrameWriter(client)
    players = build_squads()

    print(f"[mock] streaming 22 players to '{match_id}' every {int(TICK_SECONDS*1000)}ms. Ctrl-C to stop.")
    start = time.monotonic()
    frame = 0
    try:
        while True:
            tick_start = time.monotonic()
            t = tick_start - start
            rows = simulate_frame(players, match_id, t)
            writer.submit(rows)
            frame += 1
            if frame % 25 == 0:
                print(f"[mock] frame {frame} @ t={t:6.1f}s")
            # Keep a steady cadence regardless of how long submit() took.
            elapsed = time.monotonic() - tick_start
            time.sleep(max(0.0, TICK_SECONDS - elapsed))
    except KeyboardInterrupt:
        print("\n[mock] stopping…")
    finally:
        writer.close()


# ---------------------------------------------------------------------------
# YOLOv8 computer-vision mode (baseline placeholder)
# ---------------------------------------------------------------------------
def pixel_to_pitch(cx: float, cy: float, frame_w: int, frame_h: int) -> tuple[float, float]:
    """Map a pixel coordinate to the normalized 0..100 pitch plane.

    PLACEHOLDER homography: this naive version assumes the camera looks straight
    down on the pitch, so it just rescales pixels to 0..100. For a real broadcast
    feed, replace this with a proper perspective transform:

        import cv2, numpy as np
        H = cv2.getPerspectiveTransform(src_pts, dst_pts)  # 4 pitch corners
        pt = H @ np.array([cx, cy, 1.0]); pt /= pt[2]
        x_norm, y_norm = pt[0] / PITCH_W * 100, pt[1] / PITCH_L * 100
    """
    x_norm = clamp(cx / frame_w * 100.0)
    # Image y grows downward; flip so y=0 is the bottom of the pitch.
    y_norm = clamp((1.0 - cy / frame_h) * 100.0)
    return round(x_norm, 2), round(y_norm, 2)


def run_yolo(match_id: str, source: str) -> None:
    try:
        import cv2  # noqa: F401
        from ultralytics import YOLO
    except ImportError:
        print(
            "YOLO mode needs `ultralytics` and `opencv-python`. Install with:\n"
            "    pip install ultralytics opencv-python",
            file=sys.stderr,
        )
        sys.exit(1)

    import cv2

    client = get_client()
    writer = FrameWriter(client)
    model = YOLO("yolov8n.pt")  # nano weights download on first run

    # Accept a webcam index ("0") or a file path.
    cap_source: object = int(source) if source.isdigit() else source
    cap = cv2.VideoCapture(cap_source)
    if not cap.isOpened():
        print(f"[yolo] could not open source: {source}", file=sys.stderr)
        sys.exit(1)

    print(f"[yolo] running detection on '{source}' -> match '{match_id}'. Ctrl-C to stop.")
    last_emit = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print("[yolo] end of stream.")
                break

            h, w = frame.shape[:2]
            # class 0 == 'person' in the COCO label set YOLOv8 ships with.
            results = model(frame, classes=[0], verbose=False)

            rows: list[dict] = []
            jersey = 0
            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    cx = (x1 + x2) / 2.0
                    # Use the bottom-center of the box (player's feet) for a more
                    # accurate ground-plane position than the box centroid.
                    cy = y2
                    x_norm, y_norm = pixel_to_pitch(cx, cy, w, h)
                    jersey += 1
                    rows.append(
                        {
                            "match_id": match_id,
                            # Team assignment requires jersey-color clustering —
                            # out of scope for this baseline; default to 'home'.
                            "team": "home",
                            "player_jersey": jersey,
                            "x_pos": x_norm,
                            "y_pos": y_norm,
                        }
                    )

            # Throttle DB writes to the same 200ms cadence as the mock mode.
            now = time.monotonic()
            if now - last_emit >= TICK_SECONDS:
                writer.submit(rows)
                last_emit = now
    except KeyboardInterrupt:
        print("\n[yolo] stopping…")
    finally:
        cap.release()
        writer.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PitchSight Live ingestion layer")
    parser.add_argument("--mode", choices=["mock", "yolo"], default="mock")
    parser.add_argument("--match-id", default="demo-001", help="match identifier to stream into")
    parser.add_argument(
        "--source",
        default="0",
        help="(yolo mode) video file path or webcam index",
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    # Make Ctrl-C behave predictably across platforms.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    if args.mode == "mock":
        run_mock(args.match_id)
    else:
        run_yolo(args.match_id, args.source)


if __name__ == "__main__":
    main()
