import { fromTable, HOUR, type RateSource } from "./types.js";

interface ErApiResponse {
  result: string;
  base_code: string;
  time_last_update_utc: string;
  rates: Record<string, number>;
}

/** ExchangeRate-API open endpoint: ~160 fiat currencies, daily, latest only. Attribution required. */
export const erApi: RateSource = {
  id: "open-er-api",
  name: "ExchangeRate-API (open access)",
  homepage: "https://www.exchangerate-api.com",
  covers: "fiat",
  history: false,

  async table(base, ctx, date) {
    if (date || base.kind !== "fiat") return null;
    const url = `https://open.er-api.com/v6/latest/${base.code}`;
    const res = await ctx.http.get<ErApiResponse | null>(url, {
      ttlMs: HOUR,
      source: "open.er-api.com",
      nullOn4xx: true,
    });
    if (res.data?.result !== "success") return null;
    return {
      base: base.code,
      rates: res.data.rates,
      source: this.name,
      sourceUrl: url,
      asOf: new Date(res.data.time_last_update_utc).toISOString(),
      fetchedAt: res.fetchedAt,
    };
  },

  async quote(from, to, ctx, date) {
    if (to.kind !== "fiat") return null;
    return fromTable((await this.table?.(from, ctx, date)) ?? null, to.code);
  },
};
