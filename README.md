# fxcrypto-mcp

**Currency + crypto data for AI assistants. No API keys. Works everywhere.**

An [MCP](https://modelcontextprotocol.io) server that converts money between 160+ fiat currencies,
precious metals and 15,000+ coins, with historical rates, charts, market data and portfolio valuation.
It pulls from several free sources, falls back automatically when one is down or rate limited,
and tells you where every number came from.

[![CI](https://github.com/cryptodeta/fxcrypto-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/cryptodeta/fxcrypto-mcp/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)

```text
You:    How much is 100 USD in Bangladeshi taka, and how did it move this month?
Claude: $100.00 = BDT 12,488.22 (fawazahmed0 currency-api, 2026-11-22).
        Over 30 days USD/BDT rose 0.97%, from 123.68 to 124.88.
```

## Why this one

Most finance MCP servers wrap one unofficial endpoint and break when it rate limits. This one is built
for reliability:

- **No keys, no sign-up.** Every source is free and public.
- **Multi-source with fallback.** ECB (Frankfurter), currency-api, ExchangeRate-API, CoinGecko,
  Coinbase, Binance and Kraken. If one fails, the next answers. Pairs no single source has are
  computed through USD.
- **Every currency in the world.** BDT, NGN, PKR, VND, KES, ARS and the rest, not only the ~30 ECB
  currencies.
- **Source and timestamp in every answer**, plus a `compare_sources` tool to cross-check a rate.
- **Fast and polite.** In-memory TTL cache, request de-duplication, retries with backoff and
  `Retry-After` support. Repeat questions are served from cache in under 1 ms.
- **Natural input.** `USD`, `usd`, `$`, `dollar`, `Japan`, `taka`, `btc`, `bitcoin` and `pepe` all
  work. Typos get "did you mean" suggestions.
- **Small.** Two runtime dependencies (the MCP SDK and zod), about 110 KB of bundled code.
- **stdio and Streamable HTTP**, Docker image, and a one-command `init` for popular clients.

## Quickstart (1 minute)

You need Node.js 18.17 or newer.

```bash
npx -y fxcrypto-mcp init claude     # or: cursor, vscode, windsurf, claude-code, all
```

Restart the app and ask: _"Convert 250 euros to Nigerian naira"_ or _"What are the top crypto losers
today?"_

Try it in a terminal first:

```bash
npx -y fxcrypto-mcp convert 100 USD BDT
npx -y fxcrypto-mcp price btc eth sol --vs usd,eur
```

> Not yet on npm? Run from source: `git clone https://github.com/cryptodeta/fxcrypto-mcp && cd fxcrypto-mcp && npm install && npm run build`,
> then use `node /path/to/fxcrypto-mcp/packages/server/dist/cli.js` wherever the configs below say `npx -y fxcrypto-mcp`.

## Client configuration

All clients use the same command: `npx -y fxcrypto-mcp`. On Windows, use `"command": "cmd"` with
`"args": ["/c", "npx", "-y", "fxcrypto-mcp"]` (the `init` command does this for you).

<details open>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "fxcrypto": { "command": "npx", "args": ["-y", "fxcrypto-mcp"] }
  }
}
```
</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add fxcrypto -- npx -y fxcrypto-mcp
```
</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "fxcrypto": { "command": "npx", "args": ["-y", "fxcrypto-mcp"] }
  }
}
```
</details>

<details>
<summary><b>VS Code (GitHub Copilot)</b></summary>

`.vscode/mcp.json`:

```json
{
  "servers": {
    "fxcrypto": { "type": "stdio", "command": "npx", "args": ["-y", "fxcrypto-mcp"] }
  }
}
```

Or: `code --add-mcp '{"name":"fxcrypto","command":"npx","args":["-y","fxcrypto-mcp"]}'`
</details>

<details>
<summary><b>Windsurf</b></summary>

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "fxcrypto": { "command": "npx", "args": ["-y", "fxcrypto-mcp"] }
  }
}
```
</details>

