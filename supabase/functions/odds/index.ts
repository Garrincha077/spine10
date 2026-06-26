// ASIMETRIJA — Edge Function: live-odds proxy for the web app.
//
// Keeps the The Odds API key server-side (Supabase secret ODDS_API_KEY) so the
// browser never sees it. Requires a logged-in user (verify_jwt = true in config.toml),
// so only you can spend your quota.
//
// Deploy:  supabase functions deploy odds
// Secret:  supabase secrets set ODDS_API_KEY=xxxxxxxx
// Call:    GET <project>.functions.supabase.co/odds?sport=soccer_fifa_world_cup&markets=h2h&regions=eu
//
import { corsHeaders } from "../_shared/cors.ts";

const BASE = "https://api.the-odds-api.com/v4";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const key = Deno.env.get("ODDS_API_KEY");
  if (!key) {
    return json({ error: "ODDS_API_KEY secret not set on the project" }, 500);
  }

  const u = new URL(req.url);
  const sport = u.searchParams.get("sport") ?? "soccer_fifa_world_cup";
  const regions = u.searchParams.get("regions") ?? "eu";
  const markets = u.searchParams.get("markets") ?? "h2h";
  const oddsFormat = u.searchParams.get("oddsFormat") ?? "decimal";

  const params = new URLSearchParams({ apiKey: key, regions, markets, oddsFormat });
  const target = `${BASE}/sports/${encodeURIComponent(sport)}/odds?${params}`;

  try {
    const res = await fetch(target);
    const remaining = res.headers.get("x-requests-remaining");
    const used = res.headers.get("x-requests-used");
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "x-requests-remaining": remaining ?? "",
        "x-requests-used": used ?? "",
      },
    });
  } catch (e) {
    return json({ error: `upstream error: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
