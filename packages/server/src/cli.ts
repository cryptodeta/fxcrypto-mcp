#!/usr/bin/env node
import "./polyfill.js";
import { createClient, formatPct, setDefaultLocale, toFxError } from "@fxcrypto/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpServer } from "./http.js";
import { CLIENTS, type ClientName, installClient } from "./init.js";
import { createServer } from "./server.js";
import { TOOL_NAMES } from "./tools.js";
import { NAME, VERSION } from "./version.js";

const HELP = `${NAME} v${VERSION} - currency + crypto MCP server (no API keys)

Usage:
  ${NAME}                         Start the MCP server over stdio (what MCP clients run)
  ${NAME} --http [--port 3000] [--host 127.0.0.1]
                                  Start a Streamable HTTP server at http://host:port/mcp
  ${NAME} init <client|all> [--dry-run]
                                  Add this server to a client config: ${CLIENTS.join(", ")}
  ${NAME} convert <amount> <from> <to> [--date YYYY-MM-DD]
  ${NAME} price <coin...> [--vs usd,eur]
  ${NAME} tools                   List MCP tools
  ${NAME} --version | --help

Environment:
  FXCRYPTO_LOCALE       Number formatting locale (default en-US)
  COINGECKO_API_KEY     Optional free CoinGecko demo key for higher rate limits
  FXCRYPTO_TIMEOUT_MS   Upstream timeout (default 8000)
  FXCRYPTO_HTTP_TOKEN   Require "Authorization: Bearer <token>" on /mcp
  PORT, HOST            HTTP defaults
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith("--") ? 2 : 1);
  return v && !v.startsWith("--") ? v : "true";
}

async function main() {
  const args = process.argv.slice(2);
  if (process.env.FXCRYPTO_LOCALE) setDefaultLocale(process.env.FXCRYPTO_LOCALE);
  const cmd = args[0];

  if (cmd === "--help" || cmd === "-h" || cmd === "help") return void process.stdout.write(HELP);
  if (cmd === "--version" || cmd === "-v") return void process.stdout.write(`${VERSION}\n`);
  if (cmd === "tools") return void process.stdout.write(`${TOOL_NAMES.join("\n")}\n`);

  if (cmd === "init") {
    const dryRun = flag(args, "dry-run") !== undefined;
    const target = args[1];
    const clients =
      target === "all" ? [...CLIENTS] : CLIENTS.includes(target as ClientName) ? [target as ClientName] : [];
    if (!clients.length) {
      process.stderr.write(`Usage: ${NAME} init <${CLIENTS.join("|")}|all> [--dry-run]\n`);
      process.exitCode = 1;
      return;
    }
    for (const c of clients) {
      const r = installClient(c, { dryRun });
      if (r.action === "command") process.stdout.write(`${c}: run this command:\n  ${r.command}\n`);
      else if (r.action === "dry-run")
        process.stdout.write(`${c}: would write ${r.path}\n${JSON.stringify(r.config, null, 2)}\n`);
      else
        process.stdout.write(
          `${c}: ${r.action} ${r.path}${r.action === "written" ? " (restart the app to load it)" : ""}\n`,
        );
    }
    return;
  }

  if (cmd === "convert" || cmd === "price") {
    const fx = createClient();
    try {
      if (cmd === "convert") {
        const date = flag(args, "date");
        const [, amount, from, to] = args;
        if (!amount || !from || !to) throw new Error(`Usage: ${NAME} convert <amount> <from> <to>`);
        const r = await fx.convert({ amount: Number(amount), from, to, date });
        process.stdout.write(
          `${r.formatted}${r.date ? ` on ${r.date}` : ""}\n  source: ${r.source} (as of ${r.asOf})\n`,
        );
      } else {
        const vs = (flag(args, "vs") ?? "usd").split(",");
        const r = await fx.price({ coins: args.slice(1), vs });
        for (const c of r.coins) {
          const parts = c.prices.map(
            (p) =>
              `${p.price ?? "n/a"} ${p.currency}${"change24hPct" in p ? ` (${formatPct(p.change24hPct as number)})` : ""}`,
          );
          process.stdout.write(`${c.symbol}: ${parts.join(", ")}\n`);
        }
        process.stdout.write(`  source: ${r.source}\n`);
      }
    } catch (err) {
      const e = toFxError(err);
      process.stderr.write(`Error: ${e.message}${e.hint ? `\nHint: ${e.hint}` : ""}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const fx = createClient();
  if (cmd === "--http" || cmd === "http" || process.env.MCP_TRANSPORT === "http") {
    const port = Number(flag(args, "port") ?? process.env.PORT ?? 3000);
    const host = flag(args, "host") ?? process.env.HOST ?? "127.0.0.1";
    await startHttpServer(fx, { port, host, token: process.env.FXCRYPTO_HTTP_TOKEN });
    process.stderr.write(`${NAME} v${VERSION} listening on http://${host}:${port}/mcp\n`);
    return;
  }
  if (cmd && cmd !== "stdio" && cmd !== "--stdio") {
    process.stderr.write(`Unknown command "${cmd}".\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const server = createServer(fx);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${NAME} v${VERSION} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error)?.stack ?? err}\n`);
  process.exit(1);
});
