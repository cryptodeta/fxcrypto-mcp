import { toFxError } from "@fxcrypto/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Human summary first (what the model should say), then the full JSON payload with sources and timestamps. */
export function ok(summary: string, data: unknown): CallToolResult {
  const json = JSON.stringify(data, null, 2);
  const body = json.length > 6000 ? JSON.stringify(data) : json;
  return { content: [{ type: "text", text: `${summary}\n\n${body}` }] };
}

export function fail(err: unknown): CallToolResult {
  const e = toFxError(err);
  const lines = [`Error [${e.code}]: ${e.message}`];
  if (e.hint) lines.push(`Hint: ${e.hint}`);
  if (Array.isArray(e.details) && e.details.length) {
    lines.push("Source errors:");
    for (const d of e.details as Array<{ source: string; message: string }>)
      lines.push(`- ${d.source}: ${d.message}`);
  }
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

export async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

/** Accept ["btc","eth"], "btc,eth" or "btc eth". */
export function list(input: string | string[] | undefined): string[] {
  if (input === undefined) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .flatMap((s) => s.split(/[,\s]+/))
    .map((s) => s.trim())
    .filter(Boolean);
}
