"use client";

import { useMemo } from "react";

import { computeTeamMetrics } from "@/lib/tactics";
import type { PitchState, TeamMetrics } from "@/types";

interface MetricsPanelProps {
  positions: PitchState;
}

const metricRows: { key: keyof TeamMetrics; label: string; unit: string; hint: string }[] = [
  { key: "defensiveLine", label: "Def. line height", unit: "", hint: "Rearmost outfield line vs own goal" },
  { key: "centroidY", label: "Block centroid (len)", unit: "", hint: "Average position up the pitch" },
  { key: "width", label: "Block width", unit: "", hint: "Touchline-to-touchline spread" },
  { key: "depth", label: "Block depth", unit: "", hint: "Defence-to-attack spread (compactness)" },
  { key: "hullArea", label: "Space control", unit: "%", hint: "Convex-hull area of the shape" },
];

export default function MetricsPanel({ positions }: MetricsPanelProps) {
  const home = useMemo(() => computeTeamMetrics(positions, "home"), [positions]);
  const away = useMemo(() => computeTeamMetrics(positions, "away"), [positions]);

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
        Tactical Telemetry
      </h2>

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 text-sm">
        <div />
        <div className="text-right font-mono text-xs font-semibold text-home">
          HOME ({home.count})
        </div>
        <div className="text-right font-mono text-xs font-semibold text-away">
          AWAY ({away.count})
        </div>

        {metricRows.map((row) => (
          <div key={row.key} className="contents">
            <div className="border-t border-white/5 py-2">
              <div className="text-slate-200">{row.label}</div>
              <div className="text-[11px] text-slate-500">{row.hint}</div>
            </div>
            <div className="border-t border-white/5 py-2 text-right font-mono tabular-nums text-home">
              {format(home[row.key])}
              {row.unit}
            </div>
            <div className="border-t border-white/5 py-2 text-right font-mono tabular-nums text-away">
              {format(away[row.key])}
              {row.unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function format(value: number | string): string {
  return typeof value === "number" ? value.toFixed(1) : String(value);
}
