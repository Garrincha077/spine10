#!/usr/bin/env node
/*
 * ASIMETRIJA — The Odds API MCP server
 * Wraps the-odds-api.com v4 so Claude (desktop) can pull LIVE bookmaker odds
 * and turn them into ASIMETRIJA tickets. Reads the API key from env ODDS_API_KEY.
 *
 * Run:   ODDS_API_KEY=xxxx node server.mjs
 * Docs:  https://the-odds-api.com/liveapi/guides/v4/
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_KEY = process.env.ODDS_API_KEY;
const BASE = "https://api.the-odds-api.com/v4";

if (!API_KEY) console.error("[asimetrija-odds] WARNING: ODDS_API_KEY is not set — tools will return an error.");

function clean(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") r[k] = String(v);
  return r;
}

async function call(path, params = {}) {
  if (!API_KEY) return { error: "ODDS_API_KEY env var is not set in the MCP server config." };
  const usp = new URLSearchParams({ apiKey: API_KEY, ...clean(params) });
  const url = `${BASE}${path}?${usp.toString()}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return { error: `network error: ${e.message}` };
  }
  const quota = {
    remaining: res.headers.get("x-requests-remaining"),
    used: res.headers.get("x-requests-used"),
    last_cost: res.headers.get("x-requests-last"),
  };
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) return { error: `HTTP ${res.status}`, body, quota };
  return { data: body, quota };
}

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

const server = new McpServer({ name: "asimetrija-odds", version: "1.0.0" });

server.registerTool(
  "list_sports",
  {
    title: "List sports / leagues",
    description:
      "List the sports & leagues available on The Odds API. Use a returned `key` (e.g. soccer_fifa_world_cup, soccer_uefa_champs_league, soccer_epl) with get_odds. Set all=true to also include out-of-season leagues.",
    inputSchema: { all: z.boolean().optional().describe("include out-of-season leagues") },
  },
  async ({ all }) => ok(await call("/sports", { all: all ? "true" : "" }))
);

server.registerTool(
  "get_odds",
  {
    title: "Get live odds",
    description:
      "Live bookmaker odds for upcoming events in a sport/league. `sport` is a key from list_sports (default soccer_fifa_world_cup). markets: h2h (1X2 / moneyline), spreads, totals (comma-separated). regions: eu,uk,us,au. Returns decimal odds by default. Each call costs roughly (#markets × #regions) from your quota.",
    inputSchema: {
      sport: z.string().default("soccer_fifa_world_cup").describe("league key from list_sports"),
      regions: z.string().optional().describe("comma list: eu,uk,us,au (default eu)"),
      markets: z.string().optional().describe("comma list: h2h,spreads,totals (default h2h)"),
      oddsFormat: z.string().optional().describe("decimal | american (default decimal)"),
      bookmakers: z.string().optional().describe("comma list of bookmaker keys to limit to"),
    },
  },
  async ({ sport, regions, markets, oddsFormat, bookmakers }) =>
    ok(
      await call(`/sports/${sport}/odds`, {
        regions: regions || "eu",
        markets: markets || "h2h",
        oddsFormat: oddsFormat || "decimal",
        bookmakers,
      })
    )
);

server.registerTool(
  "get_events",
  {
    title: "List events (free)",
    description:
      "List upcoming events (fixtures) for a sport WITHOUT odds. Free — does not cost quota. Returns event ids you can pass to get_event_odds.",
    inputSchema: { sport: z.string().default("soccer_fifa_world_cup") },
  },
  async ({ sport }) => ok(await call(`/sports/${sport}/events`, {}))
);

server.registerTool(
  "get_event_odds",
  {
    title: "Get odds for one event",
    description:
      "Odds for a single event id (from get_events). Lets you request extra markets (e.g. player props) for just one match without paying for the whole slate.",
    inputSchema: {
      sport: z.string(),
      eventId: z.string().describe("event id from get_events"),
      regions: z.string().optional(),
      markets: z.string().optional(),
      oddsFormat: z.string().optional(),
    },
  },
  async ({ sport, eventId, regions, markets, oddsFormat }) =>
    ok(
      await call(`/sports/${sport}/events/${eventId}/odds`, {
        regions: regions || "eu",
        markets: markets || "h2h",
        oddsFormat: oddsFormat || "decimal",
      })
    )
);

server.registerTool(
  "get_scores",
  {
    title: "Get scores / results",
    description: "Live and recently-completed scores for a sport. daysFrom (1-3) includes finished games from the last N days.",
    inputSchema: {
      sport: z.string().default("soccer_fifa_world_cup"),
      daysFrom: z.number().int().min(1).max(3).optional(),
    },
  },
  async ({ sport, daysFrom }) => ok(await call(`/sports/${sport}/scores`, { daysFrom }))
);

await server.connect(new StdioServerTransport());
console.error("[asimetrija-odds] MCP server ready (the-odds-api.com)");
