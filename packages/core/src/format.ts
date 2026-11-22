import { FIAT } from "./assets.js";

let defaultLocale = "en-US";

export function setDefaultLocale(locale: string): void {
  defaultLocale = safeLocale(locale);
}

export function getDefaultLocale(): string {
  return defaultLocale;
}

function safeLocale(locale?: string): string {
  if (!locale) return defaultLocale;
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? defaultLocale;
  } catch {
    return defaultLocale;
  }
}

/** Sensible precision: 2 decimals for normal amounts, more significant digits for tiny values. */
function fractionDigitsFor(value: number, preferred: number): { min: number; max: number } {
  const abs = Math.abs(value);
  if (abs === 0) return { min: 0, max: preferred };
  if (abs >= 1) return { min: Math.min(preferred, 2), max: Math.max(preferred, abs >= 1000 ? preferred : 4) };
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(abs)) - 1);
  return { min: Math.min(2, preferred), max: Math.min(20, leadingZeros + 4) };
}

/** Format a number with locale grouping and adaptive precision. */
export function formatNumber(value: number, locale?: string, maxFraction?: number): string {
  if (!Number.isFinite(value)) return String(value);
  const { max } = fractionDigitsFor(value, 2);
  return new Intl.NumberFormat(safeLocale(locale), {
    maximumFractionDigits: maxFraction ?? max,
  }).format(value);
}

/** Format a money amount: Intl currency style for fiat, "1.2345 BTC" for crypto. */
export function formatMoney(value: number, code: string, locale?: string): string {
  if (!Number.isFinite(value)) return `${value} ${code}`;
  const loc = safeLocale(locale);
  const fiat = FIAT.get(code.toUpperCase());
  if (fiat && fiat.kind === "fiat") {
    const { min, max } =
      Math.abs(value) >= 1
        ? { min: fiat.decimals, max: fiat.decimals }
        : fractionDigitsFor(value, fiat.decimals);
    try {
      return new Intl.NumberFormat(loc, {
        style: "currency",
        currency: fiat.code,
        minimumFractionDigits: Math.min(min, max),
        maximumFractionDigits: Math.max(min, max),
      }).format(value);
    } catch {
      // fall through
    }
  }
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 6 : fractionDigitsFor(value, 8).max;
  return `${new Intl.NumberFormat(loc, { maximumFractionDigits: digits }).format(value)} ${code.toUpperCase()}`;
}

/** Round to n significant digits (keeps JSON readable without losing meaningful precision). */
export function sig(value: number, digits = 8): number {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(digits));
}

export function formatPct(value: number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const s = new Intl.NumberFormat(safeLocale(locale), {
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value);
  return `${s}%`;
}

export function compact(value: number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat(safeLocale(locale), { notation: "compact", maximumFractionDigits: 2 }).format(
    value,
  );
}
