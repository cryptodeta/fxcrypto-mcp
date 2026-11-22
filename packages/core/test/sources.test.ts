import { describe, expect, it } from "vitest";
import { type Asset, HttpClient } from "../src/index.js";
import { coinbase } from "../src/sources/coinbase.js";
import { cgSearch, coingecko } from "../src/sources/coingecko.js";
import { currencyApi } from "../src/sources/currencyApi.js";
import { erApi } from "../src/sources/erApi.js";
import { binance, kraken } from "../src/sources/exchanges.js";
import {
  binanceKlines,
  coinloreGlobal,
  coinloreTickers,
  fearGreed,
  paprikaCoin,
  paprikaFind,
} from "../src/sources/fallbacks.js";
import { frankfurter } from "../src/sources/frankfurter.js";
import type { SourceContext } from "../src/sources/types.js";
import { CG_VS, FRANKFURTER_CURRENCIES, type MockRoute, mockFetch } from "./helpers.js";

const USD: Asset = { code: "USD", kind: "fiat", name: "US Dollar" };
const EUR: Asset = { code: "EUR", kind: "fiat", name: "Euro" };
const BDT: Asset = { code: "BDT", kind: "fiat", name: "Bangladeshi Taka" };
const BTC: Asset = { code: "BTC", kind: "crypto", name: "Bitcoin", coingeckoId: "bitcoin" };
const ETH: Asset = { code: "ETH", kind: "crypto", name: "Ethereum", coingeckoId: "ethereum" };

function ctx(routes: MockRoute[]): SourceContext & { calls: string[] } {
  const m = mockFetch(routes);
  return { http: new HttpClient({ fetch: m.fetch, retries: 0 }), calls: m.calls };
}

describe("frankfurter", () => {
  it("quotes ECB currencies and skips unsupported ones", async () => {
    const c = ctx([
      FRANKFURTER_CURRENCIES,
      {
        match: "/v1/latest?base=USD",
        body: { amount: 1, base: "USD", date: "2025-06-02", rates: { EUR: 0.9 } },
      },
    ]);
    const q = await frankfurter.quote(USD, EUR, c);
    expect(q).toMatchObject({ rate: 0.9, asOf: expect.stringContaining("2025-06-02") });
    expect(await frankfurter.quote(USD, BDT, c)).toBeNull();
  });
  it("returns a sorted time series", async () => {
    const c = ctx([
      FRANKFURTER_CURRENCIES,
      {
        match: "2025-01-01..2025-01-03",
        body: { rates: { "2025-01-03": { USD: 1.03 }, "2025-01-02": { USD: 1.02 } } },
      },
    ]);
    const s = await frankfurter.series(EUR, USD, "2025-01-01", "2025-01-03", c);
    expect(s).toEqual([
      { t: "2025-01-02", v: 1.02 },
      { t: "2025-01-03", v: 1.03 },
    ]);
  });
});

describe("currency-api", () => {
  it("reads lower-case tables and supports crypto + BDT", async () => {
    const c = ctx([
      {
        match: "currency-api@latest/v1/currencies/usd",
        body: { date: "2025-06-02", usd: { bdt: 122.5, btc: 0.00001 } },
      },
    ]);
    expect((await currencyApi.quote(USD, BDT, c))?.rate).toBe(122.5);
    expect((await currencyApi.quote(USD, BTC, c))?.rate).toBe(0.00001);
  });
  it("falls back to the Cloudflare mirror when jsDelivr fails", async () => {
    const c = ctx([
      { match: "cdn.jsdelivr.net", status: 500 },
      { match: "2025-01-15.currency-api.pages.dev", body: { date: "2025-01-15", usd: { bdt: 121 } } },
    ]);
    const q = await currencyApi.quote(USD, BDT, c, "2025-01-15");
    expect(q?.rate).toBe(121);
    expect(q?.sourceUrl).toContain("pages.dev");
  });
  it("returns null before its first history date", async () => {
    expect(await currencyApi.quote(USD, BDT, ctx([]), "2020-01-01")).toBeNull();
  });
});

describe("open.er-api", () => {
  it("quotes fiat latest only", async () => {
    const c = ctx([
      {
        match: "open.er-api.com/v6/latest/USD",
        body: {
          result: "success",
          base_code: "USD",
          time_last_update_utc: "Mon, 02 Jun 2025 00:02:31 +0000",
          rates: { BDT: 122 },
        },
      },
    ]);
    expect((await erApi.quote(USD, BDT, c))?.rate).toBe(122);
    expect(await erApi.quote(USD, BDT, c, "2025-01-01")).toBeNull();
    expect(await erApi.quote(USD, BTC, c)).toBeNull();
  });
});

