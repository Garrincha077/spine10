#!/usr/bin/env node
/*
 * ASIMETRIJA — one-command setup.
 *
 * Run this ON YOUR OWN MACHINE (not the Claude Code web sandbox, whose network
 * policy blocks api.supabase.com). With your Personal Access Token it:
 *   1. creates a Supabase project (or reuses SUPABASE_PROJECT_REF)
 *   2. waits until it's healthy
 *   3. applies supabase/migrations/0001_init.sql (tables + RLS + realtime)
 *   4. creates your single login user (so you don't touch the dashboard)
 *   5. writes config.js (Project URL + anon key)
 *   6. writes claude_desktop_config.json (gitignored) — ready to copy to Claude Desktop
 *
 * Minimal usage:
 *   export SUPABASE_ACCESS_TOKEN=sbp_xxx
 *   node scripts/setup-supabase.mjs
 *
 * Recommended (fills the desktop MCP config with your real keys too):
 *   export SUPABASE_ACCESS_TOKEN=sbp_xxx
 *   export ODDS_API_KEY=xxxx
 *   export API_FOOTBALL_KEY=xxxx
 *   export LOGIN_EMAIL=you@example.com         # optional (default owner@asimetrija.local)
 *   export LOGIN_PASSWORD=...                   # optional (auto-generated + printed)
 *   node scripts/setup-supabase.mjs
 *
 * Other optional env: SUPABASE_PROJECT_REF, SUPABASE_ORG_ID, PROJECT_NAME,
 *                     SUPABASE_REGION (default eu-central-1), SUPABASE_DB_PASSWORD
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir, platform } from "node:os";

const API = "https://api.supabase.com";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!TOKEN) die("Set SUPABASE_ACCESS_TOKEN (sbp_...) first. See .env.example.");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) { console.error("\n✗ " + msg); process.exit(1); }
function log(msg) { console.log(msg); }

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) die(`${init.method || "GET"} ${path} → HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

function claudeConfigPath() {
  const p = platform();
  if (p === "darwin") return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (p === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

async function main() {
  let ref = process.env.SUPABASE_PROJECT_REF;

  if (!ref) {
    let orgId = process.env.SUPABASE_ORG_ID;
    if (!orgId) {
      const orgs = await api("/v1/organizations");
      if (!orgs?.length) die("No organizations on this account. Create one in the Supabase dashboard first.");
      orgId = orgs[0].id;
      log(`• Using organization: ${orgs[0].name} (${orgId})`);
    }
    const name = process.env.PROJECT_NAME || "asimetrija";
    const region = process.env.SUPABASE_REGION || "eu-central-1";
    const dbPass = process.env.SUPABASE_DB_PASSWORD || randomBytes(18).toString("base64url");
    log(`• Creating project "${name}" in ${region} …`);
    const proj = await api("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name, organization_id: orgId, region, db_pass: dbPass, plan: "free" }),
    });
    ref = proj.id || proj.ref;
    log(`• Project ref: ${ref}`);
    if (!process.env.SUPABASE_DB_PASSWORD) log(`• Generated DB password (save it): ${dbPass}`);
  } else {
    log(`• Reusing existing project: ${ref}`);
  }

  // wait until healthy
  log("• Waiting for the project to become healthy (can take 1–2 min) …");
  for (let i = 0; i < 60; i++) {
    const p = await api(`/v1/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") { log("• Project is healthy."); break; }
    if (i === 59) die(`Project did not become healthy (last status: ${p.status}).`);
    process.stdout.write(`  status: ${p.status}\r`);
    await sleep(5000);
  }

  // apply migration
  log("• Applying migrations/0001_init.sql …");
  const sql = await readFile(join(ROOT, "supabase/migrations/0001_init.sql"), "utf8");
  await api(`/v1/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query: sql }) });
  log("• Schema applied (app_state + tickets + RLS + realtime).");

  // fetch keys
  log("• Reading API keys …");
  const keys = await api(`/v1/projects/${ref}/api-keys?reveal=true`);
  const pick = (re) => keys.find?.((k) => re.test(k.name || "") || re.test(k.type || ""))?.api_key;
  const anon = pick(/^anon$/) || pick(/anon|publishable/i);
  const service = pick(/^service_role$/) || pick(/service_role|secret/i);
  if (!anon) die("Could not read the anon key. Grab it from Dashboard → API Keys and edit config.js manually.");

  const url = `https://${ref}.supabase.co`;

  // create the single login user (so you never touch the dashboard)
  const loginEmail = process.env.LOGIN_EMAIL || "owner@asimetrija.local";
  const loginPass = process.env.LOGIN_PASSWORD || randomBytes(9).toString("base64url");
  let userMsg = "skipped (no service_role key)";
  if (service) {
    const r = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail, password: loginPass, email_confirm: true }),
    });
    if (r.ok) userMsg = `created ${loginEmail} / ${loginPass}`;
    else if (r.status === 422) userMsg = `${loginEmail} already exists (password unchanged)`;
    else userMsg = `could not create user (HTTP ${r.status}) — add one in Dashboard → Authentication`;
  }
  log(`• Login user: ${userMsg}`);

  // write config.js (public-safe)
  await writeFile(join(ROOT, "config.js"),
`/* Generated by scripts/setup-supabase.mjs — URL + anon key are public-safe (RLS protects data). */
window.ASIM_CONFIG = {
  url:     "${url}",
  anonKey: "${anon}",
};
`);
  log("• Wrote config.js");

  // write ready-to-copy desktop MCP config (gitignored)
  const oddsKey = process.env.ODDS_API_KEY || "YOUR_THE_ODDS_API_KEY";
  const footballKey = process.env.API_FOOTBALL_KEY || "YOUR_API_FOOTBALL_KEY";
  const serverPath = join(ROOT, "mcp", "odds-the-odds-api", "server.mjs");
  const desktop = {
    mcpServers: {
      supabase: { command: "npx", args: ["-y", "@supabase/mcp-server-supabase@latest", `--project-ref=${ref}`], env: { SUPABASE_ACCESS_TOKEN: TOKEN } },
      "api-football": { command: "npx", args: ["-y", "api-football-mcp@latest"], env: { API_FOOTBALL_KEY: footballKey } },
      "asimetrija-odds": { command: "node", args: [serverPath], env: { ODDS_API_KEY: oddsKey } },
    },
  };
  await writeFile(join(ROOT, "claude_desktop_config.json"), JSON.stringify(desktop, null, 2) + "\n");
  log("• Wrote claude_desktop_config.json (gitignored, with your real keys)");

  // done
  const target = claudeConfigPath();
  const copyCmd = platform() === "win32"
    ? `copy "${join(ROOT, "claude_desktop_config.json")}" "${target}"`
    : `mkdir -p "${dirname(target)}" && cp "${join(ROOT, "claude_desktop_config.json")}" "${target}"`;

  log("\n✓ All done.");
  log(`  Project URL : ${url}`);
  log(`  Login       : ${loginEmail} / ${loginPass}`);
  log("\nNext:");
  log("  1) Open index.html and sign in with the login above. Plan + journal now sync.");
  log("  2) Live odds in chat — install the local odds server once:");
  log(`        cd "${join(ROOT, "mcp", "odds-the-odds-api")}" && npm install`);
  log("     then copy the desktop config into place:");
  log(`        ${copyCmd}`);
  log("     and FULLY quit + reopen Claude Desktop (hammer icon shows the tools).");
  log("  3) (optional) Live odds inside the app:");
  log(`        supabase link --project-ref ${ref} && supabase secrets set ODDS_API_KEY=*** && supabase functions deploy odds`);
}

main().catch((e) => die(e?.message || String(e)));
