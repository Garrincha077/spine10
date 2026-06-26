#!/usr/bin/env node
/*
 * ASIMETRIJA — standalone setup (NO git, NO repo clone needed).
 *
 * One self-contained file. Run on YOUR machine (it reaches Supabase; the Claude
 * web sandbox can't). It:
 *   1. creates a Supabase project (free tier)
 *   2. applies the schema (inlined below) + RLS + realtime
 *   3. creates your single login user (auto-confirmed)
 *   4. writes config.js
 *   5. downloads index.html + the odds MCP server next to it
 *   6. writes claude_desktop_config.json
 *
 * Fill the 3 keys + login below (or set them as env vars), then:
 *   node setup-standalone.mjs
 */

// ---- EDIT THESE (or set as env vars) ----
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "YOUR_SUPABASE_PERSONAL_ACCESS_TOKEN";
const ODDS_API_KEY          = process.env.ODDS_API_KEY          || "YOUR_THE_ODDS_API_KEY";
const API_FOOTBALL_KEY      = process.env.API_FOOTBALL_KEY      || "YOUR_API_FOOTBALL_KEY";
const LOGIN_EMAIL           = process.env.LOGIN_EMAIL           || "owner@asimetrija.local";
const LOGIN_PASSWORD        = process.env.LOGIN_PASSWORD        || "Asimetrija-2026!";
const PROJECT_NAME          = process.env.PROJECT_NAME          || "asimetrija";
const REGION                = process.env.SUPABASE_REGION       || "eu-central-1";
const REPO_SHA              = "d464585a51b1180499ccc72e046b8500482d2d45";
// -----------------------------------------

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

const API = "https://api.supabase.com";
const RAW = `https://raw.githubusercontent.com/Garrincha077/spine10/${REPO_SHA}`;
const CWD = process.cwd();

