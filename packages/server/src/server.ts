import { createClient, type FxCrypto } from "@fxcrypto/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import { NAME, VERSION } from "./version.js";

export const INSTRUCTIONS = `fxcrypto: currency and crypto data with no API keys.
- Use convert for any "how much is X in Y" question (fiat or crypto, optional date).
- Use rate_history / compare_currencies for trends, crypto_price / crypto_markets / coin_details / crypto_chart for crypto.
- Every result includes source and timestamps; mention them. Rates are informational, not for trading.`;

/** Build an MCP server instance. Pass a shared client so all sessions share the cache. */
export function createServer(fx: FxCrypto = createClient()): McpServer {
  const server = new McpServer(
    { name: NAME, version: VERSION, title: "FX + Crypto rates" },
    { instructions: INSTRUCTIONS, capabilities: { logging: {} } },
  );
  registerTools(server, fx);
  registerResources(server, fx);
  registerPrompts(server);
  return server;
}
