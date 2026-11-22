import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { CG_VS, FRANKFURTER_CURRENCIES, makeClient } from "../../core/test/helpers.js";
import { createServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tools.js";

let client: Client | undefined;

async function connect(routes: Parameters<typeof makeClient>[0]) {
  const { fx } = makeClient(routes);
  const server = createServer(fx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(b);
  return client;
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "") as string;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe("MCP server", () => {
  it("lists every tool with descriptions and read-only annotations", async () => {
    const c = await connect([]);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(40);
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("converts with a human summary and JSON payload", async () => {
    const c = await connect([
      FRANKFURTER_CURRENCIES,
      { match: "v1/latest?base=USD", body: { date: "2025-06-02", rates: { EUR: 0.9 } } },
    ]);
    const r = await c.callTool({ name: "convert", arguments: { amount: 100, from: "USD", to: "EUR" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("$100.00 = €90.00");
    expect(text(r)).toContain('"source"');
  });

  it("converts to several targets at once", async () => {
    const c = await connect([
      FRANKFURTER_CURRENCIES,
      { match: "v1/latest?base=USD", body: { date: "2025-06-02", rates: { EUR: 0.9, JPY: 150 } } },
    ]);
    const r = await c.callTool({ name: "convert", arguments: { amount: 1, from: "USD", to: "EUR, JPY" } });
    expect(text(r)).toMatch(/€0\.90[\s\S]*¥150/);
  });

  it("returns actionable errors as isError results", async () => {
    const c = await connect([{ match: "coingecko", body: { coins: [] } }]);
    const r = await c.callTool({ name: "convert", arguments: { amount: 1, from: "USD", to: "qqqzzz" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Error \[UNKNOWN_CURRENCY\][\s\S]*Hint:/);
  });

  it("validates input with zod", async () => {
    const c = await connect([]);
    const r = await c.callTool({ name: "convert", arguments: { amount: "lots", from: "USD", to: "EUR" } });
    expect(r.isError).toBe(true);
  });

  it("serves crypto tools", async () => {
    const c = await connect([
      CG_VS,
      { match: "simple/price?ids=bitcoin", body: { bitcoin: { usd: 60000, usd_24h_change: 2 } } },
    ]);
    const r = await c.callTool({ name: "crypto_price", arguments: { coins: ["btc"] } });
    expect(text(r)).toContain("BTC: $60,000.00 (+2% 24h)");
  });

  it("lists currencies offline", async () => {
    const c = await connect([]);
    const r = await c.callTool({ name: "list_currencies", arguments: { query: "bangladesh", type: "fiat" } });
    expect(text(r)).toContain("BDT (Bangladeshi Taka; Bangladesh)");
  });

  it("exposes resources, a rate template and prompts", async () => {
    const c = await connect([
      FRANKFURTER_CURRENCIES,
      { match: "v1/latest?base=EUR", body: { date: "2025-06-02", rates: { USD: 1.1 } } },
    ]);
    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining(["fxcrypto://currencies", "fxcrypto://coins", "fxcrypto://sources"]),
    );
    const { resourceTemplates } = await c.listResourceTemplates();
    expect(resourceTemplates[0]?.uriTemplate).toBe("fxcrypto://rate/{from}/{to}");
    const rate = await c.readResource({ uri: "fxcrypto://rate/EUR/USD" });
    expect(JSON.parse((rate.contents[0] as { text: string }).text).rate).toBe(1.1);
    const fiat = await c.readResource({ uri: "fxcrypto://currencies" });
    expect(JSON.parse((fiat.contents[0] as { text: string }).text).length).toBeGreaterThan(150);
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(["convert_money", "market_brief", "currency_report", "portfolio_review"]),
    );
    const p = await c.getPrompt({
      name: "convert_money",
      arguments: { amount: "100", from: "USD", to: "BDT" },
    });
    expect((p.messages[0]!.content as { text: string }).text).toContain("100 USD to BDT");
  });

  it("reports status", async () => {
    const c = await connect([]);
    const r = await c.callTool({ name: "server_status", arguments: {} });
    expect(text(r)).toMatch(/fxcrypto-mcp v\d/);
  });
});
