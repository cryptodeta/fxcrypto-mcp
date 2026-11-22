import { sig } from "./format.js";

export interface Point {
  /** ISO date (YYYY-MM-DD) or ISO timestamp. */
  t: string;
  v: number;
}

export interface SeriesStats {
  points: number;
  start: Point;
  end: Point;
  change: number;
  changePct: number;
  min: Point;
  max: Point;
  avg: number;
  /** Standard deviation of period-over-period % returns. */
  volatilityPct: number;
}

export function seriesStats(points: Point[]): SeriesStats | null {
  const clean = points.filter((p) => Number.isFinite(p.v));
  if (clean.length === 0) return null;
  const first = clean[0]!;
  const last = clean[clean.length - 1]!;
  let min = first;
  let max = first;
  let sum = 0;
  for (const p of clean) {
    if (p.v < min.v) min = p;
    if (p.v > max.v) max = p;
    sum += p.v;
  }
  const returns: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1]!.v;
    if (prev !== 0) returns.push((clean[i]!.v - prev) / prev);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length || 1);
  return {
    points: clean.length,
    start: first,
    end: last,
    change: sig(last.v - first.v),
    changePct: first.v === 0 ? 0 : sig(((last.v - first.v) / first.v) * 100, 6),
    min,
    max,
    avg: sig(sum / clean.length),
    volatilityPct: sig(Math.sqrt(variance) * 100, 4),
  };
}

/** Keep at most `max` points, evenly spaced, always keeping first and last. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max || max < 2) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]!);
  return out;
}

/** Date helpers (UTC). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
