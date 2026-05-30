"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabaseClient";
import {
  type ConnectionStatus,
  type LiveTrackingRow,
  type PitchState,
  teamKey,
} from "@/types";

interface UseMatchRealtimeResult {
  positions: PitchState;
  status: ConnectionStatus;
  /** Wall-clock ms of the most recent update applied to state. */
  lastUpdate: number | null;
  /** Rolling estimate of inserts processed per second. */
  updatesPerSecond: number;
}

const FLUSH_INTERVAL_MS = 100; // coalesce bursts -> ~10 React renders/sec max

/**
 * Subscribe to live player positions for a given match.
 *
 * Strategy:
 *  - Seed state with the latest known position per player (so the pitch isn't
 *    empty on load).
 *  - Listen to INSERT events filtered server-side by `match_id`.
 *  - Buffer incoming rows in a ref and flush to React state on a fixed interval
 *    so a 22-row-per-tick firehose doesn't trigger a render per row.
 */
export function useMatchRealtime(matchId: string): UseMatchRealtimeResult {
  const [positions, setPositions] = useState<PitchState>({});
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [updatesPerSecond, setUpdatesPerSecond] = useState(0);

  // Mutable buffer of the freshest position per player between flushes.
  const bufferRef = useRef<PitchState>({});
  const dirtyRef = useRef(false);
  const eventCountRef = useRef(0);

  useEffect(() => {
    if (!matchId) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("connecting");
    bufferRef.current = {};
    setPositions({});

    const applyRow = (row: LiveTrackingRow) => {
      bufferRef.current[teamKey(row.team, row.player_jersey)] = {
        team: row.team,
        jersey: row.player_jersey,
        x: row.x_pos,
        y: row.y_pos,
      };
      dirtyRef.current = true;
      eventCountRef.current += 1;
    };

    // 1. Seed with the latest rows for this match so the pitch renders instantly.
    const seed = async () => {
      const { data, error } = await supabase
        .from("live_match_tracking")
        .select("*")
        .eq("match_id", matchId)
        .order("timestamp", { ascending: false })
        .limit(200);

      if (cancelled || error || !data) return;
      // Iterate oldest->newest so the most recent row wins per player.
      for (let i = data.length - 1; i >= 0; i--) {
        applyRow(data[i] as LiveTrackingRow);
      }
      flush();
    };

    // 2. Realtime subscription, filtered server-side by match_id.
    const channel: RealtimeChannel = supabase
      .channel(`live_match_tracking:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_match_tracking",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => applyRow(payload.new as LiveTrackingRow),
      )
      .subscribe((channelStatus) => {
        if (cancelled) return;
        // Cast to string so the comparison is robust across supabase-js versions
        // (some type the callback param as an enum, others as a string union).
        const st = String(channelStatus);
        if (st === "SUBSCRIBED") setStatus("connected");
        else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
          setStatus("error");
        }
      });

    const flush = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setPositions({ ...bufferRef.current });
      setLastUpdate(Date.now());
    };

    const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

    // Recompute the updates/sec estimate once per second.
    const rateTimer = setInterval(() => {
      setUpdatesPerSecond(eventCountRef.current);
      eventCountRef.current = 0;
    }, 1000);

    void seed();

    return () => {
      cancelled = true;
      clearInterval(flushTimer);
      clearInterval(rateTimer);
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  return { positions, status, lastUpdate, updatesPerSecond };
}
