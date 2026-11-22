import { type Asset, FIAT, resolveAsset } from "./assets.js";
import { parseDate, today } from "./dates.js";
import { FxError, toFxError } from "./errors.js";
import { formatMoney, formatNumber, sig } from "./format.js";
import { HttpClient, type HttpOptions } from "./http.js";
import { coinbase } from "./sources/coinbase.js";
import { cg, cgSearch, cgVsCurrencies, coingecko } from "./sources/coingecko.js";
import { CURRENCY_API_FIRST_DATE, currencyApi } from "./sources/currencyApi.js";
import { erApi } from "./sources/erApi.js";
import { binance, kraken } from "./sources/exchanges.js";
import { binanceKlines } from "./sources/fallbacks.js";
import { frankfurter } from "./sources/frankfurter.js";
import type { Quote, RateSource, RateTable, SourceContext } from "./sources/types.js";
import { addDays, daysBetween, downsample, type Point, type SeriesStats, seriesStats } from "./stats.js";

export interface ClientOptions extends HttpOptions {
  http?: HttpClient;
  coingeckoKey?: string;
}

export interface SourceError {
  source: string;
  code: string;
  message: string;
}

export interface RateQuote extends Quote {
  /** Present when the rate was computed through a pivot currency. */
  via?: string;
  date?: string;
}

export interface ConversionResult {
  amount: number;
  from: Asset;
  to: Asset;
  result: number;
  rate: number;
  inverseRate: number;
  formatted: string;
  date?: string;
  source: string;
  sourceUrl: string;
  asOf: string;
  fetchedAt: string;
  via?: string;
}

export interface HistoryResult {
  from: string;
  to: string;
  start: string;
  end: string;
  stats: SeriesStats | null;
  points: Point[];
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  note?: string;
}

const FIAT_CHAIN: RateSource[] = [frankfurter, currencyApi, erApi, coinbase];
const CRYPTO_CHAIN: RateSource[] = [coingecko, coinbase, binance, kraken, currencyApi];
export const ALL_SOURCES: RateSource[] = [
  frankfurter,
  currencyApi,
  erApi,
  coingecko,
  coinbase,
  binance,
  kraken,
];

export class FxCryptoClient {
  readonly http: HttpClient;
  readonly ctx: SourceContext;
  private readonly resolved = new Map<string, Promise<Asset>>();

  constructor(options: ClientOptions = {}) {
    this.http = options.http ?? new HttpClient(options);
    this.ctx = { http: this.http, coingeckoKey: options.coingeckoKey };
  }

  /** Resolve "usd", "Bangladesh", "taka", "btc", "pepe" ... to an asset (memoised). */
  resolve(input: string): Promise<Asset> {
    const key = String(input ?? "")
      .trim()
      .toLowerCase();
    let p = this.resolved.get(key);
    if (!p) {
      p = resolveAsset(input, (q) => cgSearch(this.ctx, q));
      this.resolved.set(key, p);
      p.catch(() => this.resolved.delete(key));
    }
    return p;
  }

  /** Search CoinGecko's coin list (cached 6h). */
  searchCoins(query: string) {
    return cgSearch(this.ctx, query);
  }

  chainFor(from: Asset, to: Asset, dated: boolean): RateSource[] {
    const crypto = from.kind === "crypto" || to.kind === "crypto";
    const chain = crypto ? CRYPTO_CHAIN : FIAT_CHAIN;
    return dated ? chain.filter((s) => s.history) : chain;
  }

  private async direct(from: Asset, to: Asset, date: string | undefined, errors: SourceError[]) {
    for (const src of this.chainFor(from, to, !!date)) {
      try {
        const q = await src.quote(from, to, this.ctx, date);
        if (q) return q;
      } catch (err) {
        const e = toFxError(err);
        errors.push({ source: src.name, code: e.code, message: e.message });
      }
    }
    return null;
  }

