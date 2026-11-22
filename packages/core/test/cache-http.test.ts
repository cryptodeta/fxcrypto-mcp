import { describe, expect, it } from "vitest";
import { FxError, HttpClient, TtlCache } from "../src/index.js";
import { mockFetch } from "./helpers.js";

describe("TtlCache", () => {
  it("expires entries after the TTL", () => {
    let now = 1000;
    const c = new TtlCache(10, () => now);
    c.set("a", 1, 100);
    expect(c.get("a")?.value).toBe(1);
    now = 1200;
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts least recently used entries", () => {
    const c = new TtlCache(2);
    c.set("a", 1, 1000);
    c.set("b", 2, 1000);
    c.get("a");
    c.set("c", 3, 1000);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")?.value).toBe(1);
    expect(c.size).toBe(2);
    expect(c.stats().hits).toBeGreaterThan(0);
  });
});

const fast = { retries: 2, backoffMs: 1, sleep: async () => {} };

describe("HttpClient", () => {
  it("caches responses and serves them from cache", async () => {
    const m = mockFetch([{ match: "x.test", body: { v: 1 } }]);
    const http = new HttpClient({ fetch: m.fetch, ...fast });
    const a = await http.get("https://x.test/a", { ttlMs: 1000 });
    const b = await http.get("https://x.test/a", { ttlMs: 1000 });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(m.calls).toHaveLength(1);
  });

  it("de-duplicates concurrent identical requests", async () => {
    const m = mockFetch([{ match: "x.test", body: { v: 1 } }]);
    const http = new HttpClient({ fetch: m.fetch, ...fast });
    await Promise.all([
      http.json("https://x.test/a"),
      http.json("https://x.test/a"),
      http.json("https://x.test/a"),
    ]);
    expect(m.calls).toHaveLength(1);
    expect(http.stats.deduped).toBe(2);
  });

  it("retries 5xx and network errors, then succeeds", async () => {
    let n = 0;
    const http = new HttpClient({
      ...fast,
      fetch: async () => {
        n++;
        if (n === 1) throw new TypeError("socket hang up");
        if (n === 2) return new Response("oops", { status: 503 });
        return new Response('{"ok":true}');
      },
    });
    expect(await http.json("https://x.test/r", { ttlMs: 0 })).toEqual({ ok: true });
    expect(n).toBe(3);
    expect(http.stats.retries).toBe(2);
  });

  it("honours Retry-After on 429 and reports RATE_LIMITED", async () => {
    const waits: number[] = [];
    const m = mockFetch([{ match: "x.test", status: 429, headers: { "retry-after": "2" } }]);
    const http = new HttpClient({ fetch: m.fetch, retries: 1, sleep: async (ms) => void waits.push(ms) });
    await expect(http.json("https://x.test/l", { source: "X" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(waits).toEqual([2000]);
  });

  it("does not retry other 4xx errors", async () => {
    const m = mockFetch([{ match: "x.test", status: 401, body: { error: "nope" } }]);
    const http = new HttpClient({ fetch: m.fetch, ...fast });
    const err = (await http.json("https://x.test/a").catch((e: unknown) => e)) as FxError;
    expect(err).toBeInstanceOf(FxError);
    expect(err.code).toBe("UPSTREAM");
    expect(m.calls).toHaveLength(1);
  });

  it("returns null for 400/404 when nullOn4xx is set", async () => {
    const m = mockFetch([{ match: "x.test", status: 400 }]);
    const http = new HttpClient({ fetch: m.fetch, ...fast });
    expect(await http.json("https://x.test/a", { nullOn4xx: true })).toBeNull();
  });

  it("times out slow upstreams", async () => {
    const http = new HttpClient({
      retries: 0,
      timeoutMs: 20,
      fetch: (_u, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    });
    await expect(http.json("https://slow.test/")).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects invalid JSON with a clear error", async () => {
    const http = new HttpClient({ ...fast, retries: 0, fetch: async () => new Response("<html>") });
    await expect(http.json("https://x.test/")).rejects.toThrow(/invalid JSON/);
  });
});