const SQL = `
create table if not exists public.app_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
drop policy if exists "app_state owner read"   on public.app_state;
drop policy if exists "app_state owner write"  on public.app_state;
drop policy if exists "app_state owner modify" on public.app_state;
drop policy if exists "app_state owner delete" on public.app_state;
create policy "app_state owner read"   on public.app_state for select using (auth.uid() = user_id);
create policy "app_state owner write"  on public.app_state for insert with check (auth.uid() = user_id);
create policy "app_state owner modify" on public.app_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "app_state owner delete" on public.app_state for delete using (auth.uid() = user_id);
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch before update on public.app_state
  for each row execute function public.touch_updated_at();

create table if not exists public.tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  label      text        not null default '',
  lane       text        not null default 'A' check (lane in ('A','B','C','D')),
  stake      numeric     not null default 0,
  mult       numeric     not null default 0,
  pay        numeric     not null default 0,
  tp         numeric     not null default 0,
  status     text        not null default 'pending' check (status in ('pending','win','loss')),
  skimmed    boolean     not null default false,
  placed_on  date        not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists tickets_user_created_idx on public.tickets (user_id, created_at desc);
alter table public.tickets enable row level security;
drop policy if exists "tickets owner read"   on public.tickets;
drop policy if exists "tickets owner write"  on public.tickets;
drop policy if exists "tickets owner modify" on public.tickets;
drop policy if exists "tickets owner delete" on public.tickets;
create policy "tickets owner read"   on public.tickets for select using (auth.uid() = user_id);
create policy "tickets owner write"  on public.tickets for insert with check (auth.uid() = user_id);
create policy "tickets owner modify" on public.tickets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tickets owner delete" on public.tickets for delete using (auth.uid() = user_id);
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tickets')
  then execute 'alter publication supabase_realtime add table public.tickets'; end if;
end $$;
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(m) { console.error("\n✗ " + m); process.exit(1); }
function log(m) { console.log(m); }

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const t = await res.text(); let b; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  if (!res.ok) die(`${init.method || "GET"} ${path} → HTTP ${res.status}: ${typeof b === "string" ? b : JSON.stringify(b)}`);
  return b;
}
async function download(remote, local) {
  try {
    const res = await fetch(`${RAW}/${remote}`);
    if (!res.ok) { log(`  (preskačem ${remote}: HTTP ${res.status})`); return false; }
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(join(CWD, local)), { recursive: true });
    await writeFile(join(CWD, local), buf);
    log(`  ✓ ${local}`);
    return true;
  } catch (e) { log(`  (preskačem ${remote}: ${e.message})`); return false; }
}

async function main() {
  if (SUPABASE_ACCESS_TOKEN.startsWith("YOUR_")) die("Upiši SUPABASE_ACCESS_TOKEN na vrhu fajla.");
  log("ASIMETRIJA — setup");
  const orgs = await api("/v1/organizations");
  if (!orgs?.length) die("Nema organizacije na računu — napravi je na supabase.com pa ponovo.");
  log(`• Organizacija: ${orgs[0].name}`);
  log(`• Kreiram projekt "${PROJECT_NAME}" (${REGION}) …`);
  const proj = await api("/v1/projects", { method: "POST", body: JSON.stringify({ name: PROJECT_NAME, organization_id: orgs[0].id, region: REGION, db_pass: randomBytes(18).toString("base64url") }) });
  const ref = proj.id || proj.ref;
  log(`• Project ref: ${ref}`);

  log("• Čekam da projekt bude spreman (1–2 min) …");
  for (let i = 0; i < 60; i++) {
    const p = await api(`/v1/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") { log("• Spreman."); break; }
    if (i === 59) die(`Nije postao zdrav (status ${p.status}).`);
    process.stdout.write(`  status: ${p.status}    \r`);
    await sleep(5000);
  }

  log("• Primjenjujem shemu …");
  await api(`/v1/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query: SQL }) });
  log("• Shema OK (app_state + tickets + RLS + realtime).");

  const keys = await api(`/v1/projects/${ref}/api-keys?reveal=true`);
  const pick = (re) => keys.find?.((k) => re.test(k.name || "") || re.test(k.type || ""))?.api_key;
  const anon = pick(/^anon$/) || pick(/anon|publishable/i);
  const service = pick(/^service_role$/) || pick(/service_role|secret/i);
  if (!anon) die("Ne mogu pročitati anon key — uzmi ga iz Dashboard → API.");
  const url = `https://${ref}.supabase.co`;

  let loginMsg = "(preskačeno — dodaj usera u Dashboard → Authentication)";
  if (service) {
    const r = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD, email_confirm: true }) });
    if (r.ok) loginMsg = `${LOGIN_EMAIL} / ${LOGIN_PASSWORD}`;
    else if (r.status === 422) loginMsg = `${LOGIN_EMAIL} (već postoji, lozinka nepromijenjena)`;
    else loginMsg = `greška ${r.status} — dodaj usera ručno u Dashboard → Authentication`;
  }
  log(`• Login: ${loginMsg}`);

  await writeFile(join(CWD, "config.js"), `/* generated by setup-standalone.mjs — URL + anon key are public-safe (RLS protects data) */\nwindow.ASIM_CONFIG = {\n  url:     "${url}",\n  anonKey: "${anon}",\n};\n`);
  log("• Zapisao config.js");

  log("• Skidam app + odds-server …");
  await download("index.html", "index.html");
  await download("mcp/odds-the-odds-api/server.mjs", "mcp/odds-the-odds-api/server.mjs");
  await download("mcp/odds-the-odds-api/package.json", "mcp/odds-the-odds-api/package.json");

  const desktop = { mcpServers: {
    supabase: { command: "npx", args: ["-y", "@supabase/mcp-server-supabase@latest", `--project-ref=${ref}`], env: { SUPABASE_ACCESS_TOKEN } },
    "api-football": { command: "npx", args: ["-y", "api-football-mcp@latest"], env: { API_FOOTBALL_KEY } },
    "asimetrija-odds": { command: "node", args: [join(CWD, "mcp", "odds-the-odds-api", "server.mjs")], env: { ODDS_API_KEY } },
  } };
  await writeFile(join(CWD, "claude_desktop_config.json"), JSON.stringify(desktop, null, 2) + "\n");
  log("• Zapisao claude_desktop_config.json");

  log("\n✓ GOTOVO.");
  log(`  App   : dvoklik na index.html  → prijava: ${loginMsg}`);
  log(`  URL   : ${url}`);
  log("\n  Žive kvote u chatu (Claude Desktop):");
  log("    1) cd mcp/odds-the-odds-api  &&  npm install");
  log("    2) kopiraj claude_desktop_config.json u Claude config mapu pa restartaj Claude Desktop.");
}

main().catch((e) => die(e?.message || String(e)));
