import { ALL_SOURCES, COINS_BY_SYMBOL, FIAT, type FxCrypto, toFxError } from "@fxcrypto/core";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

const json = (uri: string, data: unknown) => ({
  contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
});

export function registerResources(server: McpServer, fx: FxCrypto): void {
  server.registerResource(
    "fiat-currencies",
    "fxcrypto://currencies",
    {
      title: "Fiat currencies",
      description:
        "All supported fiat currencies and metals with name, symbol, decimals and countries (Unicode CLDR).",
      mimeType: "application/json",
    },
    (uri) =>
      json(
        uri.href,
        [...FIAT.values()].map((f) => ({ ...f, countries: f.countries.map((c) => c.name) })),
      ),
  );

  server.registerResource(
    "popular-coins",
    "fxcrypto://coins",
    {
      title: "Popular coins",
      description: "Built-in symbol to CoinGecko id map for popular coins (others are resolved by search).",
      mimeType: "application/json",
    },
    (uri) =>
      json(
        uri.href,
        [...COINS_BY_SYMBOL.entries()].map(([symbol, v]) => ({ symbol, ...v })),
      ),
  );

  server.registerResource(
    "sources",
    "fxcrypto://sources",
    {
      title: "Data sources",
      description: "Upstream data sources, what they cover and attribution links.",
      mimeType: "application/json",
    },
    (uri) =>
      json(uri.href, {
        rateSources: ALL_SOURCES.map((s) => ({
          id: s.id,
          name: s.name,
          homepage: s.homepage,
          covers: s.covers,
          history: s.history,
        })),
        marketFallbacks: [
          { name: "CoinLore", homepage: "https://www.coinlore.com/cryptocurrency-data-api" },
          { name: "Coinpaprika", homepage: "https://coinpaprika.com" },
          {
            name: "alternative.me Fear & Greed",
            homepage: "https://alternative.me/crypto/fear-and-greed-index/",
          },
        ],
      }),
  );

  server.registerResource(
    "live-rate",
    new ResourceTemplate("fxcrypto://rate/{from}/{to}", { list: undefined }),
    {
      title: "Live rate",
      description:
        "Current rate between two currencies or coins, e.g. fxcrypto://rate/USD/BDT or fxcrypto://rate/BTC/EUR.",
      mimeType: "application/json",
    },
    async (uri, vars) => {
      try {
        const r = await fx.convert({ amount: 1, from: String(vars.from), to: String(vars.to) });
        return json(uri.href, r);
      } catch (err) {
        return json(uri.href, { error: toFxError(err).toJSON() });
      }
    },
  );
}
