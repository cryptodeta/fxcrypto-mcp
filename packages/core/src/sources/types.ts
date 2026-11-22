import type { Asset } from "../assets.js";
import type { HttpClient } from "../http.js";

export interface Quote {
  from: string;
  to: string;
  /** 1 unit of `from` = `rate` units of `to`. */
  rate: number;
  source: string;
  sourceUrl: string;
  /** When the upstream says the rate is valid (date or timestamp). */
  asOf: string;
  /** When we fetched it (ISO). */
  fetchedAt: string;
}

export interface RateTable {
  base: string;
  /** Upper-case code -> units per 1 base. */
  rates: Record<string, number>;
  source: string;
  sourceUrl: string;
  asOf: string;
  fetchedAt: string;
}

export interface SourceContext {
  http: HttpClient;
  /** Optional CoinGecko demo key (still works without). */
  coingeckoKey?: string;
}

export interface RateSource {
  id: string;
  name: string;
  homepage: string;
  /** Which asset kinds the source can price. */
  covers: "fiat" | "crypto" | "both";
  /** True when it can answer historical (dated) quotes. */
  history: boolean;
  quote(from: Asset, to: Asset, ctx: SourceContext, date?: string): Promise<Quote | null>;
  table?(base: Asset, ctx: SourceContext, date?: string): Promise<RateTable | null>;
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

/** Cache TTL for a dated request: immutable past days are kept long, today is short. */
export function ttlForDate(date: string | undefined, latestTtl: number): number {
  if (!date) return latestTtl;
  const today = new Date().toISOString().slice(0, 10);
  return date >= today ? latestTtl : 7 * DAY;
}

export function fromTable(table: RateTable | null, to: string): Quote | null {
  if (!table) return null;
  const rate = table.rates[to.toUpperCase()];
  if (!rate || !Number.isFinite(rate)) return null;
  return {
    from: table.base,
    to: to.toUpperCase(),
    rate,
    source: table.source,
    sourceUrl: table.sourceUrl,
    asOf: table.asOf,
    fetchedAt: table.fetchedAt,
  };
}

export function upperKeys(obj: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = typeof v === "string" ? Number(v) : (v as number);
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out[k.toUpperCase()] = n;
  }
  return out;
}
