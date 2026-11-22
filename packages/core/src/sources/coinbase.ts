import { fromTable, MINUTE, type RateSource, ttlForDate, upperKeys } from "./types.js";

interface CoinbaseRates {
  data: { currency: string; rates: Record<string, string> };
}

interface CoinbaseSpot {
  data: { amount: string; base: string; currency: string };
}

/** Coinbase public exchange rates (fiat + crypto, live) and dated spot prices. */
export const coinbase: RateSource = {
  id: "coinbase",
  name: "Coinbase",
  homepage: "https://www.coinbase.com",
  covers: "both",
  history: true,

  async table(base, ctx, date) {
    if (date || base.kind === "metal") return null;
    const url = `https://api.coinbase.com/v2/exchange-rates?currency=${base.code}`;
    const res = await ctx.http.get<CoinbaseRates | null>(url, {
      ttlMs: MINUTE,
      source: "Coinbase",
      nullOn4xx: true,
    });
    if (!res.data?.data?.rates) return null;
    return {
      base: base.code,
      rates: upperKeys(res.data.data.rates),
      source: this.name,
      sourceUrl: url,
      asOf: res.fetchedAt,
      fetchedAt: res.fetchedAt,
    };
  },

  async quote(from, to, ctx, date) {
    if (from.kind === "metal" || to.kind === "metal") return null;
    if (!date) return fromTable((await this.table?.(from, ctx)) ?? null, to.code);
    // Dated spot price: only crypto -> fiat (or inverse).
    const [crypto, fiat, invert] =
      from.kind === "crypto" && to.kind !== "crypto"
        ? [from, to, false]
        : to.kind === "crypto" && from.kind !== "crypto"
          ? [to, from, true]
          : [null, null, false];
    if (!crypto || !fiat) return null;
    const url = `https://api.coinbase.com/v2/prices/${crypto.code}-${fiat.code}/spot?date=${date}`;
    const res = await ctx.http.get<CoinbaseSpot | null>(url, {
      ttlMs: ttlForDate(date, MINUTE),
      source: "Coinbase",
      nullOn4xx: true,
    });
    const amount = Number(res.data?.data?.amount);
    if (!amount) return null;
    return {
      from: from.code,
      to: to.code,
      rate: invert ? 1 / amount : amount,
      source: this.name,
      sourceUrl: url,
      asOf: `${date} (daily spot)`,
      fetchedAt: res.fetchedAt,
    };
  },
};
