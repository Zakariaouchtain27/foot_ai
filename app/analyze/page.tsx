"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import MetricsPanel from "@/components/MetricsPanel";
import PitchCanvas from "@/components/PitchCanvas";
import { type RGB, splitTeams } from "@/lib/teamSplit";
import type { PitchState } from "@/types";

// Typed handle to the dynamically-imported COCO-SSD model (no `any`).
type CocoModel = Awaited<ReturnType<(typeof import("@tensorflow-models/coco-ssd"))["load"]>>;

type Status = "idle" | "loading" | "analyzing" | "paused" | "done";

const PROCESS_MS = 180; // ~5.5 detections/sec
const STATUS_LABEL: Record<Status, string> = {
  idle: "Pick a video to analyze",
  loading: "Loading the detection model (first time only)…",
  analyzing: "Analyzing in your browser…",
  paused: "Paused",
  done: "Finished",
};

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export default function AnalyzePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<CocoModel | null>(null);
  const rafRef = useRef<number>(0);
  const lastProcRef = useRef<number>(0);

  const [status, setStatus] = useState<Status>("idle");
  const [positions, setPositions] = useState<PitchState>({});
  const [showHull, setShowHull] = useState(true);
  const [showCentroid, setShowCentroid] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  async function ensureModel(): Promise<CocoModel> {
    if (modelRef.current) return modelRef.current;
    setStatus("loading");
    await import("@tensorflow/tfjs"); // registers the WebGL backend
    const cocoSsd = await import("@tensorflow-models/coco-ssd");
    const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    modelRef.current = model;
    return model;
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPositions({});
    setProgress(0);
    setStatus("idle");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
  }

  function sampleColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): RGB {
    const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
    const { data } = ctx.getImageData(sx, sy, 1, 1);
    return [data[0], data[1], data[2]];
  }

  async function processFrame() {
    const video = videoRef.current;
    const model = modelRef.current;
    if (!video || !model) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const preds = await model.detect(video, 40);
    const persons = preds.filter((p) => p.class === "person" && p.score > 0.4);

    // Draw a downscaled frame once so we can sample jersey colours cheaply.
    const scale = 360 / vw;
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));
    let canvas = sampleCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      sampleCanvasRef.current = canvas;
    }
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const colors: RGB[] = persons.map((p) => {
      const [bx, by, bw, bh] = p.bbox;
      if (!ctx) return [0, 0, 0] as RGB;
      return sampleColor(ctx, (bx + bw / 2) * scale, (by + bh * 0.35) * scale, cw, ch);
    });
    if (ctx) ctx.drawImage(video, 0, 0, cw, ch);

    const teams = splitTeams(colors);
    const next: PitchState = {};
    const counters = { home: 0, away: 0 };
    persons.forEach((p, i) => {
      const [bx, by, bw, bh] = p.bbox;
      const x = clamp(((bx + bw / 2) / vw) * 100);
      const y = clamp((1 - (by + bh) / vh) * 100); // feet, flipped to pitch coords
      const team = teams[i] === 0 ? "home" : "away";
      counters[team] += 1;
      next[`${team}_${counters[team]}`] = { team, jersey: counters[team], x, y };
    });

    setPositions(next);
    setProgress(video.duration ? video.currentTime / video.duration : 0);
  }

  function loop() {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended) {
      setStatus("done");
      return;
    }
    if (video.paused) return;
    const now = performance.now();
    if (now - lastProcRef.current >= PROCESS_MS) {
      lastProcRef.current = now;
      void processFrame();
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  async function start() {
    const video = videoRef.current;
    if (!video) return;
    try {
      await ensureModel();
      setStatus("analyzing");
      video.muted = true;
      await video.play();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  function pause() {
    videoRef.current?.pause();
    cancelAnimationFrame(rafRef.current);
    setStatus("paused");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Analyze a <span className="text-home">Video</span>
          </h1>
          <p className="text-sm text-slate-400">
            Runs entirely in your browser — pick a video and watch the tactical read-out.
          </p>
        </div>
        <Link href="/" className="text-sm text-home hover:underline">
          ← Live dashboard
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-slate-900/60 p-4">
        <input
          type="file"
          accept="video/*"
          onChange={handleFile}
          className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-home file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-950"
        />
        {status === "analyzing" ? (
          <button
            onClick={pause}
            className="rounded-md bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={start}
            disabled={!videoUrl || status === "loading"}
            className="rounded-md bg-home px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "done" ? "Replay" : status === "paused" ? "Resume" : "Analyze"}
          </button>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span
            className={
              "h-2.5 w-2.5 rounded-full " +
              (status === "analyzing"
                ? "animate-pulse bg-emerald-400"
                : status === "loading"
                  ? "animate-pulse bg-amber-400"
                  : "bg-slate-500")
            }
          />
          <span className="text-slate-300">{STATUS_LABEL[status]}</span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-home" checked={showHull} onChange={(e) => setShowHull(e.target.checked)} />
            <span className="text-slate-300">Convex hull</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-home" checked={showCentroid} onChange={(e) => setShowCentroid(e.target.checked)} />
            <span className="text-slate-300">Centroid</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      )}

      <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <PitchCanvas positions={positions} showHull={showHull} showCentroid={showCentroid} />
          <div className="overflow-hidden rounded-lg ring-1 ring-white/10">
            {/* Source footage. Kept visible so you can compare detections to the play. */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              src={videoUrl ?? undefined}
              controls
              playsInline
              onEnded={() => setStatus("done")}
              className="max-h-64 w-full bg-black"
            />
          </div>
          {(status === "analyzing" || status === "paused" || status === "done") && (
            <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-home transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <MetricsPanel positions={positions} />
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
            Detection runs on your device with TensorFlow.js. It is a <strong>Stage-1</strong> read:
            positions assume a fixed, wide camera, teams are guessed by jersey colour, and players
            are not tracked between frames. Great for a feel; not yet broadcast-accurate.
          </div>
        </aside>
      </div>
    </main>
  );
}
