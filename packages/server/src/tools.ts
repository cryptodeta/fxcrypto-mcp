import {
  compact,
  type FxCrypto,
  formatMoney,
  formatNumber,
  formatPct,
  getDefaultLocale,
  searchLocal,
  sig,
} from "@fxcrypto/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { list, ok, run } from "./respond.js";
import { NAME, VERSION } from "./version.js";

const code = z.string().min(1).max(60);
const codes = z.union([z.string(), z.array(z.string())]);
const date = z
  .string()
  .optional()
  .describe('Date as YYYY-MM-DD, "yesterday" or relative like "30d ago". Omit for the latest rate.');
const locale = z
  .string()
  .optional()
  .describe('BCP 47 locale for formatted numbers, e.g. "en-US", "de-DE", "hi-IN". Default from server.');
const readOnly = { readOnlyHint: true, openWorldHint: true, idempotentHint: true } as const;

export const TOOL_NAMES = [
  "convert",
  "get_rates",
  "rate_history",
  "compare_currencies",
  "compare_sources",
  "list_currencies",
  "crypto_price",
  "crypto_markets",
  "crypto_trending",
  "coin_details",
  "crypto_chart",
  "crypto_global",
  "portfolio_value",
  "server_status",
] as const;

export function registerTools(server: McpServer, fx: FxCrypto): void {
  server.registerTool(
    "convert",
    {
      title: "Convert money",
      description:
        "Convert an amount between any currencies: fiat to fiat (USD to BDT), fiat to crypto (EUR to BTC) or crypto to crypto (ETH to SOL). " +
        "Accepts ISO codes, coin symbols, CoinGecko ids, country names ('Japan') or common names ('taka', 'euro'). " +
        "Pass several targets to convert into many currencies at once. Optional date for historical conversions. " +
        "Uses the best source with automatic fallback and reports the source and timestamp.",
      inputSchema: {
        amount: z.number().describe("Amount to convert, e.g. 100"),
        from: code.describe("Source currency or coin, e.g. USD, BDT, BTC, 'bitcoin'"),
        to: codes.describe("Target currency/coin, or a list like ['EUR','BDT','BTC']"),
        date,
        locale,
      },
      annotations: { title: "Convert money", ...readOnly },
    },
    ({ amount, from, to, date, locale }) =>
      run(async () => {
        const targets = list(to);
        if (targets.length <= 1) {
          const r = await fx.convert({ amount, from, to: targets[0] ?? String(to), date, locale });
          return ok(
            `${r.formatted}${r.date ? ` on ${r.date}` : ""} (rate ${formatNumber(r.rate, locale, 8)}; source: ${r.source}${r.via ? ` via ${r.via}` : ""}; as of ${r.asOf})`,
            r,
          );
        }
        const results = await Promise.all(
          targets.map((t) =>
            fx.convert({ amount, from, to: t, date, locale }).catch((e: Error & { hint?: string }) => ({
              to: t,
              error: e.message,
              hint: e.hint,
            })),
          ),
        );
        const lines = results.map((r) =>
          "formatted" in r ? `- ${r.formatted} (${r.source}, ${r.asOf})` : `- ${r.to}: ${r.error}`,
        );
        return ok(
          `Converted ${formatNumber(amount, locale)} ${from.toUpperCase()}:\n${lines.join("\n")}`,
          results,
        );
      }),
  );

  server.registerTool(
    "get_rates",
    {
      title: "Exchange rates for a base currency",
      description:
        "Latest (or dated) exchange rates for a base currency. With `symbols`, returns just those rates (fiat or crypto) " +
        "with per-rate sources. Without `symbols`, returns a full table of ~160 fiat currencies (add include_crypto for coins).",
      inputSchema: {
        base: code.describe("Base currency, e.g. USD, EUR, BDT, BTC"),
        symbols: codes.optional().describe("Optional targets, e.g. ['EUR','GBP','BDT'] or 'EUR,GBP'"),
        date,
        include_crypto: z
          .boolean()
          .optional()
          .describe("Include crypto codes in the full table (default false)"),
      },
      annotations: { title: "Exchange rates", ...readOnly },
    },
    ({ base, symbols, date, include_crypto }) =>
      run(async () => {
        const syms = list(symbols);
        if (!syms.length) {
          const t = await fx.rateTable({ base, date, includeCrypto: include_crypto });
          const majors = ["USD", "EUR", "GBP", "JPY", "CNY", "INR", "BDT", "AED", "SAR", "CAD", "AUD"]
            .filter((c) => c in t.rates)
            .map((c) => `${c} ${formatNumber(t.rates[c]!, undefined, 6)}`)
            .join(", ");
          return ok(
            `1 ${t.base} = ${majors} ... (${t.count} currencies; source: ${t.source}; as of ${t.asOf})`,
            t,
          );
        }
        const r = await fx.ratesFor({ base, symbols: syms, date });
        const lines = r.rates.map((x) =>
          "rate" in x
            ? `- 1 ${r.base} = ${formatNumber(x.rate!, undefined, 8)} ${x.code} (${x.source})`
            : `- ${x.code}: ${x.error}`,
        );
        return ok(`Rates for ${r.base} (${r.date}):\n${lines.join("\n")}`, r);
      }),
  );

  server.registerTool(
    "rate_history",
    {
      title: "Historical rate series with statistics",
      description:
        "Time series of an exchange rate or crypto price over a period, with min, max, average, change % and volatility. " +
        "Works for fiat (ECB data back to 1999; ~300 other currencies since 2024-03) and crypto (last 365 days). " +
        "Use `days` (default 30) or explicit start/end dates.",
      inputSchema: {
        from: code.describe("Base, e.g. EUR or BTC"),
        to: code.describe("Quote, e.g. USD or BDT"),
        days: z.number().int().min(1).max(3650).optional().describe("Look-back window in days (default 30)"),
        start: z.string().optional().describe("Start date YYYY-MM-DD (overrides days)"),
        end: z.string().optional().describe("End date YYYY-MM-DD (default today)"),
        max_points: z.number().int().min(2).max(500).optional().describe("Max points returned (default 60)"),
      },
      annotations: { title: "Rate history", ...readOnly },
    },
    ({ from, to, days, start, end, max_points }) =>
      run(async () => {
        const r = await fx.history({ from, to, days, start, end, maxPoints: max_points });
        const s = r.stats;
        const summary = s
          ? `${r.from}/${r.to} ${r.start} to ${r.end}: ${formatNumber(s.start.v, undefined, 6)} -> ${formatNumber(s.end.v, undefined, 6)} (${formatPct(s.changePct)}). ` +
            `Low ${formatNumber(s.min.v, undefined, 6)} on ${s.min.t.slice(0, 10)}, high ${formatNumber(s.max.v, undefined, 6)} on ${s.max.t.slice(0, 10)}, ` +
            `avg ${formatNumber(s.avg, undefined, 6)}, daily volatility ${formatNumber(s.volatilityPct, undefined, 2)}%. Source: ${r.source}.`
          : `No data points for ${r.from}/${r.to}.`;
        return ok(summary, r);
      }),
  );

  server.registerTool(
    "compare_currencies",
    {
      title: "Compare a currency against several others",
      description:
        "Show how a base currency moved against several currencies or coins over N days (default 30): " +
        "current rate, past rate and % change, sorted strongest to weakest. Good for 'how did the dollar do vs EUR, BDT and INR this month?'.",
      inputSchema: {
        base: code.describe("Base currency, e.g. USD"),
        targets: codes.describe("Currencies/coins to compare, e.g. ['EUR','BDT','INR','BTC']"),
        days: z.number().int().min(1).max(365).optional().describe("Period in days (default 30)"),
        locale,
      },
      annotations: { title: "Compare currencies", ...readOnly },
    },
    ({ base, targets, days, locale }) =>
      run(async () => {
        const r = await fx.compareCurrencies({ base, targets: list(targets), days, locale });
        const lines = r.rows.map((x) => ("summary" in x ? `- ${x.summary}` : `- ${x.code}: ${x.error}`));
        return ok(`${r.base} over the last ${r.days} days (${r.from} to ${r.to}):\n${lines.join("\n")}`, r);
      }),
  );

  server.registerTool(
    "compare_sources",
    {
      title: "Cross-check a rate across sources",
      description:
        "Ask every applicable data source (ECB/Frankfurter, currency-api, ExchangeRate-API, CoinGecko, Coinbase, Binance, Kraken) " +
        "for the same pair and report each quote, the median and the spread. Use to verify a rate or spot stale data.",
      inputSchema: {
        from: code.describe("Base, e.g. BTC or USD"),
        to: code.describe("Quote, e.g. USD or BDT"),
      },
      annotations: { title: "Compare sources", ...readOnly },
    },
    ({ from, to }) =>
      run(async () => {
        const r = await fx.compareSources({ from, to });
        const lines = r.quotes.map((q) =>
          "rate" in q && typeof q.rate === "number"
            ? `- ${q.source}: ${formatNumber(q.rate, undefined, 8)} (${formatPct(q.deviationPct)} vs median)`
            : `- ${q.source}: ${"error" in q ? q.error : "pair not supported"}`,
        );
        return ok(
          `${r.pair} median ${formatNumber(r.median, undefined, 8)}, spread ${formatNumber(r.spreadPct, undefined, 3)}%:\n${lines.join("\n")}`,
          r,
        );
      }),
  );

  server.registerTool(
    "list_currencies",
    {
      title: "Find currencies and coins",
      description:
        "Search supported currencies and coins by code, name, symbol or country (e.g. 'bangladesh', 'peso', 'yen', 'sol', 'pepe'). " +
        "Fiat results include symbol and the countries using it. Crypto queries also search CoinGecko's 15k+ coins. Omit query to list all fiat.",
      inputSchema: {
        query: z.string().optional().describe("Search text: code, name, symbol or country"),
        type: z.enum(["all", "fiat", "crypto"]).optional().describe("Filter (default all)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe("Max results (default 30, or all fiat when no query)"),
      },
      annotations: { title: "List currencies", ...readOnly },
    },
    ({ query, type, limit }) =>
      run(async () => {
        const kind = type ?? "all";
        const max = limit ?? (query ? 30 : 300);
        const results: Array<Record<string, unknown>> = searchLocal(
          query ?? "",
          query ? kind : kind === "all" ? "fiat" : kind,
          max,
        ).map((r) => ({ ...r }) as Record<string, unknown>);
        let note: string | undefined;
        if (query && kind !== "fiat") {
          try {
            const hits = await fx.searchCoins(query);
            const seen = new Set(results.filter((r) => r.kind === "crypto").map((r) => r.coingeckoId));
            for (const h of hits) {
              if (!seen.has(h.id))
                results.push({
                  code: h.symbol.toUpperCase(),
                  kind: "crypto",
                  name: h.name,
                  coingeckoId: h.id,
                  marketCapRank: h.rank,
                });
            }
          } catch (err) {
            note = `CoinGecko search unavailable (${(err as Error).message}); showing offline matches only.`;
          }
        }
        const top = results.slice(0, max);
        const preview = top
          .slice(0, 12)
          .map(
            (r) =>
              `${r.code} (${r.name}${Array.isArray(r.countries) && r.countries.length ? `; ${(r.countries as string[]).slice(0, 3).join(", ")}` : ""})`,
          )
          .join(", ");
        return ok(
          top.length
            ? `${top.length} match(es): ${preview}${top.length > 12 ? ", ..." : ""}`
            : `No currency or coin matches "${query}".`,
          { query: query ?? null, count: top.length, results: top, ...(note ? { note } : {}) },
        );
      }),
  );

  server.registerTool(
    "crypto_price",
    {
      title: "Crypto prices",
      description:
        "Live price of one or more coins in one or more currencies (any fiat, e.g. USD, BDT, NGN, or BTC/ETH), with 24h change, market cap and volume. " +
        "Coins by symbol (BTC), name or CoinGecko id.",
      inputSchema: {
        coins: codes.describe("Coins, e.g. ['BTC','ETH','SOL'] or 'btc,eth'"),
        vs: codes.optional().describe("Quote currencies (default USD), e.g. ['USD','BDT']"),
      },
      annotations: { title: "Crypto prices", ...readOnly },
    },
    ({ coins, vs }) =>
      run(async () => {
        const r = await fx.price({ coins: list(coins), vs: list(vs) });
        const lines = r.coins.map(
          (c) =>
            `- ${c.symbol}: ${c.prices
              .map((p) =>
                p.price === null
                  ? `${p.currency} n/a`
                  : `${formatMoney(p.price, p.currency)}${"change24hPct" in p && p.change24hPct !== null ? ` (${formatPct(p.change24hPct as number)} 24h)` : ""}`,
              )
              .join(", ")}`,
        );
        return ok(`Prices (source: ${r.source}):\n${lines.join("\n")}`, r);
      }),
  );

  server.registerTool(
    "crypto_markets",
    {
      title: "Top coins, gainers and losers",
      description:
        "Ranked crypto market list: top coins by market cap (default) or 24h volume, or the biggest 24h gainers/losers among the top 250. " +
        "Includes price, 1h/24h/7d change, market cap, volume and distance from all-time high. Optional CoinGecko category (e.g. 'layer-1', 'meme-token').",
      inputSchema: {
        vs: code.optional().describe("Quote currency (default USD)"),
        order: z
          .enum(["market_cap", "volume", "gainers", "losers"])
          .optional()
          .describe("Ranking (default market_cap)"),
        limit: z.number().int().min(1).max(100).optional().describe("Number of coins (default 20)"),
        category: z
          .string()
          .optional()
          .describe("CoinGecko category id, e.g. 'layer-1', 'meme-token', 'stablecoins'"),
      },
      annotations: { title: "Crypto markets", ...readOnly },
    },
    ({ vs, order, limit, category }) =>
      run(async () => {
        const r = await fx.markets({ vs, order, limit, category });
        const lines = r.coins.map(
          (c, i) =>
            `${i + 1}. ${c.symbol} ${formatMoney(c.price, r.currency)} | 24h ${formatPct(c.change24hPct)} | 7d ${formatPct(c.change7dPct)} | mcap ${compact(c.marketCap)}`,
        );
        return ok(`${r.order} (${r.currency}, source: ${r.source}):\n${lines.join("\n")}`, r);
      }),
  );

  server.registerTool(
    "crypto_trending",
    {
      title: "Trending coins",
      description:
        "Coins and categories trending in searches over the last 24 hours (CoinGecko), with price and 24h change.",
      inputSchema: {},
      annotations: { title: "Trending coins", ...readOnly },
    },
    () =>
      run(async () => {
        const r = await fx.trending();
        const lines = r.coins.map(
          (c, i) =>
            `${i + 1}. ${c.symbol} (${c.name}) rank ${c.marketCapRank ?? "n/a"}, ${c.priceUsd !== null ? formatMoney(c.priceUsd, "USD") : "n/a"}, ${formatPct(c.change24hPct)} 24h`,
        );
        return ok(`Trending now (source: ${r.source}):\n${lines.join("\n")}`, r);
      }),
  );

  server.registerTool(
    "coin_details",
    {
      title: "Coin profile and market data",
      description:
        "Detailed profile of a coin: description, categories, links (website, whitepaper, explorers, GitHub), supply, " +
        "market cap, FDV, 24h high/low, 1h/24h/7d/30d/1y change, all-time high/low with dates.",
      inputSchema: {
        coin: code.describe("Coin symbol, name or CoinGecko id, e.g. BTC, 'solana'"),
        vs: code.optional().describe("Quote currency (default USD)"),
      },
      annotations: { title: "Coin details", ...readOnly },
    },
    ({ coin, vs }) =>
      run(async () => {
        const r = await fx.coinDetails({ coin, vs });
        const m = r.market;
        const cur = m.currency;
        const summary =
          `${r.name} (${r.symbol}), rank #${r.marketCapRank ?? "n/a"}: ${m.price !== null ? formatMoney(m.price, cur) : "n/a"}, ` +
          `24h ${formatPct(m.change24hPct)}, 7d ${formatPct(m.change7dPct)}, mcap ${compact(m.marketCap)} ${cur}, ` +
          `ATH ${m.ath !== null && m.ath !== undefined ? formatMoney(m.ath, cur) : "n/a"} (${formatPct(m.athChangePct)} from ATH). Source: ${r.source}.`;
        return ok(summary, r);
      }),
  );

  server.registerTool(
    "crypto_chart",
    {
      title: "Crypto chart data",
      description:
        "Price history for charting: 'line' (price + volume points) or 'ohlc' candles over 1-365 days, with summary stats " +
        "(change %, min, max, average, volatility). Falls back to Binance candles if CoinGecko is unavailable.",
      inputSchema: {
        coin: code.describe("Coin symbol or id, e.g. BTC"),
        vs: code.optional().describe("Quote currency (default USD)"),
        days: z.number().int().min(1).max(365).optional().describe("Window in days (default 30)"),
        type: z.enum(["line", "ohlc"]).optional().describe("line (default) or ohlc candles"),
        max_points: z
          .number()
          .int()
          .min(2)
          .max(500)
          .optional()
          .describe("Max points/candles returned (default 60)"),
      },
      annotations: { title: "Crypto chart", ...readOnly },
    },
    ({ coin, vs, days, type, max_points }) =>
      run(async () => {
        const r = await fx.chart({ coin, vs, days, type, maxPoints: max_points });
        const s = r.stats;
        const summary = s
          ? `${r.coin}/${r.currency} last ${r.days}d: ${formatMoney(s.start.v, r.currency)} -> ${formatMoney(s.end.v, r.currency)} (${formatPct(s.changePct)}), ` +
            `low ${formatMoney(s.min.v, r.currency)}, high ${formatMoney(s.max.v, r.currency)}. Source: ${r.source}.`
          : "No chart data.";
        return ok(summary, r);
      }),
  );

  server.registerTool(
    "crypto_global",
    {
      title: "Global crypto market",
      description:
        "Whole-market snapshot: total market cap, 24h volume and change, BTC/ETH dominance, number of coins, plus the Crypto Fear & Greed Index.",
      inputSchema: {},
      annotations: { title: "Global crypto market", ...readOnly },
    },
    () =>
      run(async () => {
        const r = await fx.global();
        const fg = r.fearGreed ? ` Fear & Greed: ${r.fearGreed.value} (${r.fearGreed.classification}).` : "";
        return ok(
          `Total crypto market cap ${compact(r.totalMarketCapUsd)} USD (${formatPct(r.marketCapChange24hPct)} 24h), volume ${compact(r.totalVolume24hUsd)} USD, ` +
            `BTC dominance ${formatNumber(r.btcDominancePct, undefined, 2)}%, ETH ${formatNumber(r.ethDominancePct, undefined, 2)}%.${fg} Source: ${r.source}.`,
          r,
        );
      }),
  );

  server.registerTool(
    "portfolio_value",
    {
      title: "Portfolio value",
      description:
        "Value a mixed portfolio of crypto, fiat and metals (XAU/XAG) in one currency, with per-holding value and % share. " +
        "Example: [{asset:'BTC',amount:0.5},{asset:'ETH',amount:2},{asset:'EUR',amount:1000}] in BDT.",
      inputSchema: {
        holdings: z
          .array(
            z.object({
              asset: code.describe("Coin or currency"),
              amount: z.number().describe("Quantity held"),
            }),
          )
          .min(1)
          .max(50),
        currency: code.optional().describe("Valuation currency (default USD)"),
        locale,
      },
      annotations: { title: "Portfolio value", ...readOnly },
    },
    ({ holdings, currency, locale }) =>
      run(async () => {
        const r = await fx.portfolio({ holdings, currency, locale });
        const lines = r.holdings.map((h) =>
          "formatted" in h && h.formatted
            ? `- ${formatNumber(h.amount, locale)} ${h.asset} = ${h.formatted} (${formatNumber((h as { sharePct: number }).sharePct, locale, 2)}%)`
            : `- ${h.asset}: ${"error" in h ? h.error : "n/a"}`,
        );
        return ok(`Total: ${r.totalFormatted}\n${lines.join("\n")}`, r);
      }),
  );

  server.registerTool(
    "server_status",
    {
      title: "Server status",
      description:
        "Version, data sources with attribution, cache hit rate and upstream request counters. Useful for debugging.",
      inputSchema: {},
      annotations: { title: "Server status", readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const s = fx.status();
        return ok(
          `${NAME} v${VERSION}: ${s.sources.length} sources, cache ${s.cache.entries} entries (${formatNumber(sig(s.cache.hitRate * 100, 3), undefined, 1)}% hit rate), ` +
            `${s.http.upstreamCalls} upstream calls, ${s.http.failures} failures. Locale ${getDefaultLocale()}.`,
          { name: NAME, version: VERSION, locale: getDefaultLocale(), ...s },
        );
      }),
  );
}
