import type { Asset } from "../assets.js";
import type { Point } from "../stats.js";
import {
  DAY,
  fromTable,
  HOUR,
  type RateSource,
  type RateTable,
  type SourceContext,
  ttlForDate,
} from "./types.js";

const BASE = "https://api.frankfurter.dev/v1";

interface FrankfurterLatest {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface FrankfurterSeries {
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
}

export async function frankfurterCurrencies(ctx: SourceContext): Promise<Set<string>> {
  const data = await ctx.http.json<Record<string, string>>(`${BASE}/currencies`, {
    ttlMs: DAY,
    source: "Frankfurter",
  });
  return new Set(Object.keys(data));
}

async function supports(ctx: SourceContext, ...assets: Asset[]): Promise<boolean> {
  if (assets.some((a) => a.kind !== "fiat")) return false;
  const set = await frankfurterCurrencies(ctx);
  return assets.every((a) => set.has(a.code));
}

/** European Central Bank reference rates via Frankfurter (~30 major currencies, history back to 1999). */
export const frankfurter: RateSource & {
  series(from: Asset, to: Asset, start: string, end: string, ctx: SourceContext): Promise<Point[] | null>;
} = {
  id: "frankfurter",
  name: "Frankfurter (European Central Bank)",
  homepage: "https://frankfurter.dev",
  covers: "fiat",
  history: true,

  async table(base, ctx, date) {
    if (!(await supports(ctx, base))) return null;
    const url = `${BASE}/${date ?? "latest"}?base=${base.code}`;
    const res = await ctx.http.get<FrankfurterLatest>(url, {
      ttlMs: ttlForDate(date, HOUR),
      source: "Frankfurter",
    });
    const table: RateTable = {
      base: base.code,
      rates: { ...res.data.rates },
      source: this.name,
      sourceUrl: url,
      asOf: `${res.data.date} (ECB reference rate)`,
      fetchedAt: res.fetchedAt,
    };
    return table;
  },

  async quote(from, to, ctx, date) {
    if (!(await supports(ctx, from, to))) return null;
    return fromTable((await this.table?.(from, ctx, date)) ?? null, to.code);
  },

  async series(from, to, start, end, ctx) {
    if (!(await supports(ctx, from, to))) return null;
    const url = `${BASE}/${start}..${end}?base=${from.code}&symbols=${to.code}`;
    const data = await ctx.http.json<FrankfurterSeries>(url, {
      ttlMs: ttlForDate(end, HOUR),
      source: "Frankfurter",
    });
    return Object.entries(data.rates)
      .map(([t, r]) => ({ t, v: r[to.code] as number }))
      .filter((p) => Number.isFinite(p.v))
      .sort((a, b) => a.t.localeCompare(b.t));
  },
};
