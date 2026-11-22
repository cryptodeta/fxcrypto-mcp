import { POPULAR_COINS } from "./data/coins.js";
import { CURRENCY_DIGITS, REGION_CURRENCIES } from "./data/regions.js";
import { FxError, suggest } from "./errors.js";

export type AssetKind = "fiat" | "metal" | "crypto";

export interface Asset {
  /** Upper-case code, e.g. USD, BDT, BTC. */
  code: string;
  kind: AssetKind;
  name: string;
  /** CoinGecko coin id for crypto assets. */
  coingeckoId?: string;
}

export interface FiatInfo {
  code: string;
  kind: "fiat" | "metal";
  name: string;
  symbol: string;
  decimals: number;
  countries: Array<{ code: string; name: string }>;
}

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const METALS: Record<string, string> = {
  XAU: "Gold (troy ounce)",
  XAG: "Silver (troy ounce)",
  XPT: "Platinum (troy ounce)",
  XPD: "Palladium (troy ounce)",
};

const SPECIAL: Record<string, string> = { XDR: "IMF Special Drawing Rights" };

/** Unambiguous currency symbols users type. */
const SYMBOL_ALIASES: Record<string, string> = {
  $: "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  "₩": "KRW",
  "₺": "TRY",
  "₦": "NGN",
  "₱": "PHP",
  "₫": "VND",
  "₪": "ILS",
  "₴": "UAH",
  "₿": "BTC",
  Ξ: "ETH",
};

const COMMON_NAMES: Record<string, string> = {
  DOLLAR: "USD",
  BUCK: "USD",
  EURO: "EUR",
  POUND: "GBP",
  STERLING: "GBP",
  YEN: "JPY",
  YUAN: "CNY",
  RENMINBI: "CNY",
  RMB: "CNY",
  TAKA: "BDT",
  RUPEE: "INR",
  RUPIAH: "IDR",
  RINGGIT: "MYR",
  BAHT: "THB",
  DIRHAM: "AED",
  RIYAL: "SAR",
  LIRA: "TRY",
  NAIRA: "NGN",
  CEDI: "GHS",
  SHEKEL: "ILS",
  WON: "KRW",
  PESO: "MXN",
  REAL: "BRL",
  RAND: "ZAR",
  FRANC: "CHF",
  GOLD: "XAU",
  SILVER: "XAG",
  BITCOIN: "BTC",
  ETHER: "ETH",
  SATS: "BTC",
};

