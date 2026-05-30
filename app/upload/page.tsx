"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabaseClient";
import type { JobStatus, ProcessingJob } from "@/types";

type Phase = "idle" | "uploading" | JobStatus;

/** Derive a tidy, unique match id from a filename. */
function slugMatchId(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "match"}-${suffix}`;
}

const STATUS_LABEL: Record<Phase, string> = {
  idle: "Choose a video to begin",
  uploading: "Uploading video…",
  queued: "Queued — waiting for a worker to pick it up",
  processing: "Analyzing video…",
  done: "Analysis complete",
  error: "Something went wrong",
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [matchId, setMatchId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const touchedId = useRef(false);

  // Suggest a match id from the chosen file until the user edits it themselves.
  useEffect(() => {
    if (file && !touchedId.current) setMatchId(slugMatchId(file.name));
  }, [file]);

  // Watch this job's row for live status + progress updates.
  useEffect(() => {
    if (!jobId) return;
    const channel = supabase
      .channel(`processing_jobs:${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "processing_jobs", filter: `id=eq.${jobId}` },
        (payload) => {
          const job = payload.new as ProcessingJob;
          setProgress(job.progress ?? 0);
          setPhase(job.status);
          if (job.status === "error") setError(job.message ?? "Processing failed.");
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId]);

  const busy = phase === "uploading" || phase === "queued" || phase === "processing";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setProgress(0);
    const id = (matchId.trim() || slugMatchId(file.name)).replace(/[^a-zA-Z0-9_-]/g, "-");
    setMatchId(id);
    setPhase("uploading");

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${id}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("match-uploads")
        .upload(path, file, {
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });
      if (upErr) throw upErr;

      const { data, error: jobErr } = await supabase
        .from("processing_jobs")
        .insert({ match_id: id, video_path: path, status: "queued" })
        .select("id")
        .single();
      if (jobErr) throw jobErr;

      const row = data as { id: string } | null;
      if (!row?.id) throw new Error("Could not create the processing job.");
      setJobId(row.id);
      setPhase("queued");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Analyze a <span className="text-home">Video</span>
          </h1>
          <p className="text-sm text-slate-400">
            Upload match footage and watch it play back as tactical telemetry.
          </p>
        </div>
        <Link href="/" className="text-sm text-home hover:underline">
          ← Dashboard
        </Link>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-900/60 p-5"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Match video</span>
          <input
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={(e) => {
              touchedId.current = false;
              setFile(e.target.files?.[0] ?? null);
            }}
            className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-home file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-950"
          />
          <span className="text-[11px] text-slate-500">
            Best results: one wide, fixed &ldquo;tactical&rdquo; camera. Up to 500&nbsp;MB.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Match ID</span>
          <input
            value={matchId}
            disabled={busy}
            onChange={(e) => {
              touchedId.current = true;
              setMatchId(e.target.value);
            }}
            placeholder="auto-generated from filename"
            className="w-64 rounded-md border border-white/10 bg-slate-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-home"
          />
        </label>

        <button
          type="submit"
          disabled={!file || busy}
          className="w-fit rounded-md bg-home px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working…" : "Upload & analyze"}
        </button>
      </form>

      {phase !== "idle" && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={
                "h-2.5 w-2.5 rounded-full " +
                (phase === "done"
                  ? "bg-emerald-400"
                  : phase === "error"
                    ? "bg-red-500"
                    : "animate-pulse bg-amber-400")
              }
            />
            <span className="text-slate-200">{STATUS_LABEL[phase]}</span>
          </div>

          {(phase === "processing" || phase === "done") && (
            <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-home transition-[width] duration-500"
                style={{ width: `${phase === "done" ? 100 : progress}%` }}
              />
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          {(phase === "queued" || phase === "processing" || phase === "done") && (
            <div className="flex flex-col gap-2 text-sm">
              <Link
                href={`/?match=${encodeURIComponent(matchId)}`}
                className="w-fit rounded-md bg-emerald-500 px-4 py-2 font-semibold text-slate-950 transition hover:brightness-110"
              >
                Open dashboard for &ldquo;{matchId}&rdquo;
              </Link>
              {phase !== "done" && (
                <p className="text-[11px] text-slate-500">
                  Positions stream in as the worker processes the video — open the dashboard to
                  watch live. (A processing worker must be running; see <code>worker/README.md</code>.)
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
