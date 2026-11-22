/**
 * Live smoke tests against the real upstream APIs. Skipped by default.
 * Run with: npm run test:live   (sets FXCRYPTO_LIVE=1)
 */
import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";

const live = process.env.FXCRYPTO_LIVE === "1";

describe.skipIf(!live)("live smoke tests", () => {
  const fx = createClient();

  it("converts 100 USD to BDT", async () => {
    const r = await fx.convert({ amount: 100, from: "USD", to: "BDT" });
    expect(r.result).toBeGreaterThan(5000);
    console.log(r.formatted, "|", r.source, "|", r.asOf);
  });

  it("converts 1 BTC to EUR", async () => {
    const r = await fx.convert({ amount: 1, from: "BTC", to: "EUR" });
    expect(r.result).toBeGreaterThan(1000);
    console.log(r.formatted, "|", r.source, "|", r.asOf);
  });

  it("fetches 30 days of EUR/USD", async () => {
    const h = await fx.history({ from: "EUR", to: "USD", days: 30 });
    expect(h.stats?.points).toBeGreaterThan(10);
    console.log("EUR/USD 30d", h.stats?.changePct, "% |", h.source);
  });

  it("lists top coins", async () => {
    const m = await fx.markets({ limit: 5 });
    expect(m.coins.length).toBe(5);
  });
});
