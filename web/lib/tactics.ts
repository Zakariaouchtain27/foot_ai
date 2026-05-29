import type { PitchState, PlayerPosition, Team, TeamMetrics } from "@/types";

/** Filter the pitch state down to one team's players. */
export function playersForTeam(state: PitchState, team: Team): PlayerPosition[] {
  return Object.values(state).filter((p) => p.team === team);
}

/**
 * Convex hull (monotone chain / Andrew's algorithm). Returns the hull points in
 * counter-clockwise order. Used to visualize and measure a team's shape and the
 * space it occupies.
 */
export function convexHull(points: PlayerPosition[]): PlayerPosition[] {
  if (points.length < 3) return [...points];

  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const cross = (o: PlayerPosition, a: PlayerPosition, b: PlayerPosition): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: PlayerPosition[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: PlayerPosition[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Shoelace area of a simple polygon (absolute value). */
export function polygonArea(poly: PlayerPosition[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/**
 * Compute tactical metrics for a team. The goalkeeper (jersey 1) is excluded
 * from shape/spread metrics so it doesn't distort the outfield block.
 */
export function computeTeamMetrics(state: PitchState, team: Team): TeamMetrics {
  const all = playersForTeam(state, team);
  const outfield = all.filter((p) => p.jersey !== 1);
  const empty: TeamMetrics = {
    team,
    count: all.length,
    centroidX: 0,
    centroidY: 0,
    defensiveLine: 0,
    width: 0,
    depth: 0,
    hullArea: 0,
  };
  if (all.length === 0) return empty;

  const centroidX = avg(all.map((p) => p.x));
  const centroidY = avg(all.map((p) => p.y));

  const shape = outfield.length >= 3 ? outfield : all;
  const xs = shape.map((p) => p.x);
  const ys = shape.map((p) => p.y);

  // Defensive line height = the rearmost outfield players relative to that
  // team's own goal. Home defends y≈0, away defends y≈100, so we normalize
  // "height up the pitch" from each team's perspective.
  const defensiveLine =
    team === "home" ? Math.min(...ys) : 100 - Math.max(...ys);

  return {
    team,
    count: all.length,
    centroidX: round(centroidX),
    centroidY: round(centroidY),
    defensiveLine: round(defensiveLine),
    width: round(Math.max(...xs) - Math.min(...xs)),
    depth: round(Math.max(...ys) - Math.min(...ys)),
    hullArea: round(polygonArea(convexHull(shape))),
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
