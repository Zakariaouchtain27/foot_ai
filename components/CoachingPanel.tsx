"use client";

import { useMemo, useRef, useState } from "react";

import type { Severity } from "@/lib/analysis";
import { buildMatchSnapshot } from "@/lib/coaching";
import type { PitchState } from "@/types";

interface CoachingPanelProps {
  matchId: string;
  positions: PitchState;
}

const severityStyle: Record<Severity, string> = {
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  alert: "border-red-500/30 bg-red-500/10 text-red-200",
};

const severityDot: Record<Severity, string> = {
  good: "bg-emerald-400",
  info: "bg-sky-400",
  warn: "bg-amber-400",
  alert: "bg-red-400",
};

export default function CoachingPanel({ matchId, positions }: CoachingPanelProps) {
  const snapshot = useMemo(
    () => buildMatchSnapshot(matchId, positions),
    [matchId, positions],
  );

  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasPlayers = snapshot.home.metrics.count > 0 || snapshot.away.metrics.count > 0;

  const generate = async () => {
    if (loading) {
      abortRef.current?.abort();
      setLoading(false);
      return;
    }
    setError(null);
    setReport("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Snapshot is captured at click time so the report reflects this moment.
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMatchSnapshot(matchId, positions)),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        setReport((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // user cancelled — leave whatever streamed so far
      } else {
        setError(err instanceof Error ? err.message : "Failed to generate report.");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Coaching Insights
        </h2>
        <div className="flex gap-3 font-mono text-xs">
          <span className="text-home">{snapshot.home.formation.label}</span>
          <span className="text-slate-600">vs</span>
          <span className="text-away">{snapshot.away.formation.label}</span>
        </div>
      </div>

      {/* Live weakness flags */}
      <div className="space-y-3">
        <FlagList title="Home" colorClass="text-home" insights={snapshot.home.insights} />
        <FlagList title="Away" colorClass="text-away" insights={snapshot.away.insights} />
      </div>

      {/* AI coaching report */}
      <div className="mt-4 border-t border-white/10 pt-4">
        <button
          onClick={generate}
          disabled={!hasPlayers}
          className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Generating… (click to stop)" : "Generate AI coaching report"}
        </button>

        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

        {report && (
          <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-950/70 p-3 text-sm leading-relaxed text-slate-200">
            {report}
            {loading && <span className="ml-0.5 animate-pulse">▋</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function FlagList({
  title,
  colorClass,
  insights,
}: {
  title: string;
  colorClass: string;
  insights: { id: string; severity: Severity; title: string; detail: string }[];
}) {
  if (insights.length === 0) {
    return (
      <div>
        <div className={`mb-1 text-xs font-semibold ${colorClass}`}>{title}</div>
        <p className="text-xs text-slate-500">No notable flags yet.</p>
      </div>
    );
  }
  return (
    <div>
      <div className={`mb-1 text-xs font-semibold ${colorClass}`}>{title}</div>
      <ul className="space-y-1.5">
        {insights.map((i) => (
          <li
            key={i.id}
            className={`flex gap-2 rounded-md border px-2 py-1.5 text-xs ${severityStyle[i.severity]}`}
          >
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${severityDot[i.severity]}`} />
            <span>
              <span className="font-semibold">{i.title}.</span> {i.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
