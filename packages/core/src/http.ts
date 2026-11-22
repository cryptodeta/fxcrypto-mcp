import { TtlCache } from "./cache.js";
import { FxError } from "./errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Retries for network errors, 429 and 5xx (default 2). */
  retries?: number;
  /** Base backoff delay in ms (default 300, doubles each retry, plus jitter). */
  backoffMs?: number;
  cache?: TtlCache;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface GetOptions {
  /** Cache TTL in ms. 0 disables caching for this request. */
  ttlMs?: number;
  /** Human name of the upstream, used in error messages. */
  source?: string;
  headers?: Record<string, string>;
  /** Return null instead of throwing on HTTP 400/404 (e.g. unknown trading pair). */
  nullOn4xx?: boolean;
}

export interface HttpResult<T> {
  data: T;
  /** ISO time the payload was fetched from the upstream (earlier than now when served from cache). */
  fetchedAt: string;
  cached: boolean;
}

export interface HttpStats {
  requests: number;
  upstreamCalls: number;
  deduped: number;
  retries: number;
  failures: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** fetch wrapper: timeout, retries with exponential backoff + Retry-After, TTL cache and in-flight de-duplication. */
export class HttpClient {
  readonly cache: TtlCache;
  private readonly inflight = new Map<string, Promise<HttpResult<unknown>>>();
  private readonly fetchImpl: FetchLike;
  private readonly opts: Required<Omit<HttpOptions, "fetch" | "cache">>;
  readonly stats: HttpStats = { requests: 0, upstreamCalls: 0, deduped: 0, retries: 0, failures: 0 };

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.cache = options.cache ?? new TtlCache(800);
    this.opts = {
      timeoutMs: options.timeoutMs ?? 8000,
      retries: options.retries ?? 2,
      backoffMs: options.backoffMs ?? 300,
      userAgent: options.userAgent ?? "fxcrypto-mcp (+https://github.com/cryptodeta/fxcrypto-mcp)",
      sleep: options.sleep ?? defaultSleep,
      now: options.now ?? Date.now,
    };
  }

  async get<T>(url: string, options: GetOptions = {}): Promise<HttpResult<T>> {
    this.stats.requests++;
    const ttl = options.ttlMs ?? 60_000;
    const hit = ttl > 0 ? this.cache.get<T>(url) : undefined;
    if (hit) return { data: hit.value, fetchedAt: new Date(hit.stored).toISOString(), cached: true };

    const pending = this.inflight.get(url);
    if (pending) {
      this.stats.deduped++;
      return pending as Promise<HttpResult<T>>;
    }
    const promise = this.fetchWithRetry<T>(url, options).then((data) => {
      if (ttl > 0 && data !== null) this.cache.set(url, data, ttl);
      return { data, fetchedAt: new Date(this.opts.now()).toISOString(), cached: false };
    });
    this.inflight.set(url, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(url);
    }
  }

  /** Convenience: payload only. */
  async json<T>(url: string, options: GetOptions = {}): Promise<T> {
    return (await this.get<T>(url, options)).data;
  }

  private async fetchWithRetry<T>(url: string, options: GetOptions): Promise<T> {
    const source = options.source ?? new URL(url).hostname;
    let lastError: FxError | undefined;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      if (attempt > 0) this.stats.retries++;
      let retryAfterMs: number | undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        this.stats.upstreamCalls++;
        const res = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: { accept: "application/json", "user-agent": this.opts.userAgent, ...options.headers },
        });
        if (res.ok) {
          const text = await res.text();
          try {
            return JSON.parse(text) as T;
          } catch {
            lastError = new FxError(
              "UPSTREAM",
              `${source} returned invalid JSON.`,
              "The source may be down; try again later.",
            );
          }
        } else if ((res.status === 400 || res.status === 404) && options.nullOn4xx) {
          return null as T;
        } else if (res.status === 429) {
          const ra = Number(res.headers.get("retry-after"));
          retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : undefined;
          lastError = new FxError(
            "RATE_LIMITED",
            `${source} rate limit reached (HTTP 429).`,
            "Wait a minute and retry; cached answers keep working. Fewer distinct requests also helps.",
          );
        } else if (res.status >= 500) {
          lastError = new FxError(
            "UPSTREAM",
            `${source} is having problems (HTTP ${res.status}).`,
            "Try again shortly.",
          );
        } else {
          // Other 4xx errors are not retryable.
          const body = (await res.text().catch(() => "")).slice(0, 200);
          this.stats.failures++;
          throw new FxError(
            "UPSTREAM",
            `${source} rejected the request (HTTP ${res.status})${body ? `: ${body}` : ""}.`,
            "Check the currency/coin codes and dates.",
          );
        }
      } catch (err) {
        if (err instanceof FxError) throw err;
        const aborted = (err as Error)?.name === "AbortError";
        lastError = aborted
          ? new FxError("TIMEOUT", `${source} did not answer within ${this.opts.timeoutMs} ms.`, "Try again.")
          : new FxError(
              "NETWORK",
              `Could not reach ${source}: ${(err as Error)?.message ?? String(err)}.`,
              "Check internet access or proxy settings.",
            );
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.opts.retries) {
        const backoff = this.opts.backoffMs * 2 ** attempt * (1 + Math.random() * 0.25);
        await this.opts.sleep(retryAfterMs ?? backoff);
      }
    }
    this.stats.failures++;
    throw lastError ?? new FxError("UPSTREAM", `${source} request failed.`);
  }
}
