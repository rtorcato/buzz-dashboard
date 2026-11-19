"use client";

import { cn } from "cn";
import { useId, useState } from "react";
import { dayName, hourLabel } from "@/lib/overview-range";

// DESIGN.md → Obsidian redesign → Overview. Hand-drawn SVG, like the Agents
// sparkline: no axes worth a chart library. The only gradients are the fades
// under lines (series colour at 35% to 0%), which the spec allows.

/** A smooth path through points (Catmull-Rom as cubic Béziers), y clamped. */
export function smoothPath(
  pts: [number, number][],
  minY: number,
  maxY: number,
): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const clamp = (y: number) => Math.min(maxY, Math.max(minY, y));
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function points(values: number[], w: number, h: number, max: number, pad = 2) {
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i): [number, number] => [
    i * step,
    h - pad - (v / (max || 1)) * (h - 2 * pad),
  ]);
}

// useId's ids carry characters a url(#…) reference can't hold.
const svgId = (raw: string) => `f${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;

function Fade({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/** A 44px sparkline with the fade, for the KPI cards. Decorative: the card says the value. */
export function FadeSparkline({
  values,
  color,
  fill = true,
  className,
}: {
  values: number[];
  color: string;
  /** False draws the line alone, as on the agents grid. */
  fill?: boolean;
  className?: string;
}) {
  const id = svgId(useId());
  const [w, h] = [120, 44];
  const max = Math.max(1, ...values);
  const pts = points(values, w, h, max);
  const line = smoothPath(pts, 0, h);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-11 w-full", className)}
      aria-hidden
    >
      {fill && (
        <>
          <defs>
            <Fade id={id} color={color} />
          </defs>
          <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
    </svg>
  );
}

export type Series = {
  label: string;
  color: string;
  /** Null when the source isn't connected: a dashed legend entry, no line. */
  values: number[] | null;
};

/**
 * Hive activity: smoothed lines with fades, a hover tooltip with the bucket
 * and values, and a dashed crosshair. `labels` names each bucket.
 */
export function ActivityChart({
  series,
  labels,
  height = 240,
}: {
  series: Series[];
  labels: string[];
  height?: number;
}) {
  const id = svgId(useId());
  const [hover, setHover] = useState<number | null>(null);
  const drawn = series.filter(
    (s): s is Series & { values: number[] } => s.values !== null,
  );
  const max = Math.max(1, ...drawn.flatMap((s) => s.values));
  const w = 600;
  const h = height;
  const n = labels.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * w : 0);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setHover(Math.min(n - 1, Math.max(0, Math.round(f * (n - 1)))));
  };

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-0.5 w-3.5 rounded-full",
                s.values === null && "border-t border-dashed bg-transparent",
              )}
              style={
                s.values === null
                  ? { borderColor: "var(--muted-foreground)" }
                  : { background: s.color }
              }
              aria-hidden
            />
            {s.values === null ? `${s.label} · not connected` : s.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <div className="flex">
          <div
            className="flex shrink-0 flex-col justify-between pr-2 text-right font-mono text-[11px] text-faint tabular-nums"
            style={{ height: h }}
            aria-hidden
          >
            {[...ticks].reverse().map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 3 fixed ticks
              <span key={i}>{t}</span>
            ))}
          </div>
          <svg
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            className="w-full touch-none"
            style={{ height: h }}
            role="img"
            aria-label={`Hive activity: ${drawn
              .map((s) => `${s.label} ${s.values.reduce((a, b) => a + b, 0)}`)
              .join(", ")}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              {drawn.map((s, i) => (
                <Fade key={s.label} id={`${id}-${i}`} color={s.color} />
              ))}
            </defs>
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={0}
                x2={w}
                y1={f * (h - 4) + 2}
                y2={f * (h - 4) + 2}
                stroke="var(--grid)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {drawn.map((s, i) => {
              const line = smoothPath(points(s.values, w, h, max), 0, h);
              return (
                <g key={s.label}>
                  <path
                    d={`${line} L${w},${h} L0,${h} Z`}
                    fill={`url(#${id}-${i})`}
                  />
                  <path
                    d={line}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={0}
                y2={h}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-[10px] border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: `calc(2rem + (100% - 2rem) * ${n > 1 ? hover / (n - 1) : 0})`,
            }}
          >
            <p className="mb-1 font-medium">{labels[hover]}</p>
            {drawn.map((s) => (
              <p
                key={s.label}
                className="flex items-center gap-2 text-muted-foreground"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.label}
                <span className="ml-auto pl-3 font-mono text-foreground tabular-nums">
                  {s.values[hover]}
                </span>
              </p>
            ))}
          </div>
        )}
        <div
          className="mt-1.5 flex justify-between pl-8 font-mono text-[11px] text-faint"
          aria-hidden
        >
          <span>{labels[0]}</span>
          <span>{labels[Math.floor((n - 1) / 2)]}</span>
          <span>{labels[n - 1]}</span>
        </div>
      </div>
    </div>
  );
}

/** Spend by model: a donut of the tier totals with the range total inside. */
export function Donut({
  values,
  colors,
  center,
  sub,
}: {
  values: number[];
  colors: string[];
  center: string;
  sub: string;
}) {
  const total = values.reduce((a, b) => a + b, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative mx-auto size-44">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle
          cx={50}
          cy={50}
          r={r}
          fill="none"
          stroke="var(--chip)"
          strokeWidth={10}
        />
        {total > 0 &&
          values.map((v, i) => {
            if (v <= 0) return null;
            const len = (v / total) * c;
            // A 1.5-unit gap between segments, like the stacked Cost bars.
            const seg = (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: 3 fixed tiers
                key={i}
                cx={50}
                cy={50}
                r={r}
                fill="none"
                stroke={colors[i]}
                strokeWidth={10}
                strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return seg;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tracking-tight tabular-nums">
          {center}
        </span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

// Monday first, as the mockup.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const STEP_BG = [
  "bg-chip",
  "bg-series-1/15",
  "bg-series-1/30",
  "bg-series-1/50",
  "bg-series-1/75",
  "bg-series-1",
];

/**
 * When the hive works: 7 × 24 cells in five steps of --series-1. The cells
 * are graphics, so a legend, a tooltip per cell and a hidden table carry the
 * same numbers.
 */
export function Heatmap({
  grid,
  steps,
  unit,
}: {
  grid: number[][];
  /** heatStep per cell, 0 to 5. */
  steps: number[][];
  /** "messages" or "messages on average". */
  unit: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[2rem_1fr] gap-x-2 gap-y-1" aria-hidden>
        {ORDER.map((d) => (
          <div key={d} className="contents">
            <span className="text-[11px] leading-3 text-faint">
              {dayName(d)}
            </span>
            <div className="grid grid-cols-24 gap-0.5">
              {grid[d].map((n, h) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed 24 hours
                  key={h}
                  title={`${dayName(d)} ${hourLabel(h, true)} · ${n} ${unit}`}
                  className={cn("h-3 rounded-[3px]", STEP_BG[steps[d][h]])}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground"
        aria-hidden
      >
        Less
        {STEP_BG.slice(1).map((c) => (
          <span key={c} className={cn("size-3 rounded-[3px]", c)} />
        ))}
        More
      </div>
      <table className="sr-only">
        <caption>Messages by weekday and hour</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {Array.from({ length: 24 }, (_, h) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed 24 hours
              <th key={h} scope="col">
                {hourLabel(h, true)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ORDER.map((d) => (
            <tr key={d}>
              <th scope="row">{dayName(d)}</th>
              {grid[d].map((n, h) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed 24 hours
                <td key={h}>{n}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