<details>
<summary><b>Remote / HTTP (any client that supports Streamable HTTP)</b></summary>

```bash
npx -y fxcrypto-mcp --http --port 3000            # http://127.0.0.1:3000/mcp
# or
docker build -t fxcrypto-mcp . && docker run -p 3000:3000 fxcrypto-mcp
```

```json
{
  "mcpServers": {
    "fxcrypto": { "url": "http://localhost:3000/mcp" }
  }
}
```

Set `FXCRYPTO_HTTP_TOKEN=secret` to require `Authorization: Bearer secret`. `GET /health` returns
status and cache stats. The HTTP server is stateless, so it scales horizontally.
</details>

## Tools

| Tool                 | What it answers                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `convert`            | "100 USD in BDT", "0.5 BTC in EUR", "1 ETH in SOL", many targets at once, optional historical date |
| `get_rates`          | All ~160 fiat rates for a base, or just the symbols you name (fiat or crypto)                      |
| `rate_history`       | Time series for any pair with min, max, average, change % and volatility                           |
| `compare_currencies` | How a currency moved against a list of others over N days, strongest to weakest                    |
| `compare_sources`    | The same rate from every source, with median and spread (spot stale data)                          |
| `list_currencies`    | Search by code, name, symbol or country; crypto search covers CoinGecko's full list                |
| `crypto_price`       | Live prices in any currency with 24h change, market cap and volume                                 |
| `crypto_markets`     | Top coins by market cap or volume, or the biggest 24h gainers and losers; category filter          |
| `crypto_trending`    | Coins and categories trending in the last 24h                                                      |
| `coin_details`       | Description, links, supply, FDV, ATH/ATL with dates, 1h to 1y performance                          |
| `crypto_chart`       | Line (price + volume) or OHLC candles for 1 to 365 days, with stats                                |
| `crypto_global`      | Total market cap, volume, BTC/ETH dominance, Fear & Greed Index                                    |
| `portfolio_value`    | Value a mix of crypto, cash and gold in one currency, with allocation %                            |
| `server_status`      | Version, sources, cache hit rate and request counters                                              |

All tools are read-only. Each answer starts with a one-line human summary, followed by JSON with the
full data, `source`, `sourceUrl`, `asOf` (when the upstream says the value is valid) and `fetchedAt`.

**Resources:** `fxcrypto://currencies`, `fxcrypto://coins`, `fxcrypto://sources`,
`fxcrypto://rate/{from}/{to}` (for example `fxcrypto://rate/USD/BDT`).

**Prompts:** `convert_money`, `market_brief`, `currency_report`, `portfolio_review`.

### Example prompts

- "Convert 5,000 Bangladeshi taka to Japanese yen at the 15 January 2025 rate."
- "How did the US dollar do against EUR, GBP, INR, BDT and BTC over the last 90 days?"
- "Show me EUR/USD for the past year: high, low and volatility."
- "Top 10 coins in euros, then the five biggest losers today."
- "I hold 0.25 BTC, 2 ETH, 1,000 USDT and 1 ounce of gold. What is that in BDT?"
- "Is CoinGecko's BTC price in line with Binance and Kraken right now?"

## Data sources

