export type FxErrorCode =
  | "INVALID_INPUT"
  | "UNKNOWN_CURRENCY"
  | "UNKNOWN_COIN"
  | "AMBIGUOUS_CURRENCY"
  | "UNSUPPORTED"
  | "NO_DATA"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "UPSTREAM"
  | "ALL_SOURCES_FAILED";

/** An error with a stable machine code and a human hint telling the caller how to fix it. */
export class FxError extends Error {
  readonly code: FxErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: FxErrorCode, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = "FxError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, details: this.details };
  }
}

export function toFxError(err: unknown): FxError {
  if (err instanceof FxError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new FxError("UPSTREAM", message);
}

/** Small edit distance used for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function suggest(input: string, candidates: Iterable<string>, max = 3): string[] {
  const needle = input.toUpperCase();
  const scored: Array<[string, number]> = [];
  for (const c of candidates) {
    const cand = c.toUpperCase();
    const swapped =
      cand.length === needle.length && [...cand].sort().join("") === [...needle].sort().join("") ? 1 : 99;
    const d = Math.min(editDistance(needle, cand), swapped);
    if (d <= 2) scored.push([c, d]);
  }
  return scored
    .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))
    .slice(0, max)
    .map((s) => s[0]);
}
