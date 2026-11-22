import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { makeClient } from "../../core/test/helpers.js";
import { startHttpServer } from "../src/http.js";
import { configPath, installClient, serverEntry } from "../src/init.js";
import { VERSION } from "../src/version.js";

describe("Streamable HTTP transport", () => {
  it("serves /health, rejects GET /mcp and handles MCP over POST", async () => {
    const { fx } = makeClient([]);
    const server = await startHttpServer(fx, { port: 0 });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    try {
      const health = await (await fetch(`${base}/health`)).json();
      expect(health).toMatchObject({ status: "ok", version: VERSION });
      expect((await fetch(`${base}/mcp`)).status).toBe(405);
      expect((await fetch(`${base}/nope`)).status).toBe(404);

      const client = new Client({ name: "t", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(14);
      const r = await client.callTool({ name: "list_currencies", arguments: { query: "yen", type: "fiat" } });
      expect(JSON.stringify(r)).toContain("JPY");
      await client.close();
    } finally {
      server.close();
    }
  });

  it("enforces the bearer token when configured", async () => {
    const { fx } = makeClient([]);
    const server = await startHttpServer(fx, { port: 0, token: "s3cret" });
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });
});

describe("init helper", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "fxcrypto-"));

  it("writes Cursor config and merges with existing servers", () => {
    const home = tmp();
    const path = configPath("cursor", { home })!;
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "x" } }, extra: true }));
    const r = installClient("cursor", { home, platform: "linux" });
    expect(r.action).toBe("written");
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers.fxcrypto).toEqual({ command: "npx", args: ["-y", "fxcrypto-mcp"] });
    expect(cfg.extra).toBe(true);
    expect(existsSync(`${path}.bak`)).toBe(true);
    expect(installClient("cursor", { home, platform: "linux" }).action).toBe("unchanged");
  });

  it("uses the right paths and formats per client", () => {
    const home = "/h";
    expect(configPath("claude", { home, platform: "darwin" })).toBe(
      join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    );
    expect(configPath("claude", { home, platform: "win32", env: { APPDATA: "C:/AppData" } })).toContain(
      "C:/AppData",
    );
    expect(configPath("windsurf", { home })).toBe(join(home, ".codeium", "windsurf", "mcp_config.json"));
    expect(serverEntry("win32")).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "fxcrypto-mcp"] });
    const cwd = tmp();
    const v = installClient("vscode", { cwd, dryRun: true, platform: "linux" });
    expect(v.action).toBe("dry-run");
    expect((v.config as { servers: Record<string, unknown> }).servers.fxcrypto).toMatchObject({
      type: "stdio",
    });
    expect(installClient("claude-code").command).toMatch(/^claude mcp add fxcrypto -- /);
  });

  it("refuses to overwrite invalid JSON", () => {
    const home = tmp();
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), "{oops");
    expect(() => installClient("cursor", { home })).toThrow(/not valid JSON/);
  });
});

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
