import { FxError } from "./errors.js";
import { addDays, isoDate } from "./stats.js";

export function today(): string {
  return isoDate(new Date());
}

/** Accepts YYYY-MM-DD, "today", "yesterday", "7d ago", "-30d", "2 weeks ago", "1y ago". Rejects future dates. */
export function parseDate(input: string | undefined, field = "date"): string | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const raw = String(input).trim().toLowerCase();
  const t = today();
  let out: string | undefined;
  if (raw === "today" || raw === "now" || raw === "latest") return undefined;
  if (raw === "yesterday") out = addDays(t, -1);
  const rel = raw.match(/^-?(\d+)\s*(d|day|days|w|week|weeks|m|month|months|y|year|years)(\s+ago)?$/);
  if (!out && rel) {
    const n = Number(rel[1]);
    const unit = rel[2]![0];
    const days = unit === "d" ? n : unit === "w" ? n * 7 : unit === "m" ? n * 30 : n * 365;
    out = addDays(t, -days);
  }
  if (!out && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) out = raw;
  if (!out) {
    throw new FxError(
      "INVALID_INPUT",
      `Invalid ${field} "${input}".`,
      'Use YYYY-MM-DD (e.g. 2025-01-31), "yesterday", or a relative value like "30d ago".',
    );
  }
  if (out > t)
    throw new FxError("INVALID_INPUT", `${field} ${out} is in the future.`, `Use a date on or before ${t}.`);
  if (out < "1999-01-04") {
    throw new FxError(
      "NO_DATA",
      `${field} ${out} is too early.`,
      "Data starts on 1999-01-04 (ECB) or later for most sources.",
    );
  }
  return out === t ? undefined : out;
}
