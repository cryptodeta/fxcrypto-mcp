interface Entry<T> {
  value: T;
  expires: number;
  stored: number;
}

/** Tiny in-memory LRU cache with per-entry TTL. No timers, so it never keeps the process alive. */
export class TtlCache {
  private readonly map = new Map<string, Entry<unknown>>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): { value: T; stored: number } | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return { value: entry.value as T, stored: entry.stored };
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    const now = this.now();
    this.map.set(key, { value, expires: now + ttlMs, stored: now });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
    };
  }
}
