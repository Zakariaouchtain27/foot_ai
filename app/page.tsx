"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CoachingPanel from "@/components/CoachingPanel";
import MatchControls from "@/components/MatchControls";
import MetricsPanel from "@/components/MetricsPanel";
import PitchCanvas from "@/components/PitchCanvas";
import { useMatchRealtime } from "@/hooks/useMatchRealtime";

export default function Home() {
  const [matchId, setMatchId] = useState("demo-001");
  const [showHull, setShowHull] = useState(true);
  const [showCentroid, setShowCentroid] = useState(true);

  const { positions, status, updatesPerSecond } = useMatchRealtime(matchId);

  // Allow deep-linking a specific match, e.g. /?match=demo-001 (used by /upload).
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("match");
    if (m) setMatchId(m);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            PitchSight <span className="text-home">Live</span>
          </h1>
          <p className="text-sm text-slate-400">Real-time tactical telemetry · bench dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/upload"
            className="rounded-md border border-home/40 px-3 py-1.5 text-sm font-semibold text-home transition hover:bg-home/10"
          >
            Analyze a video
          </Link>
          <div className="hidden text-right text-xs text-slate-500 sm:block">
            <span className="text-home">●</span> Home &nbsp; <span className="text-away">●</span> Away
          </div>
        </div>
      </header>

      <MatchControls
        matchId={matchId}
        onMatchIdChange={setMatchId}
        status={status}
        updatesPerSecond={updatesPerSecond}
        showHull={showHull}
        showCentroid={showCentroid}
        onToggleHull={setShowHull}
        onToggleCentroid={setShowCentroid}
      />

      <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <PitchCanvas positions={positions} showHull={showHull} showCentroid={showCentroid} />
        </section>

        <aside className="flex flex-col gap-4">
          <MetricsPanel positions={positions} />
          <CoachingPanel matchId={matchId} positions={positions} />
          {status !== "connected" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              {status === "error"
                ? "Realtime connection error — check Supabase env vars and that the table is in the supabase_realtime publication."
                : "Waiting for a live stream. Run the ingestion script with the same Match ID:"}
              <pre className="mt-2 overflow-x-auto rounded bg-slate-950/70 p-2 font-mono text-xs text-slate-300">
                python tracker.py --mode mock --match-id {matchId || "demo-001"}
              </pre>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
