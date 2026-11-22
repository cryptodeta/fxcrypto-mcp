import { webcrypto } from "node:crypto";

// Node 18 has no global Web Crypto object; the MCP SDK's HTTP transport needs it.
if (!(globalThis as { crypto?: unknown }).crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
