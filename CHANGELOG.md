# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-22

### Added

- 14 MCP tools: `convert`, `get_rates`, `rate_history`, `compare_currencies`, `compare_sources`,
  `list_currencies`, `crypto_price`, `crypto_markets`, `crypto_trending`, `coin_details`,
  `crypto_chart`, `crypto_global`, `portfolio_value`, `server_status`.
- MCP resources (`fxcrypto://currencies`, `fxcrypto://coins`, `fxcrypto://sources`,
  `fxcrypto://rate/{from}/{to}`) and prompts (`convert_money`, `market_brief`, `currency_report`,
  `portfolio_review`).
- Multi-source engine with automatic fallback: Frankfurter (ECB), fawazahmed0 currency-api
  (jsDelivr + Cloudflare mirror), ExchangeRate-API open access, CoinGecko, Coinbase, Binance, Kraken;
  CoinLore, Coinpaprika and alternative.me for market fallbacks.
- USD pivot for pairs no single source covers.
- In-memory TTL cache, in-flight request de-duplication, retries with exponential backoff and
  `Retry-After` support, per-request timeouts.
- Natural input: ISO codes, coin symbols, CoinGecko ids, country names, common names and symbols.
- Locale-aware formatting with `Intl`.
- stdio and stateless Streamable HTTP transports, optional bearer token, `/health` endpoint.
- `init` command that writes config for Claude Desktop, Cursor, VS Code and Windsurf, and prints the
  Claude Code command.
- CLI shortcuts: `convert` and `price`.
- Dockerfile, GitHub Actions CI, vitest suite with mocked sources and opt-in live smoke tests.
