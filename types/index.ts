export type Team = "home" | "away";

/** A single player's current location on the normalized 0-100 pitch. */
export interface PlayerPosition {
  team: Team;
  jersey: number;
  x: number; // 0-100 (pitch width)
  y: number; // 0-100 (pitch length)
}

/** Map of every tracked player, keyed by `${team}_${jersey}`. */
export type PitchState = Record<string, PlayerPosition>;

/** Raw row shape as stored in / streamed from Supabase. */
export interface LiveTrackingRow {
  id: string;
  match_id: string;
  team: Team;
  player_jersey: number;
  x_pos: number;
  y_pos: number;
  timestamp: string;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/** Per-team tactical metrics derived from the current pitch state. */
export interface TeamMetrics {
  team: Team;
  count: number;
  centroidX: number;
  centroidY: number;
  /** Average defensive-line height along the pitch length (0-100). */
  defensiveLine: number;
  /** Horizontal spread of the block (touchline to touchline). */
  width: number;
  /** Vertical spread of the block (own goal to opponent). */
  depth: number;
  /** Area of the convex hull of the outfield shape (% of pitch). */
  hullArea: number;
}

export const teamKey = (team: Team, jersey: number): string => `${team}_${jersey}`;

export type JobStatus = "queued" | "processing" | "done" | "error";

/** A video-upload analysis job, as stored in `processing_jobs`. */
export interface ProcessingJob {
  id: string;
  match_id: string;
  video_path: string | null;
  source_url: string | null;
  max_seconds: number | null;
  status: JobStatus;
  message: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}
