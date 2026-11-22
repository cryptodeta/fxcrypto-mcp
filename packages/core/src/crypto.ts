import type { Asset } from "./assets.js";
import { FxCryptoClient } from "./client.js";
import { FxError, toFxError } from "./errors.js";
import { sig } from "./format.js";
import { cg, cgVsCurrencies } from "./sources/coingecko.js";
import {
  binanceKlines,
  coinloreGlobal,
  coinloreTickers,
  fearGreed,
  paprikaCoin,
  paprikaFind,
} from "./sources/fallbacks.js";
import { downsample, type Point, seriesStats } from "./stats.js";

export type MarketOrder = "market_cap" | "volume" | "gainers" | "losers";

export interface MarketRow {
  rank: number | null;
  symbol: string;
  name: string;
  id: string;
  price: number;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  marketCap: number | null;
  volume24h: number | null;
  athPrice?: number | null;
  athChangePct?: number | null;
}

interface CgMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number | null;
  total_volume: number;
  high_24h: number | null;
  low_24h: number | null;
  ath: number | null;
  ath_change_percentage: number | null;
  ath_date: string | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_24h?: number | null;
  last_updated: string;
}

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

const OHLC_DAYS = [1, 7, 14, 30, 90, 180, 365];

/** Full client: fiat + crypto conversions, history, and crypto market data. */
export class FxCrypto extends FxCryptoClient {
  private async coin(input: string): Promise<Asset> {
    const a = await this.resolve(input);
    if (a.kind !== "crypto" || !a.coingeckoId) {
      throw new FxError(
        "INVALID_INPUT",
        `"${input}" is a fiat currency (${a.code}), not a crypto asset.`,
        "Use convert or get_rates for fiat; pass a coin symbol like BTC or a CoinGecko id.",
      );
    }
    return a;
  }

  /** Resolve a quote currency and return [coingeckoVsCode, multiplier from that code to the requested one]. */
  private async vsPlan(vsInput: string) {
    const vs = await this.resolve(vsInput);
    const supported = await cgVsCurrencies(this.ctx);
    if (supported.has(vs.code))
      return { vs, cgVs: vs.code.toLowerCase(), factor: 1, via: undefined as string | undefined };
    const usd: Asset = { code: "USD", kind: "fiat", name: "US Dollar" };
    const q = await this.quote(usd, vs);
    return { vs, cgVs: "usd", factor: q.rate, via: `USD->${vs.code} at ${sig(q.rate, 8)} (${q.source})` };
  }

