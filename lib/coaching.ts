import { analyzeTeam, type Insight } from "@/lib/analysis";
import { detectFormation, type FormationResult } from "@/lib/formation";
import { computeTeamMetrics } from "@/lib/tactics";
import type { PitchState, TeamMetrics } from "@/types";

export interface TeamSnapshot {
  metrics: TeamMetrics;
  formation: FormationResult;
  insights: Insight[];
}

/** Everything the coaching model (and the side panel) needs about the match. */
export interface MatchSnapshot {
  matchId: string;
  home: TeamSnapshot;
  away: TeamSnapshot;
}

/** Derive a full tactical snapshot for both teams from the live pitch state. */
export function buildMatchSnapshot(matchId: string, positions: PitchState): MatchSnapshot {
  const homeMetrics = computeTeamMetrics(positions, "home");
  const awayMetrics = computeTeamMetrics(positions, "away");
  const homeFormation = detectFormation(positions, "home");
  const awayFormation = detectFormation(positions, "away");

  return {
    matchId,
    home: {
      metrics: homeMetrics,
      formation: homeFormation,
      insights: analyzeTeam(homeMetrics, awayMetrics, homeFormation),
    },
    away: {
      metrics: awayMetrics,
      formation: awayFormation,
      insights: analyzeTeam(awayMetrics, homeMetrics, awayFormation),
    },
  };
}
