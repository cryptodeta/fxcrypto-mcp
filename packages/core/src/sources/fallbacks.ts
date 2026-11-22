import { HOUR, MINUTE, type SourceContext } from "./types.js";

export interface CoinloreTicker {
  id: string;
  symbol: string;
  name: string;
  nameid: string;
  rank: number;
  price_usd: string;
  percent_change_24h: string;
  percent_change_1h: string;
  percent_change_7d: string;
  market_cap_usd: string;
  volume24: number;
  csupply: string;
  tsupply: string;
  msupply: string;
}

/** CoinLore: free, no key, used as a fallback for market lists and global stats. */
export async function coinloreTickers(ctx: SourceContext, limit = 100) {
  const url = `https://api.coinlore.net/api/tickers/?start=0&limit=${Math.min(100, limit)}`;
  const res = await ctx.http.get<{ data: CoinloreTicker[] }>(url, { ttlMs: 2 * MINUTE, source: "CoinLore" });
  return { ...res, url };
}

export interface CoinloreGlobal {
  coins_count: number;
  total_mcap: number;
  total_volume: number;
  btc_d: string;
  eth_d: string;
  mcap_change: string;
  volume_change: string;
}

export async function coinloreGlobal(ctx: SourceContext) {
  const url = "https://api.coinlore.net/api/global/";
  const res = await ctx.http.get<CoinloreGlobal[]>(url, { ttlMs: 5 * MINUTE, source: "CoinLore" });
  return { ...res, url };
}

export interface PaprikaCoin {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  description?: string;
  type?: string;
  started_at?: string | null;
  development_status?: string | null;
  proof_type?: string | null;
  hash_algorithm?: string | null;
  links?: Record<string, string[] | undefined>;
  tags?: Array<{ name: string }>;
}

export interface PaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  last_updated: string;
  quotes: Record<
    string,
    {
      price: number;
      volume_24h: number;
      market_cap: number;
      percent_change_1h: number;
      percent_change_24h: number;
      percent_change_7d: number;
      percent_change_30d: number;
      ath_price: number | null;
      ath_date: string | null;
      percent_from_price_ath: number | null;
    }
  >;
}

/** Coinpaprika: free, no key, used as a fallback for coin details. */
export async function paprikaFind(ctx: SourceContext, symbol: string, name: string): Promise<string | null> {
  const url = `https://api.coinpaprika.com/v1/search/?q=${encodeURIComponent(symbol)}&c=currencies&limit=10`;
  const res = await ctx.http.get<{
    currencies?: Array<{ id: string; symbol: string; name: string; rank: number }>;
  }>(url, { ttlMs: 6 * HOUR, source: "Coinpaprika" });
  const list = res.data.currencies ?? [];
  const exact = list.filter((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
  const byName = exact.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const best = byName ?? exact.filter((c) => c.rank > 0).sort((a, b) => a.rank - b.rank)[0] ?? exact[0];
  return best?.id ?? null;
}

export async function paprikaCoin(ctx: SourceContext, id: string) {
  const coinUrl = `https://api.coinpaprika.com/v1/coins/${id}`;
  const tickerUrl = `https://api.coinpaprika.com/v1/tickers/${id}`;
  const [coin, ticker] = await Promise.all([
    ctx.http.get<PaprikaCoin>(coinUrl, { ttlMs: 6 * HOUR, source: "Coinpaprika" }),
    ctx.http.get<PaprikaTicker>(tickerUrl, { ttlMs: MINUTE, source: "Coinpaprika" }),
  ]);
  return { coin: coin.data, ticker: ticker.data, fetchedAt: ticker.fetchedAt, url: tickerUrl };
}

export interface FearGreed {
  value: number;
  classification: string;
  timestamp: string;
  source: string;
  sourceUrl: string;
}

/** Crypto Fear & Greed Index (alternative.me). */
export async function fearGreed(ctx: SourceContext): Promise<FearGreed> {
  const url = "https://api.alternative.me/fng/?limit=1";
  const res = await ctx.http.get<{
    data: Array<{ value: string; value_classification: string; timestamp: string }>;
  }>(url, { ttlMs: HOUR, source: "alternative.me" });
  const row = res.data.data[0]!;
  return {
    value: Number(row.value),
    classification: row.value_classification,
    timestamp: new Date(Number(row.timestamp) * 1000).toISOString(),
    source: "alternative.me Crypto Fear & Greed Index",
    sourceUrl: url,
  };
}

/** Binance daily klines as an OHLC fallback (USD pairs use USDT). */
export async function binanceKlines(ctx: SourceContext, symbol: string, quote: string, days: number) {
  const q = quote === "USD" ? "USDT" : quote;
  const interval = days <= 2 ? "30m" : days <= 31 ? "4h" : "1d";
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}${q}&interval=${interval}&limit=${Math.min(
    1000,
    interval === "1d" ? days : interval === "4h" ? days * 6 : days * 48,
  )}`;
  const res = await ctx.http.get<Array<[number, string, string, string, string, string]> | null>(url, {
    ttlMs: 5 * MINUTE,
    source: "Binance",
    nullOn4xx: true,
  });
  if (!res.data?.length) return null;
  return {
    url,
    fetchedAt: res.fetchedAt,
    candles: res.data.map((k) => ({
      t: new Date(k[0]).toISOString(),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    })),
  };
}
