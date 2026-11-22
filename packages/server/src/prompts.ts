import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const user = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "convert_money",
    {
      title: "Convert money",
      description: "Convert an amount and explain the rate, source and recent trend.",
      argsSchema: { amount: z.string(), from: z.string(), to: z.string() },
    },
    ({ amount, from, to }) =>
      user(
        `Convert ${amount} ${from} to ${to} with the convert tool. Then use rate_history for the last 30 days of ${from}/${to} ` +
          "and tell me in two or three sentences whether now is a good or bad moment compared with the month's range. Always cite the source and timestamp.",
      ),
  );

  server.registerPrompt(
    "market_brief",
    {
      title: "Crypto market brief",
      description: "A short daily crypto market briefing.",
      argsSchema: { currency: z.string().optional() },
    },
    ({ currency }) =>
      user(
        `Give me a crypto market brief in ${currency ?? "USD"}: use crypto_global (market cap, dominance, fear & greed), ` +
          "crypto_markets for the top 10, crypto_markets with order 'gainers' and 'losers' (limit 5 each) and crypto_trending. " +
          "Summarise in under 200 words with bullet points and cite sources.",
      ),
  );

  server.registerPrompt(
    "currency_report",
    {
      title: "Currency strength report",
      description: "How a currency performed against others over a period.",
      argsSchema: {
        base: z.string(),
        targets: z.string().describe("Comma-separated, e.g. EUR,GBP,BDT,INR"),
        days: z.string().optional(),
      },
    },
    ({ base, targets, days }) =>
      user(
        `Use compare_currencies with base ${base}, targets ${targets} and days ${days ?? "30"}. ` +
          "Then use rate_history for the biggest mover. Report which currencies the base strengthened or weakened against, with numbers and sources.",
      ),
  );

  server.registerPrompt(
    "portfolio_review",
    {
      title: "Portfolio review",
      description: "Value holdings and comment on concentration and 24h moves.",
      argsSchema: {
        holdings: z.string().describe("e.g. '0.5 BTC, 3 ETH, 1000 USDT, 200000 BDT'"),
        currency: z.string().optional(),
      },
    },
    ({ holdings, currency }) =>
      user(
        `Value this portfolio in ${currency ?? "USD"} with portfolio_value: ${holdings}. Then get crypto_price for the crypto holdings ` +
          "to show 24h changes. Summarise total value, allocation percentages and concentration risk. This is information, not financial advice.",
      ),
  );
}