  /** Best available quote with automatic fallback across sources and a USD pivot. */
  async quote(from: Asset, to: Asset, date?: string): Promise<RateQuote> {
    if (from.code === to.code) {
      const now = new Date().toISOString();
      return {
        from: from.code,
        to: to.code,
        rate: 1,
        source: "identity",
        sourceUrl: "",
        asOf: now,
        fetchedAt: now,
      };
    }
    const errors: SourceError[] = [];
    const q = await this.direct(from, to, date, errors);
    if (q) return date ? { ...q, date } : q;
    if (from.code !== "USD" && to.code !== "USD") {
      const usd: Asset = { code: "USD", kind: "fiat", name: "US Dollar" };
      const a = await this.direct(from, usd, date, errors);
      const b = a ? await this.direct(usd, to, date, errors) : null;
      if (a && b) {
        return {
          from: from.code,
          to: to.code,
          rate: a.rate * b.rate,
          source: a.source === b.source ? a.source : `${a.source} + ${b.source}`,
          sourceUrl: a.sourceUrl,
          asOf: a.asOf < b.asOf ? a.asOf : b.asOf,
          fetchedAt: a.fetchedAt,
          via: "USD",
          ...(date ? { date } : {}),
        };
      }
    }
    const allLimited = errors.length > 0 && errors.every((e) => e.code === "RATE_LIMITED");
    if (errors.length === 0) {
      throw new FxError(
        "NO_DATA",
        `No source has a ${date ? `${date} ` : ""}rate for ${from.code}/${to.code}.`,
        date
          ? `Historical data for non-ECB currencies starts ${CURRENCY_API_FIRST_DATE}; CoinGecko public history covers the last 365 days.`
          : "Check the codes with list_currencies.",
      );
    }
    throw new FxError(
      allLimited ? "RATE_LIMITED" : "ALL_SOURCES_FAILED",
      `Could not get ${from.code}/${to.code}: every source failed.`,
      allLimited ? "Upstream rate limits hit; wait ~60 seconds and retry." : "Retry shortly.",
      errors,
    );
  }

  async convert(args: {
    amount: number;
    from: string;
    to: string;
    date?: string;
    locale?: string;
  }): Promise<ConversionResult> {
    if (!Number.isFinite(args.amount)) throw new FxError("INVALID_INPUT", "amount must be a number.");
    const date = parseDate(args.date);
    const [from, to] = await Promise.all([this.resolve(args.from), this.resolve(args.to)]);
    const q = await this.quote(from, to, date);
    const result = args.amount * q.rate;
    return {
      amount: args.amount,
      from,
      to,
      result: sig(result, 10),
      rate: sig(q.rate, 10),
      inverseRate: sig(1 / q.rate, 10),
      formatted: `${formatMoney(args.amount, from.code, args.locale)} = ${formatMoney(result, to.code, args.locale)}`,
      ...(date ? { date } : {}),
      source: q.source,
      sourceUrl: q.sourceUrl,
      asOf: q.asOf,
      fetchedAt: q.fetchedAt,
      ...(q.via ? { via: q.via } : {}),
    };
  }

  /** Rates for a base: specific symbols, or a full table when symbols are omitted. */
  async rates(args: { base: string; symbols?: string[]; date?: string; includeCrypto?: boolean }) {
    return args.symbols?.length
      ? this.ratesFor({ base: args.base, symbols: args.symbols, date: args.date })
      : this.rateTable(args);
  }

  /** Rates from a base to specific targets (fiat or crypto), each with its own source. */
  async ratesFor(args: { base: string; symbols: string[]; date?: string }) {
    const date = parseDate(args.date);
    const base = await this.resolve(args.base);
    const rows = await Promise.all(
      args.symbols.map(async (s) => {
        try {
          const to = await this.resolve(s);
          const q = await this.quote(base, to, date);
          return { code: to.code, name: to.name, rate: sig(q.rate, 10), source: q.source, asOf: q.asOf };
        } catch (err) {
          const e = toFxError(err);
          return { code: s.toUpperCase(), error: e.message, hint: e.hint };
        }
      }),
    );
    return { base: base.code, date: date ?? today(), rates: rows };
  }

  /** Full table of ~160 fiat rates (optionally crypto) for a base. */
  async rateTable(args: { base: string; date?: string; includeCrypto?: boolean }) {
    const date = parseDate(args.date);
    const base = await this.resolve(args.base);
    const tableSources: RateSource[] = date
      ? [frankfurter, currencyApi]
      : base.kind === "crypto"
        ? [coinbase, currencyApi]
        : [currencyApi, erApi, coinbase, frankfurter];
    const errors: SourceError[] = [];
    let table: RateTable | null = null;
    for (const src of tableSources) {
      try {
        table = (await src.table?.(base, this.ctx, date)) ?? null;
        if (table) break;
      } catch (err) {
        const e = toFxError(err);
        errors.push({ source: src.name, code: e.code, message: e.message });
      }
    }
    if (!table) {
      throw new FxError(
        "ALL_SOURCES_FAILED",
        `No rate table available for ${base.code}.`,
        "Retry shortly.",
        errors,
      );
    }
    const rates: Record<string, number> = {};
    for (const [code, v] of Object.entries(table.rates).sort(([a], [b]) => a.localeCompare(b))) {
      if (code === base.code) continue;
      if (!args.includeCrypto && !FIAT.has(code)) continue;
      rates[code] = sig(v, 8);
    }
    return {
      base: base.code,
      date: date ?? today(),
      count: Object.keys(rates).length,
      rates,
      source: table.source,
      sourceUrl: table.sourceUrl,
      asOf: table.asOf,
      fetchedAt: table.fetchedAt,
    };
  }

