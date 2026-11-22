export * from "./assets.js";
export { TtlCache } from "./cache.js";
export {
  ALL_SOURCES,
  type ClientOptions,
  type ConversionResult,
  FxCryptoClient,
  type HistoryResult,
  mapLimit,
} from "./client.js";
export { FxCrypto, type MarketOrder, type MarketRow } from "./crypto.js";
export { parseDate, today } from "./dates.js";
export { FxError, type FxErrorCode, suggest, toFxError } from "./errors.js";
export * from "./format.js";
export { type FetchLike, HttpClient, type HttpOptions } from "./http.js";
export { CURRENCY_API_FIRST_DATE } from "./sources/currencyApi.js";
export type { Quote, RateSource, RateTable, SourceContext } from "./sources/types.js";
export * from "./stats.js";

import type { ClientOptions } from "./client.js";
import { FxCrypto } from "./crypto.js";

/** Create a ready-to-use client. Options can also come from env: FXCRYPTO_TIMEOUT_MS, COINGECKO_API_KEY. */
export function createClient(options: ClientOptions = {}): FxCrypto {
  const env = typeof process !== "undefined" ? process.env : {};
  return new FxCrypto({
    timeoutMs: env.FXCRYPTO_TIMEOUT_MS ? Number(env.FXCRYPTO_TIMEOUT_MS) : undefined,
    coingeckoKey: env.COINGECKO_API_KEY || undefined,
    ...options,
  });
}
