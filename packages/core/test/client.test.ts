import { describe, expect, it } from "vitest";
import { addDays, today } from "../src/index.js";
import { CG_VS, FRANKFURTER_CURRENCIES, makeClient } from "./helpers.js";

const ecbUsd = {
  match: /frankfurter\.dev\/v1\/latest\?base=USD/,
  body: { amount: 1, base: "USD", date: "2025-06-02", rates: { EUR: 0.9, JPY: 150 } },
};
const capiUsd = {
  match: /currency-api@latest\/v1\/currencies\/usd/,
  body: { date: "2025-06-02", usd: { bdt: 122, eur: 0.91, btc: 0.0000166 } },
};

describe("FxCrypto conversions", () => {
  it("prefers ECB for major fiat pairs", async () => {
    const { fx } = makeClient([FRANKFURTER_CURRENCIES, ecbUsd]);
    const r = await fx.convert({ amount: 100, from: "usd", to: "eur" });
    expect(r).toMatchObject({ result: 90, rate: 0.9, source: expect.stringContaining("Frankfurter") });
    expect(r.formatted).toBe("$100.00 = €90.00");
  });

  it("falls back to currency-api for BDT (not in ECB set)", async () => {
    const { fx } = makeClient([FRANKFURTER_CURRENCIES, capiUsd]);
    const r = await fx.convert({ amount: 100, from: "USD", to: "BDT" });
    expect(r.result).toBe(12200);
    expect(r.source).toContain("fawazahmed0");
  });

  it("keeps working when the primary source is down", async () => {
    const { fx } = makeClient([
      { match: "frankfurter.dev", status: 503 },
      { match: "jsdelivr", status: 503 },
      { match: "pages.dev", status: 503 },
      {
        match: "open.er-api.com/v6/latest/USD",
        body: {
          result: "success",
          time_last_update_utc: "Mon, 02 Jun 2025 00:00:00 +0000",
          rates: { EUR: 0.92 },
        },
      },
    ]);
    const r = await fx.convert({ amount: 1, from: "USD", to: "EUR" });
    expect(r.rate).toBe(0.92);
    expect(r.source).toContain("ExchangeRate-API");
  });

  it("pivots through USD when no source has the direct pair", async () => {
    const { fx } = makeClient([
      CG_VS,
      { match: /simple\/price\?ids=bitcoin&vs_currencies=usd/, body: { bitcoin: { usd: 60000 } } },
      { match: /coinbase.com\/v2\/exchange-rates\?currency=BTC/, status: 503 },
      { match: "binance", status: 400 },
      { match: "kraken", body: { error: ["unknown"] } },
      { match: "jsdelivr", status: 404 },
      { match: "pages.dev", status: 404 },
      FRANKFURTER_CURRENCIES,
      { match: /currency-api.*usd/, body: {} },
      {
        match: "open.er-api.com/v6/latest/USD",
        body: {
          result: "success",
          time_last_update_utc: "Mon, 02 Jun 2025 00:00:00 +0000",
          rates: { XOF: 600 },
        },
      },
    ]);
    const r = await fx.convert({ amount: 1, from: "BTC", to: "XOF" });
    expect(r.via).toBe("USD");
    expect(r.result).toBe(36_000_000);
  });

  it("reports RATE_LIMITED with a hint when every source is throttled", async () => {
    const { fx } = makeClient([{ match: /./, status: 429 }]);
    const err = await fx.convert({ amount: 1, from: "BTC", to: "EUR" }).catch((e) => e);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.hint).toMatch(/wait/i);
  });

  it("supports historical conversions", async () => {
    const { fx, calls } = makeClient([
      FRANKFURTER_CURRENCIES,
      {
        match: "frankfurter.dev/v1/2025-01-15?base=USD",
        body: { base: "USD", date: "2025-01-15", rates: { EUR: 0.97 } },
      },
    ]);
    const r = await fx.convert({ amount: 10, from: "USD", to: "EUR", date: "2025-01-15" });
    expect(r).toMatchObject({ result: 9.7, date: "2025-01-15" });
    expect(calls.some((c) => c.includes("2025-01-15"))).toBe(true);
  });

  it("returns rate tables and per-symbol rates", async () => {
    const { fx } = makeClient([FRANKFURTER_CURRENCIES, ecbUsd, capiUsd]);
    const table = await fx.rateTable({ base: "USD" });
    expect(table).toMatchObject({ base: "USD", rates: { BDT: 122, EUR: 0.91 } });
    expect("BTC" in table.rates).toBe(false);
    const some = await fx.ratesFor({ base: "USD", symbols: ["EUR", "BDT", "nope!"] });
    expect(some.rates).toHaveLength(3);
    expect(some.rates[2]).toHaveProperty("error");
  });
});