describe("coinbase", () => {
  it("quotes live rates for fiat and crypto bases", async () => {
    const c = ctx([
      {
        match: "exchange-rates?currency=BTC",
        body: { data: { currency: "BTC", rates: { EUR: "55000.5" } } },
      },
    ]);
    expect((await coinbase.quote(BTC, EUR, c))?.rate).toBe(55000.5);
  });
  it("quotes dated spot prices, inverting fiat->crypto", async () => {
    const c = ctx([{ match: "/prices/BTC-USD/spot?date=2025-01-01", body: { data: { amount: "50000" } } }]);
    expect((await coinbase.quote(USD, BTC, c, "2025-01-01"))?.rate).toBe(1 / 50000);
  });
});

describe("coingecko", () => {
  it("quotes simple prices and inverts", async () => {
    const c = ctx([
      CG_VS,
      {
        match: "/simple/price?ids=bitcoin&vs_currencies=bdt",
        body: { bitcoin: { bdt: 7_500_000, last_updated_at: 1_750_000_000 } },
      },
    ]);
    expect((await coingecko.quote(BTC, BDT, c))?.rate).toBe(7_500_000);
    expect((await coingecko.quote(BDT, BTC, c))?.rate).toBeCloseTo(1 / 7_500_000);
  });
  it("uses the history endpoint with DD-MM-YYYY", async () => {
    const c = ctx([
      CG_VS,
      {
        match: "/coins/ethereum/history?date=31-01-2025",
        body: { market_data: { current_price: { usd: 3300 } } },
      },
    ]);
    expect((await coingecko.quote(ETH, USD, c, "2025-01-31"))?.rate).toBe(3300);
  });
  it("searches coins", async () => {
    const c = ctx([
      {
        match: "/search?query=pepe",
        body: { coins: [{ id: "pepe", symbol: "PEPE", name: "Pepe", market_cap_rank: 30 }] },
      },
    ]);
    expect(await cgSearch(c, "pepe")).toEqual([{ id: "pepe", symbol: "PEPE", name: "Pepe", rank: 30 }]);
  });
});

describe("exchanges", () => {
  it("binance maps USD to USDT and tries inverse pairs", async () => {
    const c = ctx([
      { match: "symbol=BTCUSDT", body: { price: "60000" } },
      { match: "symbol=ETHBTC", body: { price: "0.03" } },
    ]);
    expect((await binance.quote(BTC, USD, c))?.rate).toBe(60000);
    expect((await binance.quote(BTC, ETH, c))?.rate).toBeCloseTo(1 / 0.03);
    expect(await binance.quote(USD, EUR, c)).toBeNull();
  });
  it("kraken reads irregular result keys and ignores unknown pairs", async () => {
    const c = ctx([
      { match: "pair=BTCUSD", body: { error: [], result: { XXBTZUSD: { c: ["60100.5", "1"] } } } },
      { match: "pair=", body: { error: ["EQuery:Unknown asset pair"] } },
    ]);
    expect((await kraken.quote(BTC, USD, c))?.rate).toBe(60100.5);
    expect(await kraken.quote(BTC, BDT, c)).toBeNull();
  });
});

describe("fallback feeds", () => {
  it("coinlore, paprika, fear & greed and binance klines parse", async () => {
    const c = ctx([
      { match: "coinlore.net/api/tickers", body: { data: [{ symbol: "BTC", price_usd: "60000" }] } },
      { match: "coinlore.net/api/global", body: [{ total_mcap: 2e12, btc_d: "60" }] },
      {
        match: "coinpaprika.com/v1/search",
        body: { currencies: [{ id: "btc-bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1 }] },
      },
      {
        match: "coinpaprika.com/v1/coins/btc-bitcoin",
        body: { id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1 },
      },
      {
        match: "coinpaprika.com/v1/tickers/btc-bitcoin",
        body: { id: "btc-bitcoin", quotes: { USD: { price: 1 } } },
      },
      {
        match: "alternative.me/fng",
        body: { data: [{ value: "25", value_classification: "Extreme Fear", timestamp: "1750000000" }] },
      },
      { match: "klines?symbol=BTCUSDT", body: [[1750000000000, "1", "2", "0.5", "1.5", "10"]] },
    ]);
    expect((await coinloreTickers(c)).data.data[0]?.symbol).toBe("BTC");
    expect((await coinloreGlobal(c)).data[0]?.btc_d).toBe("60");
    expect(await paprikaFind(c, "BTC", "Bitcoin")).toBe("btc-bitcoin");
    expect((await paprikaCoin(c, "btc-bitcoin")).coin.name).toBe("Bitcoin");
    expect(await fearGreed(c)).toMatchObject({ value: 25, classification: "Extreme Fear" });
    expect((await binanceKlines(c, "BTC", "USD", 30))?.candles[0]).toMatchObject({
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
    });
  });
});
