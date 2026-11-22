import type { Asset } from "../assets.js";
import { FxError } from "../errors.js";
import { fromTable, HOUR, type RateSource, type SourceContext, ttlForDate, upperKeys } from "./types.js";

/** First day this dataset has history for. */
export const CURRENCY_API_FIRST_DATE = "2024-03-02";

const urls = (tag: string, base: string) => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${base}.min.json`,
  `https://${tag}.currency-api.pages.dev/v1/currencies/${base}.min.json`,
];

/** fawazahmed0/exchange-api: ~300 fiat, metal and crypto codes, daily, served from jsDelivr with a Cloudflare mirror. */
export const currencyApi: RateSource = {
  id: "currency-api",
  name: "fawazahmed0 Exchange API (jsDelivr CDN)",
  homepage: "https://github.com/fawazahmed0/exchange-api",
  covers: "both",
  history: true,

  async table(base, ctx: SourceContext, date) {
    if (date && date < CURRENCY_API_FIRST_DATE) return null;
    const key = base.code.toLowerCase();
    let lastErr: unknown;
    for (const url of urls(date ?? "latest", key)) {
      try {
        const res = await ctx.http.get<Record<string, unknown> | null>(url, {
          ttlMs: ttlForDate(date, HOUR),
          source: "currency-api",
          nullOn4xx: true,
        });
        const payload = res.data?.[key] as Record<string, unknown> | undefined;
        if (!res.data || !payload) return null;
        return {
          base: base.code,
          rates: upperKeys(payload),
          source: this.name,
          sourceUrl: url,
          asOf: `${String(res.data.date)} (daily)`,
          fetchedAt: res.fetchedAt,
        };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof FxError ? lastErr : new FxError("UPSTREAM", "currency-api is unavailable.");
  },

  async quote(from: Asset, to: Asset, ctx, date) {
    return fromTable((await this.table?.(from, ctx, date)) ?? null, to.code);
  },
};
