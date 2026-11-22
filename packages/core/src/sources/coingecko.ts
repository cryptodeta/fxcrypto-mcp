import type { Asset, CoinSearchHit } from "../assets.js";
import type { GetOptions } from "../http.js";
import { DAY, MINUTE, type Quote, type RateSource, type SourceContext, ttlForDate } from "./types.js";

export const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

export async function cg<T>(ctx: SourceContext, path: string, opts: GetOptions = {}) {
  const url = `${COINGECKO_BASE}${path}`;
  const headers = ctx.coingeckoKey ? { "x-cg-demo-api-key": ctx.coingeckoKey } : undefined;
  const res = await ctx.http.get<T>(url, { ttlMs: MINUTE, source: "CoinGecko", headers, ...opts });
  return { ...res, url };
}

export async function cgVsCurrencies(ctx: SourceContext): Promise<Set<string>> {
  try {
    const res = await cg<string[]>(ctx, "/simple/supported_vs_currencies", { ttlMs: DAY });
    return new Set(res.data.map((c) => c.toUpperCase()));
  } catch {
    // Known stable subset if the list cannot be fetched.
    return new Set(
      "USD EUR GBP JPY CNY INR BDT PKR AUD CAD CHF HKD SGD KRW BRL MXN RUB TRY ZAR NGN IDR MYR PHP THB VND AED SAR SEK NOK DKK PLN CZK HUF ILS NZD TWD UAH LKR MMK ARS CLP KWD BHD GEL BTC ETH XAU XAG".split(
        " ",
      ),
    );
  }
}

export async function cgSearch(ctx: SourceContext, query: string): Promise<CoinSearchHit[]> {
  const res = await cg<{
    coins: Array<{ id: string; symbol: string; name: string; market_cap_rank: number | null }>;
  }>(ctx, `/search?query=${encodeURIComponent(query)}`, { ttlMs: 6 * 3_600_000 });
  return res.data.coins
    .slice(0, 25)
    .map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, rank: c.market_cap_rank }));
}

function ddmmyyyy(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${m}-${y}`;
}

/** CoinGecko public API: deepest coin coverage and market data. Free tier is rate limited (~5-30 req/min). */
export const coingecko: RateSource = {
  id: "coingecko",
  name: "CoinGecko",
  homepage: "https://www.coingecko.com",
  covers: "both",
  history: true,

  async quote(from: Asset, to: Asset, ctx, date): Promise<Quote | null> {
    const vs = await cgVsCurrencies(ctx);
    let coin: Asset;
    let vsCode: string;
    let invert = false;
    if (from.kind === "crypto" && from.coingeckoId && vs.has(to.code)) {
      coin = from;
      vsCode = to.code;
    } else if (to.kind === "crypto" && to.coingeckoId && vs.has(from.code)) {
      coin = to;
      vsCode = from.code;
      invert = true;
    } else {
      return null;
    }
    const v = vsCode.toLowerCase();
    let price: number | undefined;
    let asOf: string;
    let res: { fetchedAt: string; url: string };
    if (date) {
      const r = await cg<{ market_data?: { current_price?: Record<string, number> } } | null>(
        ctx,
        `/coins/${coin.coingeckoId}/history?date=${ddmmyyyy(date)}&localization=false`,
        { ttlMs: ttlForDate(date, 10 * MINUTE), nullOn4xx: true },
      );
      price = r.data?.market_data?.current_price?.[v];
      asOf = `${date} 00:00 UTC (daily snapshot)`;
      res = r;
    } else {
      const r = await cg<Record<string, Record<string, number>>>(
        ctx,
        `/simple/price?ids=${coin.coingeckoId}&vs_currencies=${v}&include_last_updated_at=true`,
      );
      const row = r.data[coin.coingeckoId!];
      price = row?.[v];
      asOf = row?.last_updated_at ? new Date(row.last_updated_at * 1000).toISOString() : r.fetchedAt;
      res = r;
    }
    if (!price) return null;
    return {
      from: from.code,
      to: to.code,
      rate: invert ? 1 / price : price,
      source: this.name,
      sourceUrl: res.url,
      asOf,
      fetchedAt: res.fetchedAt,
    };
  },
};
