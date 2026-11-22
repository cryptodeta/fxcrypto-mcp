# @fxcrypto/core

Internal engine for [fxcrypto-mcp](../../README.md): multi-source fiat and crypto rates with fallback,
caching, retries, history and market data. It has no MCP dependency and is bundled into the published
`fxcrypto-mcp` package, which re-exports its API (`createClient`, `FxCrypto`, `FxError`, ...).