  /** Time series with statistics. */
  async history(args: {
    from: string;
    to: string;
    start?: string;
    end?: string;
    days?: number;
    maxPoints?: number;
  }): Promise<HistoryResult> {
    const end = parseDate(args.end, "end") ?? today();
    const start =
      parseDate(args.start, "start") ?? addDays(end, -Math.max(1, Math.min(args.days ?? 30, 3650)));
    if (start >= end) throw new FxError("INVALID_INPUT", "start must be before end.");
    if (daysBetween(start, end) > 3660) throw new FxError("INVALID_INPUT", "Range too long (max 10 years).");
    const maxPoints = Math.max(2, Math.min(args.maxPoints ?? 60, 500));
    const [from, to] = await Promise.all([this.resolve(args.from), this.resolve(args.to)]);
    const done = (points: Point[], source: string, sourceUrl: string, fetchedAt: string, note?: string) => ({
      from: from.code,
      to: to.code,
      start,
      end,
      stats: seriesStats(points),
      points: downsample(points, maxPoints).map((p) => ({ t: p.t, v: sig(p.v, 8) })),
      source,
      sourceUrl,
      fetchedAt,
      ...(note ? { note } : {}),
    });

    const errors: SourceError[] = [];
    if (from.kind !== "crypto" && to.kind !== "crypto") {
      try {
        const pts = await frankfurter.series(from, to, start, end, this.ctx);
        if (pts?.length) {
          return done(
            pts,
            frankfurter.name,
            `https://api.frankfurter.dev/v1/${start}..${end}?base=${from.code}&symbols=${to.code}`,
            new Date().toISOString(),
          );
        }
      } catch (err) {
        const e = toFxError(err);
        errors.push({ source: frankfurter.name, code: e.code, message: e.message });
      }
    } else {
      try {
        const r = await this.cryptoSeries(from, to, start, end);
        if (r) return done(r.points, r.source, r.sourceUrl, r.fetchedAt, r.note);
      } catch (err) {
        const e = toFxError(err);
        errors.push({ source: "CoinGecko", code: e.code, message: e.message });
      }
    }
    // Generic fallback: sample daily snapshots from currency-api (covers ~300 codes since 2024-03-02).
    const s = start < CURRENCY_API_FIRST_DATE ? CURRENCY_API_FIRST_DATE : start;
    if (s >= end) {
      throw new FxError(
        "NO_DATA",
        `No history for ${from.code}/${to.code} in that range.`,
        `For currencies outside the ECB set, history starts ${CURRENCY_API_FIRST_DATE}.`,
        errors,
      );
    }
    const total = daysBetween(s, end);
    const samples = Math.min(maxPoints, 45, total + 1);
    const dates = Array.from(
      new Set(
        Array.from({ length: samples }, (_, i) =>
          addDays(s, Math.round((i * total) / Math.max(1, samples - 1))),
        ),
      ),
    );
    const pts: Point[] = [];
    await mapLimit(dates, 6, async (d) => {
      const table = await currencyApi
        .table?.(from, this.ctx, d === today() ? undefined : d)
        .catch(() => null);
      const v = table?.rates[to.code];
      if (v) pts.push({ t: d, v });
    });
    pts.sort((a, b) => a.t.localeCompare(b.t));
    if (pts.length < 2) {
      throw new FxError(
        "NO_DATA",
        `No history for ${from.code}/${to.code}.`,
        "Try a shorter or more recent range.",
        errors,
      );
    }
    return done(
      pts,
      currencyApi.name,
      "https://github.com/fawazahmed0/exchange-api",
      new Date().toISOString(),
      `Sampled ${pts.length} daily snapshots${s !== start ? `; data starts ${CURRENCY_API_FIRST_DATE}` : ""}.`,
    );
  }

