import { describe, expect, it } from "vitest";
import { CG_VS, makeClient } from "./helpers.js";

const market = (id: string, symbol: string, change: number, rank: number) => ({
  id,
  symbol,
  name: id,
  current_price: 10,
  market_cap: 1e9,
  market_cap_rank: rank,
  total_volume: 1e6,
  ath: 20,
  ath_change_percentage: -50,
  price_change_percentage_24h_in_currency: change,
  price_change_percentage_7d_in_currency: 1,
});

describe("crypto market data", () => {
  it("prices coins in supported and unsupported vs currencies", async () => {
    const { fx } = makeClient([
      CG_VS,
      {
        match: "simple/price?ids=bitcoin,ethereum&vs_currencies=usd",
        body: { bitcoin: { usd: 60000, usd_24h_change: 1.5, usd_market_cap: 1e12 }, ethereum: { usd: 3000 } },
      },
      { match: "currency-api@latest/v1/currencies/usd", body: { date: "d", usd: { npr: 140 } } },
      { match: "frankfurter.dev/v1/currencies", body: { USD: "x" } },
    ]);
    const r = await fx.price({ coins: ["btc", "eth"], vs: ["usd", "npr"] });
    expect(r.coins[0]?.prices[0]).toMatchObject({ currency: "USD", price: 60000, change24hPct: 1.5 });
    expect(r.coins[0]?.prices[1]).toMatchObject({ currency: "NPR", price: 8_400_000 });
  });

  it("rejects fiat where a coin is expected", async () => {
    const { fx } = makeClient([]);
    await expect(fx.price({ coins: ["usd"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("ranks gainers and losers", async () => {
    const { fx } = makeClient([
      CG_VS,
      {
        match: "/coins/markets",
        body: [market("a", "a", 5, 1), market("b", "b", -9, 2), market("c", "c", 12, 3)],
      },
    ]);
    const g = await fx.markets({ order: "gainers", limit: 2 });
    expect(g.coins.map((c) => c.symbol)).toEqual(["C", "A"]);
    const l = await fx.markets({ order: "losers", limit: 1 });
    expect(l.coins[0]?.symbol).toBe("B");
  });

  it("falls back to CoinLore when CoinGecko fails", async () => {
    const { fx } = makeClient([
      CG_VS,
      { match: "/coins/markets", status: 429 },
      {
        match: "coinlore.net/api/tickers",
        body: {
          data: [
            {
              symbol: "BTC",
              name: "Bitcoin",
              nameid: "bitcoin",
              rank: 1,
              price_usd: "60000",
              percent_change_24h: "1",
              market_cap_usd: "1",
              volume24: 5,
            },
          ],
        },
      },
    ]);
    const r = await fx.markets({});
    expect(r.source).toBe("CoinLore");
    expect(r.note).toMatch(/CoinGecko unavailable/);
  });

  it("returns trending coins, or gainers as a fallback", async () => {
    const ok = makeClient([
      {
        match: "/search/trending",
        body: {
          coins: [
            {
              item: {
                id: "pepe",
                symbol: "pepe",
                name: "Pepe",
                market_cap_rank: 30,
                data: { price: 0.00001 },
              },
            },
          ],
        },
      },
    ]);
    expect((await ok.fx.trending()).coins[0]).toMatchObject({ symbol: "PEPE", priceUsd: 0.00001 });
    const down = makeClient([
      CG_VS,
      { match: "/search/trending", status: 500 },
      { match: "/coins/markets", body: [market("x", "x", 50, 9)] },
    ]);
    const t = await down.fx.trending();
    expect(t.note).toMatch(/gainers/);
  });

  it("builds coin details", async () => {
    const { fx } = makeClient([
      CG_VS,
      {
        match: "/coins/bitcoin?",
        body: {
          id: "bitcoin",
          symbol: "btc",
          name: "Bitcoin",
          market_cap_rank: 1,
          description: { en: "<p>Bitcoin is <b>money</b>.</p>" },
          links: {
            homepage: ["https://bitcoin.org"],
            blockchain_site: ["https://x"],
            repos_url: { github: [] },
          },
          market_data: {
            current_price: { usd: 60000 },
            ath: { usd: 70000 },
            ath_change_percentage: { usd: -14.3 },
            max_supply: 21e6,
          },
        },
      },
    ]);
    const d = await fx.coinDetails({ coin: "btc" });
    expect(d.description).toBe("Bitcoin is money.");
    expect(d.market).toMatchObject({ price: 60000, ath: 70000, maxSupply: 21e6 });
    expect(d.links.homepage).toBe("https://bitcoin.org");
  });

  it("returns OHLC candles and falls back to Binance", async () => {
    const ok = makeClient([
      CG_VS,
      { match: "/ohlc?vs_currency=usd&days=7", body: [[1750000000000, 1, 2, 0.5, 1.5]] },
    ]);
    const c = await ok.fx.chart({ coin: "btc", type: "ohlc", days: 5 });
    expect(c.days).toBe(7);
    expect("candles" in c && c.candles[0]).toMatchObject({ open: 1, close: 1.5 });
    const fb = makeClient([
      CG_VS,
      { match: "market_chart", status: 500 },
      { match: "klines?symbol=BTCUSDT", body: [[1750000000000, "1", "2", "0.5", "1.5", "1"]] },
    ]);
    const l = await fb.fx.chart({ coin: "btc", days: 30 });
    expect(l.source).toBe("Binance");
  });

  it("returns global stats with fear & greed", async () => {
    const { fx } = makeClient([
      {
        match: "/global",
        body: {
          data: {
            total_market_cap: { usd: 2e12 },
            total_volume: { usd: 1e11 },
            market_cap_percentage: { btc: 58, eth: 10 },
            market_cap_change_percentage_24h_usd: 1,
          },
        },
      },
      {
        match: "alternative.me",
        body: { data: [{ value: "70", value_classification: "Greed", timestamp: "1750000000" }] },
      },
    ]);
    const g = await fx.global();
    expect(g).toMatchObject({ btcDominancePct: 58, fearGreed: { value: 70 } });
  });
});