  /** Live price + 24h stats for one or more coins in one or more currencies. */
  async price(args: { coins: string[]; vs?: string[] }) {
    const coins = await Promise.all(args.coins.slice(0, 50).map((c) => this.coin(c)));
    const plans = await Promise.all(
      (args.vs?.length ? args.vs : ["USD"]).slice(0, 10).map((v) => this.vsPlan(v)),
    );
    const cgVs = [...new Set(plans.map((p) => p.cgVs))];
    try {
      const r = await cg<Record<string, Record<string, number>>>(
        this.ctx,
        `/simple/price?ids=${[...new Set(coins.map((c) => c.coingeckoId))].join(",")}&vs_currencies=${cgVs.join(",")}&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
      );
      const rows = coins.map((c) => {
        const d = r.data[c.coingeckoId!] ?? {};
        return {
          symbol: c.code,
          name: c.name,
          id: c.coingeckoId,
          prices: plans.map((p) => ({
            currency: p.vs.code,
            price: d[p.cgVs] !== undefined ? sig(d[p.cgVs]! * p.factor, 10) : null,
            change24hPct: n(d[`${p.cgVs}_24h_change`]) !== null ? sig(d[`${p.cgVs}_24h_change`]!, 4) : null,
            marketCap:
              d[`${p.cgVs}_market_cap`] !== undefined ? sig(d[`${p.cgVs}_market_cap`]! * p.factor, 6) : null,
            volume24h:
              d[`${p.cgVs}_24h_vol`] !== undefined ? sig(d[`${p.cgVs}_24h_vol`]! * p.factor, 6) : null,
            ...(p.via ? { via: p.via } : {}),
          })),
          asOf: d.last_updated_at ? new Date(d.last_updated_at * 1000).toISOString() : r.fetchedAt,
        };
      });
      return { coins: rows, source: "CoinGecko", sourceUrl: r.url, fetchedAt: r.fetchedAt };
    } catch (err) {
      // Fallback: price only, through the multi-source quote engine (Coinbase, Binance, Kraken, ...).
      const cause = toFxError(err);
      const rows = await Promise.all(
        coins.map(async (c) => ({
          symbol: c.code,
          name: c.name,
          id: c.coingeckoId,
          prices: await Promise.all(
            plans.map(async (p) => {
              try {
                const q = await this.quote(c, p.vs);
                return { currency: p.vs.code, price: sig(q.rate, 10), source: q.source, asOf: q.asOf };
              } catch (e) {
                return { currency: p.vs.code, price: null, error: toFxError(e).message };
              }
            }),
          ),
        })),
      );
      return {
        coins: rows,
        source: "fallback exchanges",
        note: `CoinGecko unavailable (${cause.message}); market cap and 24h change omitted.`,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  /** Top coins by market cap or volume, or the biggest 24h gainers / losers among the top 250. */
  async markets(args: { vs?: string; order?: MarketOrder; limit?: number; category?: string }) {
    const order = args.order ?? "market_cap";
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const plan = await this.vsPlan(args.vs ?? "USD");
    const movers = order === "gainers" || order === "losers";
    let rows: MarketRow[];
    let source: string;
    let sourceUrl: string;
    let fetchedAt: string;
    let note: string | undefined;
    try {
      const params = new URLSearchParams({
        vs_currency: plan.cgVs,
        order: order === "volume" ? "volume_desc" : "market_cap_desc",
        per_page: String(movers ? 250 : limit),
        page: "1",
        price_change_percentage: "1h,24h,7d",
      });
      if (args.category) params.set("category", args.category);
      const r = await cg<CgMarket[]>(this.ctx, `/coins/markets?${params}`, { ttlMs: 2 * 60_000 });
      rows = r.data.map((m) => ({
        rank: m.market_cap_rank,
        symbol: m.symbol.toUpperCase(),
        name: m.name,
        id: m.id,
        price: sig(m.current_price * plan.factor, 10),
        change1hPct: n(m.price_change_percentage_1h_in_currency),
        change24hPct: n(m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h),
        change7dPct: n(m.price_change_percentage_7d_in_currency),
        marketCap: n(m.market_cap) !== null ? sig(m.market_cap * plan.factor, 6) : null,
        volume24h: n(m.total_volume) !== null ? sig(m.total_volume * plan.factor, 6) : null,
        athPrice: m.ath !== null ? sig(m.ath * plan.factor, 10) : null,
        athChangePct: n(m.ath_change_percentage),
      }));
      source = "CoinGecko";
      sourceUrl = r.url;
      fetchedAt = r.fetchedAt;
    } catch (err) {
      if (args.category) throw err;
      const r = await coinloreTickers(this.ctx, 100);
      const usdPlan =
        plan.cgVs === "usd"
          ? plan.factor
          : (await this.quote({ code: "USD", kind: "fiat", name: "US Dollar" }, plan.vs)).rate;
      rows = r.data.data.map((t) => ({
        rank: t.rank,
        symbol: t.symbol,
        name: t.name,
        id: t.nameid,
        price: sig(Number(t.price_usd) * usdPlan, 10),
        change1hPct: n(t.percent_change_1h),
        change24hPct: n(t.percent_change_24h),
        change7dPct: n(t.percent_change_7d),
        marketCap: n(t.market_cap_usd) !== null ? sig(Number(t.market_cap_usd) * usdPlan, 6) : null,
        volume24h: n(t.volume24) !== null ? sig(t.volume24 * usdPlan, 6) : null,
      }));
      if (order === "volume") rows.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
      source = "CoinLore";
      sourceUrl = r.url;
      fetchedAt = r.fetchedAt;
      note = `CoinGecko unavailable (${toFxError(err).message}); using CoinLore top 100.`;
    }
    if (movers) {
      rows = rows.filter((r) => r.change24hPct !== null && (r.volume24h ?? 0) > 0);
      rows.sort((a, b) =>
        order === "gainers" ? b.change24hPct! - a.change24hPct! : a.change24hPct! - b.change24hPct!,
      );
    }
    return {
      currency: plan.vs.code,
      order,
      count: Math.min(limit, rows.length),
      coins: rows.slice(0, limit),
      source,
      sourceUrl,
      fetchedAt,
      ...(plan.via ? { via: plan.via } : {}),
      ...(note ? { note } : {}),
      ...(movers ? { universe: "top 250 by market cap with non-zero volume" } : {}),
    };
  }

  /** Coins trending in CoinGecko searches over the last 24h. */
  async trending() {
    try {
      const r = await cg<{
        coins: Array<{
          item: {
            id: string;
            symbol: string;
            name: string;
            market_cap_rank: number | null;
            score: number;
            data?: {
              price?: number;
              price_change_percentage_24h?: Record<string, number>;
              market_cap?: string;
            };
          };
        }>;
        categories?: Array<{
          name: string;
          data?: { market_cap_change_percentage_24h?: Record<string, number> };
        }>;
      }>(this.ctx, "/search/trending", { ttlMs: 5 * 60_000 });
      return {
        coins: r.data.coins.map(({ item }) => ({
          symbol: item.symbol.toUpperCase(),
          name: item.name,
          id: item.id,
          marketCapRank: item.market_cap_rank,
          priceUsd: n(item.data?.price) !== null ? sig(item.data!.price!, 8) : null,
          change24hPct:
            n(item.data?.price_change_percentage_24h?.usd) !== null
              ? sig(item.data!.price_change_percentage_24h!.usd!, 4)
              : null,
        })),
        categories: (r.data.categories ?? []).slice(0, 6).map((c) => ({
          name: c.name,
          marketCapChange24hPct: n(c.data?.market_cap_change_percentage_24h?.usd),
        })),
        source: "CoinGecko",
        sourceUrl: r.url,
        fetchedAt: r.fetchedAt,
      };
    } catch (err) {
      const fallback = await this.markets({ order: "gainers", limit: 15 });
      return {
        coins: fallback.coins.map((c) => ({
          symbol: c.symbol,
          name: c.name,
          id: c.id,
          marketCapRank: c.rank,
          priceUsd: c.price,
          change24hPct: c.change24hPct,
        })),
        categories: [],
        source: fallback.source,
        sourceUrl: fallback.sourceUrl,
        fetchedAt: fallback.fetchedAt,
        note: `Trending unavailable (${toFxError(err).message}); showing top 24h gainers instead.`,
      };
    }
  }

  /** Detailed coin profile: description, links, supply, ATH/ATL, multi-period performance. */
  async coinDetails(args: { coin: string; vs?: string }) {
    const coin = await this.coin(args.coin);
    const plan = await this.vsPlan(args.vs ?? "USD");
    const v = plan.cgVs;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: large upstream payload, read defensively
      const r = await cg<any>(
        this.ctx,
        `/coins/${coin.coingeckoId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
        { ttlMs: 2 * 60_000 },
      );
      const d = r.data;
      const md = d.market_data ?? {};
      const pick = (o: Record<string, number> | undefined) =>
        o && n(o[v]) !== null ? sig(o[v]! * plan.factor, 10) : null;
      const pct = (o: Record<string, number> | undefined) => (o && n(o[v]) !== null ? sig(o[v]!, 4) : null);
      const links = d.links ?? {};
      return {
        id: d.id,
        symbol: String(d.symbol).toUpperCase(),
        name: d.name,
        marketCapRank: d.market_cap_rank ?? null,
        categories: (d.categories ?? []).filter(Boolean).slice(0, 8),
        description: cleanText(d.description?.en ?? "", 700),
        genesisDate: d.genesis_date ?? null,
        hashingAlgorithm: d.hashing_algorithm ?? null,
        links: {
          homepage: (links.homepage ?? []).find(Boolean) ?? null,
          whitepaper: links.whitepaper || null,
          explorers: (links.blockchain_site ?? []).filter(Boolean).slice(0, 3),
          github: (links.repos_url?.github ?? []).filter(Boolean).slice(0, 2),
          twitter: links.twitter_screen_name ? `https://x.com/${links.twitter_screen_name}` : null,
          subreddit: links.subreddit_url || null,
        },
        market: {
          currency: plan.vs.code,
          price: pick(md.current_price),
          marketCap: pick(md.market_cap),
          fullyDilutedValuation: pick(md.fully_diluted_valuation),
          volume24h: pick(md.total_volume),
          high24h: pick(md.high_24h),
          low24h: pick(md.low_24h),
          change1hPct: pct(md.price_change_percentage_1h_in_currency),
          change24hPct: pct(md.price_change_percentage_24h_in_currency),
          change7dPct: pct(md.price_change_percentage_7d_in_currency),
          change30dPct: pct(md.price_change_percentage_30d_in_currency),
          change1yPct: pct(md.price_change_percentage_1y_in_currency),
          ath: pick(md.ath),
          athDate: md.ath_date?.[v] ?? null,
          athChangePct: pct(md.ath_change_percentage),
          atl: pick(md.atl),
          atlDate: md.atl_date?.[v] ?? null,
          circulatingSupply: n(md.circulating_supply),
          totalSupply: n(md.total_supply),
          maxSupply: n(md.max_supply),
          ...(plan.via ? { via: plan.via } : {}),
        },
        asOf: md.last_updated ?? d.last_updated ?? r.fetchedAt,
        source: "CoinGecko",
        sourceUrl: `https://www.coingecko.com/en/coins/${d.id}`,
        fetchedAt: r.fetchedAt,
      };
    } catch (err) {
      const id = await paprikaFind(this.ctx, coin.code, coin.name);
      if (!id) throw err;
      const p = await paprikaCoin(this.ctx, id);
      const q = p.ticker.quotes.USD;
      const usdFactor =
        plan.cgVs === "usd"
          ? plan.factor
          : (await this.quote({ code: "USD", kind: "fiat", name: "US Dollar" }, plan.vs)).rate;
      const m = (x: number | null | undefined) => (n(x) !== null ? sig(x! * usdFactor, 10) : null);
      return {
        id: coin.coingeckoId,
        symbol: coin.code,
        name: p.coin.name,
        marketCapRank: p.coin.rank,
        categories: (p.coin.tags ?? []).map((t) => t.name).slice(0, 8),
        description: cleanText(p.coin.description ?? "", 700),
        genesisDate: p.coin.started_at?.slice(0, 10) ?? null,
        hashingAlgorithm: p.coin.hash_algorithm ?? null,
        links: {
          homepage: p.coin.links?.website?.[0] ?? null,
          explorers: (p.coin.links?.explorer ?? []).slice(0, 3),
          github: (p.coin.links?.source_code ?? []).slice(0, 2),
        },
        market: {
          currency: plan.vs.code,
          price: m(q?.price),
          marketCap: m(q?.market_cap),
          volume24h: m(q?.volume_24h),
          change1hPct: n(q?.percent_change_1h),
          change24hPct: n(q?.percent_change_24h),
          change7dPct: n(q?.percent_change_7d),
          change30dPct: n(q?.percent_change_30d),
          ath: m(q?.ath_price),
          athDate: q?.ath_date ?? null,
          athChangePct: n(q?.percent_from_price_ath),
          circulatingSupply: n(p.ticker.circulating_supply),
          totalSupply: n(p.ticker.total_supply),
          maxSupply: n(p.ticker.max_supply) || null,
        },
        asOf: p.ticker.last_updated,
        source: "Coinpaprika",
        sourceUrl: p.url,
        fetchedAt: p.fetchedAt,
        note: `CoinGecko unavailable (${toFxError(err).message}).`,
      };
    }
  }

  /** Price chart data: line (price + volume) or OHLC candles, with stats. */
  async chart(args: {
    coin: string;
    vs?: string;
    days?: number;
    type?: "line" | "ohlc";
    maxPoints?: number;
  }) {
    const coin = await this.coin(args.coin);
    const plan = await this.vsPlan(args.vs ?? "USD");
    const days = Math.max(1, Math.min(args.days ?? 30, 365));
    const maxPoints = Math.max(2, Math.min(args.maxPoints ?? 60, 500));
    const type = args.type ?? "line";
    const f = plan.factor;
    try {
      if (type === "ohlc") {
        const d = OHLC_DAYS.find((x) => x >= days) ?? 365;
        const r = await cg<Array<[number, number, number, number, number]>>(
          this.ctx,
          `/coins/${coin.coingeckoId}/ohlc?vs_currency=${plan.cgVs}&days=${d}`,
          { ttlMs: 5 * 60_000 },
        );
        const candles = r.data.map(([ts, o, h, l, c]) => ({
          t: new Date(ts).toISOString(),
          open: sig(o * f, 10),
          high: sig(h * f, 10),
          low: sig(l * f, 10),
          close: sig(c * f, 10),
        }));
        return {
          coin: coin.code,
          currency: plan.vs.code,
          type,
          days: d,
          stats: seriesStats(candles.map((c) => ({ t: c.t, v: c.close }))),
          candles: downsample(candles, maxPoints),
          source: "CoinGecko",
          sourceUrl: r.url,
          fetchedAt: r.fetchedAt,
          ...(plan.via ? { via: plan.via } : {}),
        };
      }
      const r = await cg<{ prices: Array<[number, number]>; total_volumes: Array<[number, number]> }>(
        this.ctx,
        `/coins/${coin.coingeckoId}/market_chart?vs_currency=${plan.cgVs}&days=${days}`,
        { ttlMs: 5 * 60_000 },
      );
      const points: Point[] = r.data.prices.map(([ts, v]) => ({ t: new Date(ts).toISOString(), v: v * f }));
      const vol = new Map(r.data.total_volumes.map(([ts, v]) => [new Date(ts).toISOString(), v * f]));
      return {
        coin: coin.code,
        currency: plan.vs.code,
        type,
        days,
        stats: seriesStats(points),
        points: downsample(points, maxPoints).map((p) => ({
          t: p.t,
          price: sig(p.v, 10),
          volume: vol.has(p.t) ? sig(vol.get(p.t)!, 6) : undefined,
        })),
        source: "CoinGecko",
        sourceUrl: r.url,
        fetchedAt: r.fetchedAt,
        ...(plan.via ? { via: plan.via } : {}),
      };
    } catch (err) {
      const k = await binanceKlines(this.ctx, coin.code, plan.vs.code, days).catch(() => null);
      if (!k) throw err;
      const candles = k.candles;
      return {
        coin: coin.code,
        currency: plan.vs.code,
        type,
        days,
        stats: seriesStats(candles.map((c) => ({ t: c.t, v: c.close }))),
        ...(type === "ohlc"
          ? { candles: downsample(candles, maxPoints) }
          : { points: downsample(candles, maxPoints).map((c) => ({ t: c.t, price: c.close })) }),
        source: "Binance",
        sourceUrl: k.url,
        fetchedAt: k.fetchedAt,
        note: `CoinGecko unavailable (${toFxError(err).message}); Binance ${plan.vs.code === "USD" ? "USDT" : plan.vs.code} pair used.`,
      };
    }
  }

  /** Global crypto market snapshot plus the Fear & Greed Index. */
  async global() {
    const [g, fg] = await Promise.allSettled([
      (async () => {
        try {
          // biome-ignore lint/suspicious/noExplicitAny: upstream payload
          const r = await cg<{ data: any }>(this.ctx, "/global", { ttlMs: 5 * 60_000 });
          const d = r.data.data;
          return {
            totalMarketCapUsd: sig(d.total_market_cap?.usd, 6),
            totalVolume24hUsd: sig(d.total_volume?.usd, 6),
            marketCapChange24hPct: sig(d.market_cap_change_percentage_24h_usd, 4),
            btcDominancePct: sig(d.market_cap_percentage?.btc, 4),
            ethDominancePct: sig(d.market_cap_percentage?.eth, 4),
            activeCoins: d.active_cryptocurrencies,
            markets: d.markets,
            asOf: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : r.fetchedAt,
            source: "CoinGecko",
            sourceUrl: r.url,
          };
        } catch (err) {
          const r = await coinloreGlobal(this.ctx);
          const d = r.data[0]!;
          return {
            totalMarketCapUsd: sig(d.total_mcap, 6),
            totalVolume24hUsd: sig(d.total_volume, 6),
            marketCapChange24hPct: Number(d.mcap_change),
            btcDominancePct: Number(d.btc_d),
            ethDominancePct: Number(d.eth_d),
            activeCoins: d.coins_count,
            asOf: r.fetchedAt,
            source: "CoinLore",
            sourceUrl: r.url,
            note: `CoinGecko unavailable (${toFxError(err).message}).`,
          };
        }
      })(),
      fearGreed(this.ctx),
    ]);
    if (g.status === "rejected") throw g.reason;
    return {
      ...g.value,
      fearGreed: fg.status === "fulfilled" ? fg.value : null,
      fetchedAt: new Date().toISOString(),
    };
  }
}

function cleanText(html: string, max: number): string {
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, max - 40))}...`;
}
