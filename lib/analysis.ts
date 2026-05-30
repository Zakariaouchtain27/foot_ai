import type { FormationResult } from "@/lib/formation";
import type { TeamMetrics } from "@/types";

export type Severity = "good" | "info" | "warn" | "alert";

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

/**
 * Turn raw spatial metrics into plain-English tactical flags a coach can act on.
 *
 * These are deliberately simple, transparent rules (not a black box) so the
 * bench can trust them. Thresholds are expressed on the normalized 0-100 pitch.
 * `m` is the team being analyzed; `opp` is the opponent (for relative reads).
 */
export function analyzeTeam(
  m: TeamMetrics,
  opp: TeamMetrics,
  formation: FormationResult,
): Insight[] {
  const insights: Insight[] = [];
  if (m.count === 0) return insights;

  // --- Defensive line height -------------------------------------------------
  if (m.defensiveLine > 42) {
    insights.push({
      id: "high-line",
      severity: "alert",
      title: "Very high defensive line",
      detail:
        "Defenders are pushed well up the pitch — vulnerable to balls played in behind. Make sure the keeper sweeps and the press is coordinated.",
    });
  } else if (m.defensiveLine < 16) {
    insights.push({
      id: "deep-block",
      severity: "warn",
      title: "Sitting very deep",
      detail:
        "The block is camped near its own goal, inviting sustained pressure. Look for an outlet to relieve and push up as a unit.",
    });
  }

  // --- Width -----------------------------------------------------------------
  if (m.width > 78) {
    insights.push({
      id: "too-wide",
      severity: "warn",
      title: "Block is stretched wide",
      detail:
        "Large touchline-to-touchline spread leaves gaps centrally. Risk of being split by passes through the middle.",
    });
  } else if (m.width < 42) {
    insights.push({
      id: "too-narrow",
      severity: "warn",
      title: "Block is narrow",
      detail:
        "The team is compact centrally but the flanks are open — the opponent can switch play and attack wide 1v1s.",
    });
  }

  // --- Depth / compactness ---------------------------------------------------
  if (m.depth > 58) {
    insights.push({
      id: "stretched-lines",
      severity: "alert",
      title: "Lines are stretched apart",
      detail:
        "Big gap between defence and attack — space between the lines for the opponent to receive and turn. Tighten the distances.",
    });
  } else if (m.depth < 28) {
    insights.push({
      id: "compact",
      severity: "good",
      title: "Compact between the lines",
      detail: "Defence-to-attack distance is tight — hard to play through. Good shape.",
    });
  }

  // --- Space control vs opponent ---------------------------------------------
  if (opp.count > 0 && m.hullArea > 0 && opp.hullArea > 0) {
    const diff = m.hullArea - opp.hullArea;
    if (diff > 250) {
      insights.push({
        id: "space-dominance",
        severity: "good",
        title: "Controlling more space",
        detail: "This team's shape covers noticeably more of the pitch than the opponent's.",
      });
    } else if (diff < -250) {
      insights.push({
        id: "space-ceded",
        severity: "warn",
        title: "Ceding space",
        detail:
          "The opponent's shape covers more ground — you may be getting pinned. Consider stepping up or spreading out.",
      });
    }
  }

  // --- Formation sanity note -------------------------------------------------
  if (formation.label !== "—") {
    insights.push({
      id: "formation",
      severity: "info",
      title: `Shape reads as ${formation.label}`,
      detail: "Live outfield banks inferred from current positions.",
    });
  }

  return insights;
}
