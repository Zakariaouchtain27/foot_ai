"use client";

import { useState } from "react";

import type { ConnectionStatus } from "@/types";

interface MatchControlsProps {
  matchId: string;
  onMatchIdChange: (matchId: string) => void;
  status: ConnectionStatus;
  updatesPerSecond: number;
  showHull: boolean;
  showCentroid: boolean;
  onToggleHull: (value: boolean) => void;
  onToggleCentroid: (value: boolean) => void;
}

const statusStyles: Record<ConnectionStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-slate-500", label: "Idle" },
  connecting: { dot: "bg-amber-400 animate-pulse", label: "Connecting…" },
  connected: { dot: "bg-emerald-400", label: "Live" },
  error: { dot: "bg-red-500", label: "Error" },
};

export default function MatchControls({
  matchId,
  onMatchIdChange,
  status,
  updatesPerSecond,
  showHull,
  showCentroid,
  onToggleHull,
  onToggleCentroid,
}: MatchControlsProps) {
  const [draft, setDraft] = useState(matchId);
  const s = statusStyles[status];

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onMatchIdChange(draft.trim());
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Match ID</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="demo-001"
            className="w-44 rounded-md border border-white/10 bg-slate-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-home"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-home px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:brightness-110"
        >
          Connect
        </button>
      </form>

      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
        <span className="text-sm text-slate-300">{s.label}</span>
        {status === "connected" && (
          <span className="font-mono text-xs text-slate-500">{updatesPerSecond} upd/s</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-4 text-sm">
        <Toggle label="Convex hull" checked={showHull} onChange={onToggleHull} />
        <Toggle label="Centroid" checked={showCentroid} onChange={onToggleCentroid} />
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-home"
      />
      <span className="text-slate-300">{label}</span>
    </label>
  );
}