function symbolOf(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

function buildFiat(): Map<string, FiatInfo> {
  const map = new Map<string, FiatInfo>();
  for (const [region, codes] of Object.entries(REGION_CURRENCIES)) {
    const regionName = regionNames.of(region) ?? region;
    for (const code of codes) {
      let info = map.get(code);
      if (!info) {
        info = {
          code,
          kind: "fiat",
          name: currencyNames.of(code) ?? code,
          symbol: symbolOf(code),
          decimals: CURRENCY_DIGITS[code] ?? 2,
          countries: [],
        };
        map.set(code, info);
      }
      info.countries.push({ code: region, name: regionName });
    }
  }
  for (const [code, name] of Object.entries({ ...METALS, ...SPECIAL })) {
    map.set(code, {
      code,
      kind: code in METALS ? "metal" : "fiat",
      name,
      symbol: code,
      decimals: 4,
      countries: [],
    });
  }
  return map;
}

/** All fiat currencies (current legal tender per Unicode CLDR) plus precious metals and XDR. */
export const FIAT: ReadonlyMap<string, FiatInfo> = buildFiat();

export const COINS_BY_SYMBOL: ReadonlyMap<string, { id: string; name: string }> = new Map(
  POPULAR_COINS.map(([s, id, name]) => [s, { id, name }]),
);
const COINS_BY_ID: ReadonlyMap<string, { symbol: string; name: string }> = new Map(
  POPULAR_COINS.map(([s, id, name]) => [id, { symbol: s, name }]),
);

export function isFiatCode(code: string): boolean {
  return FIAT.has(code.toUpperCase());
}

export function fiatAsset(code: string): Asset {
  const info = FIAT.get(code.toUpperCase());
  if (!info) throw new FxError("UNKNOWN_CURRENCY", `Unknown fiat currency "${code}".`);
  return { code: info.code, kind: info.kind, name: info.name };
}

/** Country name or ISO region code -> fiat currencies in that country (primary first). */
export function currenciesForCountry(input: string): FiatInfo[] {
  const q = input.trim().toLowerCase();
  for (const [region, codes] of Object.entries(REGION_CURRENCIES)) {
    if (region.toLowerCase() === q || (regionNames.of(region) ?? "").toLowerCase() === q) {
      return codes.map((c) => FIAT.get(c)).filter((f): f is FiatInfo => !!f);
    }
  }
  return [];
}

export interface CoinSearchHit {
  id: string;
  symbol: string;
  name: string;
  rank?: number | null;
}

export type CoinSearchFn = (query: string) => Promise<CoinSearchHit[]>;

/**
 * Resolve user input ("usd", "Bangladesh", "taka", "$", "btc", "bitcoin", "pepe") to an Asset.
 * Fiat codes win over crypto symbols with the same letters.
 */
export async function resolveAsset(input: string, searchCoins?: CoinSearchFn): Promise<Asset> {
  const raw = (input ?? "").trim();
  if (!raw)
    throw new FxError("INVALID_INPUT", "Currency or coin is empty.", "Pass a code like USD, BDT or BTC.");
  const upper = raw.toUpperCase();

  const sym = SYMBOL_ALIASES[raw] ?? SYMBOL_ALIASES[upper];
  if (sym) return resolveAsset(sym, searchCoins);

  const fiat = FIAT.get(upper);
  if (fiat) return { code: fiat.code, kind: fiat.kind, name: fiat.name };

  const coin = COINS_BY_SYMBOL.get(upper);
  if (coin) return { code: upper, kind: "crypto", name: coin.name, coingeckoId: coin.id };
  const byId = COINS_BY_ID.get(raw.toLowerCase());
  if (byId) return { code: byId.symbol, kind: "crypto", name: byId.name, coingeckoId: raw.toLowerCase() };

  const singular = upper.replace(/S$/, "");
  const common = COMMON_NAMES[upper] ?? COMMON_NAMES[singular];
  if (common) return resolveAsset(common, searchCoins);

  // Country name ("Bangladesh", "japan") or exact currency name ("Bangladeshi Taka").
  const byCountry = currenciesForCountry(raw);
  if (byCountry.length > 0) {
    const primary = byCountry[0]!;
    return { code: primary.code, kind: primary.kind, name: primary.name };
  }
  for (const info of FIAT.values()) {
    if (info.name.toLowerCase() === raw.toLowerCase())
      return { code: info.code, kind: info.kind, name: info.name };
  }

  if (searchCoins && /^[\w .-]{1,40}$/.test(raw)) {
    const hits = await searchCoins(raw);
    const exactSymbol = hits.filter((h) => h.symbol.toUpperCase() === upper);
    const best =
      exactSymbol.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0] ??
      hits.find((h) => h.id === raw.toLowerCase() || h.name.toLowerCase() === raw.toLowerCase());
    if (best)
      return { code: best.symbol.toUpperCase(), kind: "crypto", name: best.name, coingeckoId: best.id };
    if (hits.length) {
      const fiatIdeas = suggest(upper, FIAT.keys(), 2);
      throw new FxError(
        "UNKNOWN_COIN",
        `No exact match for "${raw}".`,
        `Did you mean: ${[
          ...fiatIdeas.map((c) => `${c} (${FIAT.get(c)?.name})`),
          ...hits.slice(0, 5).map((h) => `${h.symbol.toUpperCase()} (${h.name}, id ${h.id})`),
        ].join(", ")}? Pass the symbol or CoinGecko id.`,
      );
    }
  }

  const ideas = suggest(upper, [...FIAT.keys(), ...COINS_BY_SYMBOL.keys()]);
  throw new FxError(
    "UNKNOWN_CURRENCY",
    `Unknown currency or coin "${raw}".`,
    ideas.length
      ? `Did you mean ${ideas.join(", ")}? Use list_currencies to search.`
      : "Use an ISO 4217 code (USD, EUR, BDT), a country name, or a coin symbol/CoinGecko id. Use list_currencies to search.",
  );
}

export interface CurrencySearchResult {
  code: string;
  kind: AssetKind;
  name: string;
  symbol?: string;
  countries?: string[];
  coingeckoId?: string;
}

/** Offline search over fiat (code, name, symbol, country) and popular coins. */
export function searchLocal(
  query = "",
  kind: "all" | "fiat" | "crypto" = "all",
  limit = 50,
): CurrencySearchResult[] {
  const q = query.trim().toLowerCase();
  const out: Array<CurrencySearchResult & { score: number }> = [];
  if (kind !== "crypto") {
    for (const f of FIAT.values()) {
      let score = q ? 0 : 1;
      if (q) {
        if (f.code.toLowerCase() === q) score = 100;
        else if (f.symbol.toLowerCase() === q) score = 60;
        else if (f.name.toLowerCase().includes(q)) score = 40;
        else if (f.countries.some((c) => c.name.toLowerCase() === q || c.code.toLowerCase() === q))
          score = 80;
        else if (f.countries.some((c) => c.name.toLowerCase().includes(q))) score = 30;
      }
      if (score > 0)
        out.push({
          code: f.code,
          kind: f.kind,
          name: f.name,
          symbol: f.symbol,
          countries: f.countries.map((c) => c.name),
          score,
        });
    }
  }
  if (kind !== "fiat") {
    POPULAR_COINS.forEach(([symbol, id, name], i) => {
      let score = q ? 0 : 0.5 - i / 1000;
      if (q) {
        if (symbol.toLowerCase() === q || id === q) score = 90;
        else if (name.toLowerCase().includes(q) || id.includes(q)) score = 35;
      }
      if (score > 0) out.push({ code: symbol, kind: "crypto", name, coingeckoId: id, score });
    });
  }
  return out
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map(({ score: _s, ...rest }) => rest);
}
