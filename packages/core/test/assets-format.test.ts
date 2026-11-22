import { describe, expect, it } from "vitest";
import {
  addDays,
  currenciesForCountry,
  downsample,
  FIAT,
  formatMoney,
  formatNumber,
  formatPct,
  parseDate,
  resolveAsset,
  searchLocal,
  seriesStats,
  sig,
  suggest,
  today,
} from "../src/index.js";

describe("resolveAsset", () => {
  it("resolves fiat codes case-insensitively", async () => {
    expect(await resolveAsset("bdt")).toMatchObject({ code: "BDT", kind: "fiat", name: "Bangladeshi Taka" });
  });
  it("resolves popular coins by symbol and id", async () => {
    expect(await resolveAsset("btc")).toMatchObject({ code: "BTC", kind: "crypto", coingeckoId: "bitcoin" });
    expect(await resolveAsset("solana")).toMatchObject({ code: "SOL", coingeckoId: "solana" });
  });
  it("resolves countries, common names and symbols", async () => {
    expect((await resolveAsset("Bangladesh")).code).toBe("BDT");
    expect((await resolveAsset("japan")).code).toBe("JPY");
    expect((await resolveAsset("taka")).code).toBe("BDT");
    expect((await resolveAsset("euros")).code).toBe("EUR");
    expect((await resolveAsset("€")).code).toBe("EUR");
    expect((await resolveAsset("gold")).kind).toBe("metal");
  });
  it("uses search for unknown coins and picks the best-ranked exact symbol", async () => {
    const a = await resolveAsset("zzz", async () => [
      { id: "zzz-fake", symbol: "zzz", name: "Fake", rank: 900 },
      { id: "zzz-real", symbol: "ZZZ", name: "Real", rank: 50 },
    ]);
    expect(a).toMatchObject({ code: "ZZZ", coingeckoId: "zzz-real" });
  });
  it("suggests close matches for typos", async () => {
    await expect(resolveAsset("BTD", async () => [])).rejects.toMatchObject({
      code: "UNKNOWN_CURRENCY",
      hint: expect.stringContaining("BDT"),
    });
    expect(suggest("USF", ["USD", "EUR"])).toEqual(["USD"]);
  });
  it("rejects empty input", async () => {
    await expect(resolveAsset("  ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("currency metadata", () => {
  it("covers 150+ fiat currencies with countries", () => {
    expect(FIAT.size).toBeGreaterThan(150);
    expect(FIAT.get("BDT")?.countries.map((c) => c.name)).toContain("Bangladesh");
    expect(FIAT.get("JPY")?.decimals).toBe(0);
    expect(currenciesForCountry("PA").map((c) => c.code)).toEqual(["PAB", "USD"]);
  });
  it("searches by country, name and symbol", () => {
    expect(searchLocal("bangladesh")[0]?.code).toBe("BDT");
    expect(searchLocal("yen")[0]?.code).toBe("JPY");
    expect(searchLocal("eth", "crypto")[0]?.code).toBe("ETH");
    expect(searchLocal("", "fiat", 500).length).toBeGreaterThan(150);
  });
});

describe("formatting", () => {
  it("formats fiat with Intl and locale", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "EUR", "de-DE")).toBe("1.234,50\u00a0€");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });
  it("formats crypto and tiny values with enough precision", () => {
    expect(formatMoney(0.00001234, "BTC")).toBe("0.00001234 BTC");
    expect(formatMoney(0.000012345, "USD")).toMatch(/^\$0\.0000123/);
    expect(formatNumber(1234567.891)).toBe("1,234,567.89");
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(null)).toBe("n/a");
    expect(sig(1.23456789012, 4)).toBe(1.235);
  });
});

describe("stats and dates", () => {
  it("computes series stats", () => {
    const s = seriesStats([
      { t: "2025-01-01", v: 100 },
      { t: "2025-01-02", v: 110 },
      { t: "2025-01-03", v: 90 },
      { t: "2025-01-04", v: 120 },
    ])!;
    expect(s.changePct).toBe(20);
    expect(s.min).toEqual({ t: "2025-01-03", v: 90 });
    expect(s.max.v).toBe(120);
    expect(s.avg).toBe(105);
    expect(s.volatilityPct).toBeGreaterThan(0);
    expect(seriesStats([])).toBeNull();
  });
  it("downsamples keeping endpoints", () => {
    const d = downsample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(d).toHaveLength(4);
    expect(d[0]).toBe(1);
    expect(d[3]).toBe(10);
  });
  it("parses absolute and relative dates", () => {
    expect(parseDate("2025-01-31")).toBe("2025-01-31");
    expect(parseDate("yesterday")).toBe(addDays(today(), -1));
    expect(parseDate("30d ago")).toBe(addDays(today(), -30));
    expect(parseDate("today")).toBeUndefined();
    expect(() => parseDate("2999-01-01")).toThrow(/future/);
    expect(() => parseDate("31/01/2025")).toThrow(
      expect.objectContaining({ hint: expect.stringContaining("YYYY-MM-DD") }),
    );
  });
});
