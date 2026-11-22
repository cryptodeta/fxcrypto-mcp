# Contributing

Thanks for helping! Bug reports, new data sources and docs fixes are all welcome.

## Setup

```bash
git clone https://github.com/cryptodeta/fxcrypto-mcp
cd fxcrypto-mcp
npm install
npm run check        # lint + typecheck + tests + build
```

Requirements: Node.js 18.17 or newer.

## Layout

```
packages/
  core/     @fxcrypto/core - rate engine, sources, cache, formatting (no MCP dependency)
    src/sources/   one file per upstream API
    test/          unit tests with a mocked fetch
  server/   fxcrypto-mcp - MCP tools, resources, prompts, stdio/HTTP transports, CLI, init helper
```

The core package is bundled into the published `fxcrypto-mcp` package by tsup, so users only install
the MCP SDK and zod.

## Useful scripts

| Command                           | What it does                                    |
| --------------------------------- | ----------------------------------------------- |
| `npm test`                        | Unit tests (no network)                         |
| `npm run test:live`               | Real API smoke tests                            |
| `npm run lint` / `npm run format` | Biome lint / auto-fix                           |
| `npm run typecheck`               | TypeScript, strict                              |
| `npm run build`                   | Build both packages                             |
| `npm start`                       | Run the built server on stdio                   |
| `npm run gen:regions`             | Refresh country/currency data from Unicode CLDR |

Try the server interactively with the MCP Inspector:

```bash
npm run build
npx @modelcontextprotocol/inspector node packages/server/dist/cli.js
```

## Adding a data source

1. Create `packages/core/src/sources/<name>.ts` implementing `RateSource` (return `null` when a pair
   is not supported, throw `FxError` on real failures).
2. Use `ctx.http.get()` so you get caching, retries, timeouts and de-duplication for free. Pick a TTL
   that matches how often the upstream updates.
3. Add it to the fallback chains in `client.ts` and to `ALL_SOURCES`.
4. Add mocked tests in `packages/core/test/sources.test.ts`.
5. The source must be free and usable without an API key, and its terms must allow this use.

## Guidelines

- Keep dependencies minimal. Native `fetch` and `Intl` cover most needs.
- Every tool answer must include the source and a timestamp.
- Errors should say what went wrong and how to fix it (`FxError` with a `hint`).
- English only in code, docs and messages.
- Add a CHANGELOG entry under "Unreleased".

## Releasing (maintainers)

```bash
npm run check
npm version <patch|minor|major> -w fxcrypto-mcp   # also bump packages/server/src/version.ts
npm publish -w fxcrypto-mcp --access public
```
