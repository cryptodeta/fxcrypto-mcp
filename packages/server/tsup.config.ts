import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  splitting: true,
  minify: false,
  // The core engine is bundled so `npx fxcrypto-mcp` only needs the MCP SDK and zod.
  noExternal: ["@fxcrypto/core"],
});
