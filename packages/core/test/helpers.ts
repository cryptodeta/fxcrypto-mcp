import { type FetchLike, FxCrypto, HttpClient } from "../src/index.js";

export type Handler = unknown | ((url: string) => unknown);
export interface MockRoute {
  match: string | RegExp;
  status?: number;
  body?: Handler;
  headers?: Record<string, string>;
  /** Throw a network error instead of responding. */
  networkError?: boolean;
}

/** Fetch mock: first matching route wins; unmatched URLs return 404 so tests notice. */
export function mockFetch(routes: MockRoute[]) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const route = routes.find((r) =>
      typeof r.match === "string" ? url.includes(r.match) : r.match.test(url),
    );
    if (!route) return new Response(JSON.stringify({ error: `unmocked ${url}` }), { status: 404 });
    if (route.networkError) throw new TypeError("fetch failed");
    const body = typeof route.body === "function" ? (route.body as (u: string) => unknown)(url) : route.body;
    return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json", ...route.headers },
    });
  };
  return { fetch, calls };
}

export function makeClient(routes: MockRoute[]) {
  const m = mockFetch(routes);
  const http = new HttpClient({ fetch: m.fetch, retries: 1, backoffMs: 1, sleep: async () => {} });
  return { fx: new FxCrypto({ http }), calls: m.calls, http };
}

export const FRANKFURTER_CURRENCIES = {
  match: "frankfurter.dev/v1/currencies",
  body: {
    EUR: "Euro",
    USD: "United States Dollar",
    JPY: "Japanese Yen",
    GBP: "British Pound",
    INR: "Indian Rupee",
  },
};

export const CG_VS = {
  match: "/simple/supported_vs_currencies",
  body: ["usd", "eur", "bdt", "btc", "eth", "jpy", "gbp", "inr"],
};