| Source                                                                                                                                                                           | Used for                                                          | Coverage        | Updates                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------- | ----------------------- |
| [Frankfurter](https://frankfurter.dev) (European Central Bank)                                                                                                                   | Major fiat pairs, history since 1999                              | ~30 currencies  | Working days ~16:00 CET |
| [fawazahmed0 currency-api](https://github.com/fawazahmed0/exchange-api) via jsDelivr + Cloudflare mirror                                                                         | All other fiat, metals, crypto fallback, history since 2024-03-02 | ~300 codes      | Daily                   |
| [ExchangeRate-API open access](https://www.exchangerate-api.com/docs/free)                                                                                                       | Fiat fallback                                                     | ~160 currencies | Daily                   |
| [CoinGecko](https://www.coingecko.com/en/api) public API                                                                                                                         | Crypto prices, markets, details, charts, trending, global         | 15,000+ coins   | ~1 min                  |
| [Coinbase](https://docs.cdp.coinbase.com/coinbase-app/docs/api-exchange-rates)                                                                                                   | Live crypto and fiat fallback, dated spot prices                  | 600+ codes      | Live                    |
| [Binance](https://developers.binance.com) market data, [Kraken](https://docs.kraken.com/api/)                                                                                    | Live crypto fallback, OHLC fallback                               | Major pairs     | Live                    |
| [CoinLore](https://www.coinlore.com/cryptocurrency-data-api), [Coinpaprika](https://coinpaprika.com/api/), [alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | Market list, coin details, Fear & Greed                           |                 |                         |
| [Unicode CLDR](https://cldr.unicode.org) (bundled)                                                                                                                               | Currency names, symbols, decimals, countries                      | 255 regions     | Build time              |

Fallback order: fiat pairs try ECB, then currency-api, ExchangeRate-API and Coinbase. Crypto pairs try
CoinGecko, then Coinbase, Binance, Kraken and currency-api. If nothing has the direct pair, the rate is
computed through USD and the answer says so (`via: "USD"`).

Please respect each provider's terms. ExchangeRate-API asks for attribution, which this server includes
in every answer that uses it.

## Configuration

| Variable              | Default              | Purpose                                                                                |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `FXCRYPTO_LOCALE`     | `en-US`              | Number formatting locale (`de-DE`, `hi-IN`, `ja-JP`, ...). Tools also accept `locale`. |
| `COINGECKO_API_KEY`   | none                 | Optional free CoinGecko demo key for higher rate limits                                |
| `FXCRYPTO_TIMEOUT_MS` | `8000`               | Upstream request timeout                                                               |
| `FXCRYPTO_HTTP_TOKEN` | none                 | Require a bearer token on `/mcp`                                                       |
| `PORT` / `HOST`       | `3000` / `127.0.0.1` | HTTP mode listen address (Docker uses `0.0.0.0`)                                       |

## CLI

```text
fxcrypto-mcp                              start the MCP server on stdio
fxcrypto-mcp --http [--port N] [--host H] start the Streamable HTTP server
fxcrypto-mcp init <client|all> [--dry-run]
fxcrypto-mcp convert 100 USD BDT [--date 2025-01-15]
fxcrypto-mcp price btc eth --vs usd,eur
fxcrypto-mcp tools | --version | --help
```

`init` merges into existing config files, keeps your other servers and writes a `.bak` copy first.

## Use as a library

```ts
import { createClient } from "fxcrypto-mcp";

const fx = createClient();
const r = await fx.convert({ amount: 100, from: "USD", to: "BDT" });
console.log(r.formatted, r.source, r.asOf);
const h = await fx.history({ from: "BTC", to: "EUR", days: 90 });
console.log(h.stats);
```

## Development

```bash
npm install
npm run check          # biome lint + tsc + vitest + build
npm run test:live      # optional real-API smoke tests
npx @modelcontextprotocol/inspector node packages/server/dist/cli.js
```

The repo is an npm workspaces monorepo: `packages/core` (rate engine, no MCP dependency) and
`packages/server` (MCP server, CLI). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Limitations

- Rates are for information only, not for trading or accounting. Fiat sources publish daily
  reference rates, not live interbank quotes.
- Free CoinGecko access is rate limited (roughly 5 to 30 calls per minute, shared per IP). The cache and
  fallbacks soften this; a free demo key in `COINGECKO_API_KEY` raises the limit.
- CoinGecko public history covers about the last 365 days. Non-ECB fiat history starts on 2024-03-02.
- Historical series for non-ECB pairs are sampled (up to 45 daily snapshots) to stay fast.
- Price alerts and background jobs are out of scope.

## License

[MIT](LICENSE). Data belongs to the respective providers.
