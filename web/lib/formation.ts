import { playersForTeam } from "@/lib/tactics";
import type { PitchState, Team } from "@/types";

export interface FormationResult {
  /** e.g. "4-3-3" (outfield lines from defence to attack). "—" if unknown. */
  label: string;
  /** Player counts per line, defence → attack. */
  lines: number[];
}

/**
 * Infer a team's outfield shape from live positions.
 *
 * Each outfield player (jersey ≠ 1) is projected onto a "depth" axis measured
 * from that team's own goal (home defends y≈0, away defends y≈100). We sort the
 * depths and split them into lines at the largest gaps — the classic way to read
 * banks of players off a 2D map. We prefer a 4-line split (e.g. 4-2-3-1) only
 * when there's a clear fourth band, otherwise fall back to 3 lines.
 */
export function detectFormation(state: PitchState, team: Team): FormationResult {
  const outfield = playersForTeam(state, team).filter((p) => p.jersey !== 1);
  if (outfield.length < 4) return { label: "—", lines: [] };

  const depthOf = (y: number) => (team === "home" ? y : 100 - y);
  const depths = outfield.map((p) => depthOf(p.y)).sort((a, b) => a - b);

  const gaps: { idx: number; gap: number }[] = [];
  for (let i = 1; i < depths.length; i++) {
    gaps.push({ idx: i, gap: depths[i] - depths[i - 1] });
  }
  const sortedGaps = [...gaps].sort((a, b) => b.gap - a.gap);

  // Use a 4-line read only with 10+ outfielders and a meaningful 3rd gap.
  const thirdGap = sortedGaps[2]?.gap ?? 0;
  const want4 = depths.length >= 10 && thirdGap > 6;

  let lines = splitIntoLines(depths, want4 ? 4 : 3);
  // Guard against a degenerate split (an empty band) — drop to 3 lines.
  if (lines.some((n) => n === 0)) lines = splitIntoLines(depths, 3);
  lines = lines.filter((n) => n > 0);

  return { label: lines.join("-"), lines };
}

/** Split sorted depths into `k` contiguous lines at the (k-1) largest gaps. */
function splitIntoLines(depths: number[], k: number): number[] {
  if (k <= 1 || depths.length <= k) return [depths.length];

  const gaps: { idx: number; gap: number }[] = [];
  for (let i = 1; i < depths.length; i++) {
    gaps.push({ idx: i, gap: depths[i] - depths[i - 1] });
  }
  const cuts = gaps
    .sort((a, b) => b.gap - a.gap)
    .slice(0, k - 1)
    .map((g) => g.idx)
    .sort((a, b) => a - b);

  const lines: number[] = [];
  let prev = 0;
  for (const c of cuts) {
    lines.push(c - prev);
    prev = c;
  }
  lines.push(depths.length - prev);
  return lines;
}
