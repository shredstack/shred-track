"use client";

import { memo } from "react";

interface Point {
  loggedAt: string;
  timeSeconds: number;
}

interface Props {
  points: Point[];
  width?: number;
  height?: number;
}

function StationSparklineImpl({ points, width = 60, height = 18 }: Props) {
  if (!points || points.length < 2) return null;

  const sorted = [...points].sort(
    (a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
  );

  const values = sorted.map((p) => p.timeSeconds);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const stepX = sorted.length > 1 ? (width - 4) / (sorted.length - 1) : 0;
  const norm = (v: number) =>
    height - 2 - ((v - min) / range) * (height - 4);

  // Lower (faster) is better — invert so PR sits at the top.
  const ys = values.map((v) => norm(v));
  const xs = values.map((_, i) => 2 + i * stepX);

  // Path
  const d = ys.map((y, i) => `${i === 0 ? "M" : "L"}${xs[i]},${y}`).join(" ");

  // Latest point + PR (min time)
  const lastIdx = ys.length - 1;
  const minIdx = values.indexOf(min);
  const isLatestPR = minIdx === lastIdx;

  const accent = isLatestPR ? "var(--primary)" : "rgba(255,255,255,0.45)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle"
      aria-label="Recent station time trend"
    >
      <path
        d={d}
        fill="none"
        stroke={accent}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* PR dot */}
      <circle cx={xs[minIdx]} cy={ys[minIdx]} r={2} fill={accent} />
      {/* Latest dot (smaller, hollow) */}
      {!isLatestPR && (
        <circle
          cx={xs[lastIdx]}
          cy={ys[lastIdx]}
          r={1.75}
          fill="none"
          stroke={accent}
          strokeWidth={1}
        />
      )}
    </svg>
  );
}

export const StationSparkline = memo(StationSparklineImpl);
