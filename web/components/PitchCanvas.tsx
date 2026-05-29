"use client";

import { useEffect, useRef } from "react";

import { convexHull, playersForTeam } from "@/lib/tactics";
import type { PitchState, PlayerPosition } from "@/types";

interface PitchCanvasProps {
  positions: PitchState;
  showHull?: boolean;
  showCentroid?: boolean;
}

const HOME_COLOR = "#38bdf8";
const AWAY_COLOR = "#f97316";
const ASPECT = 1.5; // length:width — a 105x68m pitch is ~1.54

/** Eased interpolation rendered positions track toward, for smooth motion. */
type Rendered = Record<string, { x: number; y: number; team: string; jersey: number }>;

export default function PitchCanvas({
  positions,
  showHull = true,
  showCentroid = true,
}: PitchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<PitchState>(positions);
  const renderedRef = useRef<Rendered>({});
  const rafRef = useRef<number>(0);

  // Keep the latest targets in a ref so the rAF loop always reads fresh data
  // without restarting the animation.
  useEffect(() => {
    targetRef.current = positions;
  }, [positions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Constrain to the pitch aspect ratio inside the available box.
      width = rect.width;
      height = Math.min(rect.width / ASPECT, rect.height);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Normalized (0-100, where y=0 is bottom) -> canvas pixels (y grows down).
    const px = (x: number) => (x / 100) * width;
    const py = (y: number) => height - (y / 100) * height;

    const drawPitch = () => {
      ctx.fillStyle = "#0b3d1f";
      ctx.fillRect(0, 0, width, height);

      // Mowing stripes for that broadcast look.
      const stripes = 10;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
        ctx.fillRect(0, (i / stripes) * height, width, height / stripes);
      }

      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      const m = 6; // margin
      // Outer boundary
      ctx.strokeRect(m, m, width - 2 * m, height - 2 * m);
      // Halfway line
      ctx.beginPath();
      ctx.moveTo(m, height / 2);
      ctx.lineTo(width - m, height / 2);
      ctx.stroke();
      // Center circle + spot
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, width * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fill();
      // Penalty boxes (top = away goal, bottom = home goal)
      const boxW = width * 0.46;
      const boxH = height * 0.16;
      ctx.strokeRect((width - boxW) / 2, m, boxW, boxH); // top
      ctx.strokeRect((width - boxW) / 2, height - m - boxH, boxW, boxH); // bottom
    };

    const drawHull = (players: PlayerPosition[], rendered: Rendered, color: string) => {
      if (players.length < 3) return;
      // Build hull from interpolated rendered positions for visual consistency.
      const pts = players
        .filter((p) => p.jersey !== 1)
        .map((p) => {
          const r = rendered[`${p.team}_${p.jersey}`];
          return { ...p, x: r ? r.x : p.x, y: r ? r.y : p.y };
        });
      const hull = convexHull(pts);
      if (hull.length < 3) return;
      ctx.beginPath();
      ctx.moveTo(px(hull[0].x), py(hull[0].y));
      for (let i = 1; i < hull.length; i++) ctx.lineTo(px(hull[i].x), py(hull[i].y));
      ctx.closePath();
      ctx.fillStyle = `${color}22`;
      ctx.fill();
      ctx.strokeStyle = `${color}88`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    const drawCentroid = (players: PlayerPosition[], rendered: Rendered, color: string) => {
      if (players.length === 0) return;
      let sx = 0;
      let sy = 0;
      for (const p of players) {
        const r = rendered[`${p.team}_${p.jersey}`];
        sx += r ? r.x : p.x;
        sy += r ? r.y : p.y;
      }
      const cx = px(sx / players.length);
      const cy = py(sy / players.length);
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy);
      ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx, cy + 7);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    const drawPlayer = (
      x: number,
      y: number,
      color: string,
      jersey: number,
    ) => {
      const cx = px(x);
      const cy = py(y);
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.stroke();
      ctx.fillStyle = "#0b1220";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(jersey), cx, cy);
    };

    const tick = () => {
      const target = targetRef.current;
      const rendered = renderedRef.current;

      // Ease rendered positions toward targets (exponential smoothing).
      const keys = Object.keys(target);
      for (const k of keys) {
        const t = target[k];
        const r = rendered[k];
        if (!r) {
          rendered[k] = { x: t.x, y: t.y, team: t.team, jersey: t.jersey };
        } else {
          r.x += (t.x - r.x) * 0.2;
          r.y += (t.y - r.y) * 0.2;
        }
      }
      // Drop players that disappeared from the state.
      for (const k of Object.keys(rendered)) {
        if (!(k in target)) delete rendered[k];
      }

      drawPitch();

      const home = playersForTeam(target, "home");
      const away = playersForTeam(target, "away");

      if (showHull) {
        drawHull(home, rendered, HOME_COLOR);
        drawHull(away, rendered, AWAY_COLOR);
      }
      if (showCentroid) {
        drawCentroid(home, rendered, HOME_COLOR);
        drawCentroid(away, rendered, AWAY_COLOR);
      }

      for (const k of Object.keys(rendered)) {
        const r = rendered[k];
        drawPlayer(r.x, r.y, r.team === "home" ? HOME_COLOR : AWAY_COLOR, r.jersey);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [showHull, showCentroid]);

  return (
    <div ref={containerRef} className="flex w-full items-center justify-center">
      <canvas ref={canvasRef} className="rounded-lg shadow-2xl ring-1 ring-white/10" />
    </div>
  );
}
