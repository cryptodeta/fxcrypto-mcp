import "./polyfill.js";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { FxCrypto } from "@fxcrypto/core";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { NAME, VERSION } from "./version.js";

export interface HttpServerOptions {
  port?: number;
  host?: string;
  /** Optional bearer token required on /mcp. */
  token?: string;
  /** Allowed CORS origin (default *). */
  cors?: string;
}

const MAX_BODY = 1_000_000;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Stateless Streamable HTTP MCP endpoint at /mcp, plus /health. One shared client (and cache) for all requests. */
export function startHttpServer(fx: FxCrypto, options: HttpServerOptions = {}): Promise<Server> {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";
  const httpServer = createHttpServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", options.cors ?? "*");
    res.setHeader(
      "access-control-allow-headers",
      "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
    );
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-expose-headers", "mcp-session-id");
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/health") {
      sendJson(res, 200, { status: "ok", name: NAME, version: VERSION, cache: fx.status().cache });
      return;
    }
    if (url.pathname === "/") {
      sendJson(res, 200, {
        name: NAME,
        version: VERSION,
        mcp: "/mcp",
        health: "/health",
        docs: "https://github.com/cryptodeta/fxcrypto-mcp",
      });
      return;
    }
    if (url.pathname !== "/mcp") {
      sendJson(res, 404, { error: "Not found. The MCP endpoint is /mcp." });
      return;
    }
    if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
      sendJson(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed (stateless server: use POST)." },
        id: null,
      });
      return;
    }
    try {
      const body = await readBody(req);
      const server = createServer(fx);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32700, message: (err as Error).message },
          id: null,
        });
      }
    }
  });
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve(httpServer));
  });
}
