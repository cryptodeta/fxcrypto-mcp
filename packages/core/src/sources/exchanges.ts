import type { Asset } from "../assets.js";
import type { Quote, RateSource, SourceContext } from "./types.js";

function pairs(
  from: Asset,
  to: Asset,
  usdAliases: string[],
): Array<{ base: string; quote: string; invert: boolean }> {
  const out: Array<{ base: string; quote: string; invert: boolean }> = [];
  const fromCodes = from.code === "USD" ? usdAliases : [from.code];
  const toCodes = to.code === "USD" ? usdAliases : [to.code];
  for (const t of toCodes)
    for (const f of fromCodes) if (f !== t) out.push({ base: f, quote: t, invert: false });
  for (const t of toCodes)
    for (const f of fromCodes) if (f !== t) out.push({ base: t, quote: f, invert: true });
  return out.slice(0, 4);
}

async function firstPair(
  from: Asset,
  to: Asset,
  fetchPair: (
    base: string,
    quote: string,
  ) => Promise<{ price: number; url: string; fetchedAt: string } | null>,
  name: string,
  usdAliases: string[],
): Promise<Quote | null> {
  if (from.kind !== "crypto" && to.kind !== "crypto") return null;
  if (from.kind === "metal" || to.kind === "metal") return null;
  for (const p of pairs(from, to, usdAliases)) {
    const hit = await fetchPair(p.base, p.quote);
    if (hit && hit.price > 0) {
      return {
        from: from.code,
        to: to.code,
        rate: p.invert ? 1 / hit.price : hit.price,
        source: `${name} (${p.base}/${p.quote})`,
        sourceUrl: hit.url,
        asOf: hit.fetchedAt,
        fetchedAt: hit.fetchedAt,
      };
    }
  }
  return null;
}

/** Binance spot ticker via the public market-data mirror (no geo restrictions, no key). */
export const binance: RateSource = {
  id: "binance",
  name: "Binance",
  homepage: "https://www.binance.com",
  covers: "crypto",
  history: false,
  async quote(from, to, ctx: SourceContext, date) {
    if (date) return null;
    return firstPair(
      from,
      to,
      async (b, q) => {
        const url = `https://data-api.binance.vision/api/v3/ticker/price?symbol=${b}${q}`;
        const res = await ctx.http.get<{ price: string } | null>(url, {
          ttlMs: 30_000,
          source: "Binance",
          nullOn4xx: true,
        });
        return res.data ? { price: Number(res.data.price), url, fetchedAt: res.fetchedAt } : null;
      },
      "Binance",
      ["USDT", "USDC", "USD"],
    );
  },
};

interface KrakenTicker {
  error: string[];
  result?: Record<string, { c: [string, string] }>;
}

/** Kraken public ticker. */
export const kraken: RateSource = {
  id: "kraken",
  name: "Kraken",
  homepage: "https://www.kraken.com",
  covers: "crypto",
  history: false,
  async quote(from, to, ctx, date) {
    if (date) return null;
    return firstPair(
      from,
      to,
      async (b, q) => {
        if (q === "USDC" || b === "USDC") return null;
        const url = `https://api.kraken.com/0/public/Ticker?pair=${b}${q}`;
        const res = await ctx.http.get<KrakenTicker | null>(url, {
          ttlMs: 30_000,
          source: "Kraken",
          nullOn4xx: true,
        });
        const first = res.data?.result ? Object.values(res.data.result)[0] : undefined;
        if (!first || res.data?.error?.length) return null;
        return { price: Number(first.c[0]), url, fetchedAt: res.fetchedAt };
      },
      "Kraken",
      ["USD", "USDT"],
    );
  },
};