describe("history and comparisons", () => {
  it("builds ECB series with stats", async () => {
    const { fx } = makeClient([
      FRANKFURTER_CURRENCIES,
      {
        match: /frankfurter\.dev\/v1\/\d{4}-\d{2}-\d{2}\.\./,
        body: { rates: { "2025-01-01": { USD: 1 }, "2025-01-02": { USD: 1.1 } } },
      },
    ]);
    const h = await fx.history({ from: "EUR", to: "USD", days: 30 });
    expect(h.stats?.changePct).toBe(10);
    expect(h.points).toHaveLength(2);
  });

  it("samples currency-api snapshots for non-ECB pairs", async () => {
    let i = 0;
    const { fx } = makeClient([
      FRANKFURTER_CURRENCIES,
      {
        match: /currency-api@[\d-]+|currency-api@latest/,
        body: () => ({ date: "x", usd: { bdt: 120 + i++ } }),
      },
    ]);
    const h = await fx.history({ from: "USD", to: "BDT", days: 10, maxPoints: 5 });
    expect(h.points.length).toBe(5);
    expect(h.note).toMatch(/Sampled/);
  });

  it("uses CoinGecko range data for crypto", async () => {
    const t0 = Date.parse(`${addDays(today(), -2)}T00:00:00Z`);
    const { fx } = makeClient([
      CG_VS,
      {
        match: "/coins/bitcoin/market_chart/range?vs_currency=eur",
        body: {
          prices: [
            [t0, 50000],
            [t0 + 86_400_000, 55000],
          ],
        },
      },
    ]);
    const h = await fx.history({ from: "BTC", to: "EUR", days: 3 });
    expect(h.stats?.changePct).toBe(10);
    expect(h.source).toBe("CoinGecko");
  });

  it("compares sources and computes spread", async () => {
    const { fx } = makeClient([
      CG_VS,
      { match: "simple/price", body: { bitcoin: { usd: 100 } } },
      { match: "coinbase", body: { data: { rates: { USD: "101" } } } },
      { match: "binance", body: { price: "99" } },
      { match: "kraken", body: { error: [], result: { X: { c: ["100"] } } } },
      { match: "jsdelivr", body: { date: "d", btc: { usd: 100 } } },
    ]);
    const r = await fx.compareSources({ from: "BTC", to: "USD" });
    expect(r.median).toBe(100);
    expect(r.spreadPct).toBe(2);
    expect(r.quotes.length).toBe(5);
  });

  it("compares a base against several currencies", async () => {
    const past = addDays(today(), -30);
    const { fx } = makeClient([
      FRANKFURTER_CURRENCIES,
      { match: "v1/latest?base=USD", body: { date: "now", rates: { EUR: 0.9, JPY: 140 } } },
      { match: `v1/${past}?base=USD`, body: { date: past, rates: { EUR: 1, JPY: 100 } } },
    ]);
    const r = await fx.compareCurrencies({ base: "USD", targets: ["EUR", "JPY"], days: 30 });
    expect(r.strongestAgainst).toBe("JPY");
    expect(r.weakestAgainst).toBe("EUR");
  });

  it("values a mixed portfolio", async () => {
    const { fx } = makeClient([
      FRANKFURTER_CURRENCIES,
      CG_VS,
      { match: "simple/price?ids=bitcoin&vs_currencies=usd", body: { bitcoin: { usd: 60000 } } },
      { match: "v1/latest?base=EUR", body: { date: "d", rates: { USD: 1.1 } } },
    ]);
    const r = await fx.portfolio({
      holdings: [
        { asset: "BTC", amount: 0.5 },
        { asset: "EUR", amount: 1000 },
        { asset: "??", amount: 1 },
      ],
    });
    expect(r.total).toBe(31100);
    expect(r.holdings[0]).toMatchObject({ asset: "BTC", sharePct: expect.any(Number) });
    expect(r.holdings.at(-1)).toHaveProperty("error");
  });
});