  private async cryptoSeries(from: Asset, to: Asset, start: string, end: string) {
    const vs = await cgVsCurrencies(this.ctx);
    const fromTs = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000);
    const toTs = Math.floor(Date.parse(`${end}T23:59:59Z`) / 1000);
    const fetchSeries = async (coin: Asset, vsCode: string) => {
      const r = await cg<{ prices: Array<[number, number]> }>(
        this.ctx,
        `/coins/${coin.coingeckoId}/market_chart/range?vs_currency=${vsCode.toLowerCase()}&from=${fromTs}&to=${toTs}`,
        { ttlMs: 5 * 60_000 },
      );
      return {
        points: dailyClose(r.data.prices, daysBetween(start, end) > 2),
        url: r.url,
        fetchedAt: r.fetchedAt,
      };
    };
    try {
      if (from.kind === "crypto" && from.coingeckoId && vs.has(to.code)) {
        const r = await fetchSeries(from, to.code);
        return { points: r.points, source: "CoinGecko", sourceUrl: r.url, fetchedAt: r.fetchedAt };
      }
      if (to.kind === "crypto" && to.coingeckoId && vs.has(from.code)) {
        const r = await fetchSeries(to, from.code);
        return {
          points: r.points.map((p) => ({ t: p.t, v: 1 / p.v })),
          source: "CoinGecko (inverted)",
          sourceUrl: r.url,
          fetchedAt: r.fetchedAt,
        };
      }
      // Both legs priced in USD, aligned by timestamp: rate = usd(from) / usd(to).
      const usd: Asset = { code: "USD", kind: "fiat", name: "US Dollar" };
      let note: string | undefined;
      const leg = async (a: Asset): Promise<Map<string, number> | number> => {
        if (a.kind === "crypto" && a.coingeckoId) {
          return new Map((await fetchSeries(a, "USD")).points.map((p) => [p.t, p.v]));
        }
        note = "Fiat leg converted at the latest rate.";
        return (await this.quote(a, usd)).rate;
      };
      const [la, lb] = await Promise.all([leg(from), leg(to)]);
      const keys = la instanceof Map ? [...la.keys()] : lb instanceof Map ? [...lb.keys()] : [];
      const points: Point[] = [];
      for (const t of keys) {
        const av = la instanceof Map ? la.get(t) : la;
        const bv = lb instanceof Map ? lb.get(t) : lb;
        if (av && bv) points.push({ t, v: av / bv });
      }
      return {
        points,
        source: "CoinGecko (via USD)",
        sourceUrl: "https://api.coingecko.com/api/v3/coins/{id}/market_chart/range",
        fetchedAt: new Date().toISOString(),
        note,
      };
    } catch (err) {
      // Exchange fallback: Binance daily candles for crypto vs USD/EUR/BTC/etc.
      if (from.kind === "crypto") {
        const days = Math.min(1000, daysBetween(start, end));
        const k = await binanceKlines(this.ctx, from.code, to.code, days).catch(() => null);
        if (k) {
          return {
            points: k.candles
              .filter((c) => c.t.slice(0, 10) >= start)
              .map((c) => ({ t: c.t.slice(0, 10), v: c.close })),
            source: "Binance",
            sourceUrl: k.url,
            fetchedAt: k.fetchedAt,
          };
        }
      }
      throw err;
    }
  }

  /** Ask every applicable source for the same pair and report the spread. */
  async compareSources(args: { from: string; to: string }) {
    const [from, to] = await Promise.all([this.resolve(args.from), this.resolve(args.to)]);
    const crypto = from.kind === "crypto" || to.kind === "crypto";
    const candidates = ALL_SOURCES.filter((s) => (crypto ? s.covers !== "fiat" : s.covers !== "crypto"));
    const settled = await Promise.all(
      candidates.map(async (src) => {
        try {
          const q = await src.quote(from, to, this.ctx);
          return q
            ? { source: src.name, rate: sig(q.rate, 10), asOf: q.asOf, url: q.sourceUrl }
            : { source: src.name, unsupported: true as const };
        } catch (err) {
          return { source: src.name, error: toFxError(err).message };
        }
      }),
    );
    const rates = settled.flatMap((s) => ("rate" in s && typeof s.rate === "number" ? [s.rate] : []));
    if (!rates.length) throw new FxError("ALL_SOURCES_FAILED", `No source returned ${from.code}/${to.code}.`);
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    return {
      pair: `${from.code}/${to.code}`,
      median: sig(median, 10),
      min,
      max,
      spreadPct: sig(((max - min) / median) * 100, 4),
      quotes: settled.map((s) =>
        "rate" in s && typeof s.rate === "number"
          ? { ...s, deviationPct: sig(((s.rate - median) / median) * 100, 4) }
          : s,
      ),
      fetchedAt: new Date().toISOString(),
    };
  }

  /** How a base moved against several currencies over N days. */
  async compareCurrencies(args: { base: string; targets: string[]; days?: number; locale?: string }) {
    const days = Math.max(1, Math.min(args.days ?? 30, 365));
    const base = await this.resolve(args.base);
    const pastDate = addDays(today(), -days);
    const rows = await mapLimit(args.targets.slice(0, 25), 6, async (t) => {
      try {
        const to = await this.resolve(t);
        const [now, past] = await Promise.all([this.quote(base, to), this.quote(base, to, pastDate)]);
        const changePct = ((now.rate - past.rate) / past.rate) * 100;
        return {
          code: to.code,
          name: to.name,
          rateNow: sig(now.rate, 8),
          ratePast: sig(past.rate, 8),
          changePct: sig(changePct, 4),
          summary:
            changePct >= 0
              ? `${base.code} gained ${formatNumber(changePct, args.locale, 2)}% vs ${to.code}`
              : `${base.code} lost ${formatNumber(-changePct, args.locale, 2)}% vs ${to.code}`,
          source: now.source,
        };
      } catch (err) {
        const e = toFxError(err);
        return { code: t.toUpperCase(), error: e.message, hint: e.hint };
      }
    });
    const ok = rows.filter((r): r is Extract<typeof r, { changePct: number }> => "changePct" in r);
    ok.sort((a, b) => b.changePct - a.changePct);
    return {
      base: base.code,
      days,
      from: pastDate,
      to: today(),
      strongestAgainst: ok[0]?.code,
      weakestAgainst: ok[ok.length - 1]?.code,
      rows: [...ok, ...rows.filter((r) => !("changePct" in r))],
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Value a mixed fiat/crypto portfolio in one currency. */
  async portfolio(args: {
    holdings: Array<{ asset: string; amount: number }>;
    currency?: string;
    locale?: string;
  }) {
    const target = await this.resolve(args.currency ?? "USD");
    const rows = await mapLimit(args.holdings.slice(0, 50), 6, async (h) => {
      try {
        const asset = await this.resolve(h.asset);
        const q = await this.quote(asset, target);
        const value = h.amount * q.rate;
        return {
          asset: asset.code,
          name: asset.name,
          amount: h.amount,
          price: sig(q.rate, 10),
          value: sig(value, 10),
          formatted: formatMoney(value, target.code, args.locale),
          source: q.source,
          asOf: q.asOf,
        };
      } catch (err) {
        const e = toFxError(err);
        return { asset: h.asset.toUpperCase(), amount: h.amount, error: e.message, hint: e.hint };
      }
    });
    const valued = rows.filter((r): r is Extract<typeof r, { value: number }> => "value" in r);
    const total = valued.reduce((s, r) => s + r.value, 0);
    return {
      currency: target.code,
      total: sig(total, 10),
      totalFormatted: formatMoney(total, target.code, args.locale),
      holdings: rows
        .map((r) =>
          "value" in r && typeof r.value === "number"
            ? { ...r, sharePct: total ? sig((r.value / total) * 100, 4) : 0 }
            : r,
        )
        .sort((a, b) => ("value" in b ? (b.value ?? -1) : -1) - ("value" in a ? (a.value ?? -1) : -1)),
      fetchedAt: new Date().toISOString(),
    };
  }

  status() {
    return {
      cache: this.http.cache.stats(),
      http: { ...this.http.stats },
      sources: ALL_SOURCES.map((s) => ({
        id: s.id,
        name: s.name,
        homepage: s.homepage,
        covers: s.covers,
        history: s.history,
      })),
    };
  }
}

function dailyClose(prices: Array<[number, number]>, daily: boolean): Point[] {
  const byDay = new Map<string, number>();
  for (const [ts, v] of prices) {
    const iso = new Date(ts).toISOString();
    byDay.set(daily ? iso.slice(0, 10) : `${iso.slice(0, 13)}:00:00Z`, v);
  }
  return [...byDay.entries()].map(([t, v]) => ({ t, v }));
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
