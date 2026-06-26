# ASIMETRIJA — MCP + Supabase

Konveksni planer sportskih akumulatora (barbell staze A–D, slagač parova, Monte Carlo,
**Dnevnik** listića) — sada **u oblaku** i spojen na **žive kvote preko MCP-a**.

```
[Odds MCP] + [API-Football MCP]  →  Claude (desktop) nađe value
                                          │  zapiše listić preko
                                          ▼
                                   [Supabase MCP]
                                          ▼
                                   ┌───────────────┐
                                   │  Supabase DB  │   privatno, samo ti (RLS)
                                   └───────────────┘
                                          ▲  supabase-js sync
                                   ┌───────────────┐
                                   │  index.html   │   ledger na svim uređajima
                                   └───────────────┘
```

- **`index.html`** — app. Cijela logika ostaje ista; sad sinkronizira plan u `app_state`
  i Dnevnik u tablicu `tickets`. `localStorage` ostaje offline cache. Bez Supabasea radi
  isto kao prije (lokalno).
- **`tickets`** čitaju i app i Claude na desktopu → "daj listić" u chatu se pojavi u app-u
  (uživo, preko Supabase realtime-a).
- **Privatnost:** jedan tvoj račun, login **jednom po uređaju** (session se pamti). RLS
  pušta samo vlasnika; anon key u `config.js` je javno-siguran (štiti ga RLS).

---

## 1) Sve odjednom — jedna naredba (na tvom računalu)

> Claude Code web-sandbox ne smije do `api.supabase.com` (mrežna politika org-a), pa ovo
> pokreni lokalno. Skripta odradi **sve**: projekt + shema + login-user + `config.js` +
> gotov `claude_desktop_config.json` (s tvojim ključevima).

```bash
git clone https://github.com/Garrincha077/spine10
cd spine10

export SUPABASE_ACCESS_TOKEN=sbp_xxx     # Supabase → Account → Access Tokens
export ODDS_API_KEY=xxxx                 # the-odds-api.com
export API_FOOTBALL_KEY=xxxx             # dashboard.api-football.com
# opcionalno: export LOGIN_EMAIL=you@example.com LOGIN_PASSWORD=tajna
node scripts/setup-supabase.mjs
```

Na kraju ispiše **login (email / lozinka)** i točan put do Claude config-a. Time je Supabase
gotov — bez diranja dashboarda i SQL-a.

> Bez skripte (ručno): projekt u dashboardu → **SQL Editor** → zalijepi
> `supabase/migrations/0001_init.sql` → Run; u `config.js` upiši URL + anon key
> (Project Settings → API); user u Authentication → Users (Auto Confirm).

## 2) Pokreni app

Otvori `index.html` (lokalno ili hostano — vidi *Deploy*). Prvi put: prijava (email+lozinka
iz koraka gore). Nakon toga plan i Dnevnik se sinkroniziraju na svim uređajima pod tim računom.
Indikator u vrhu: `sinkronizirano` = sve OK.

## 3) Žive kvote — MCP serveri (Claude Desktop)

Skripta iz koraka 1 je već napisala `claude_desktop_config.json` s tvojim ključevima i
ispravnim putanjama (3 servera: `supabase`, `api-football`, `asimetrija-odds`). Preostaje:

```bash
cd mcp/odds-the-odds-api && npm install      # jednom — lokalni odds server
```

…pa kopiraj config na lokaciju koju je skripta ispisala
(macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`,
Linux `~/.config/Claude/`) i **potpuno ugasi pa otvori Claude Desktop** → čekić pokaže alate.

| server | čemu služi | izvor |
|---|---|---|
| `supabase` | Claude čita/piše Dnevnik + bazu | `@supabase/mcp-server-supabase` |
| `api-football` | forme, ozljede, rasporedi | npm `api-football-mcp` |
| `asimetrija-odds` | žive kvote s **the-odds-api.com** | lokalni `mcp/odds-the-odds-api/` |

> Ručno (ako preskačeš skriptu): kopiraj `mcpServers` iz `claude_desktop_config.json.example`
> i zamijeni placeholdere (project-ref + 3 ključa + apsolutnu putanju do `server.mjs`).

> Zašto vlastiti odds-server? Postojeći npm `odds-api-mcp-server` koristi *odds-api.io*,
> a tvoj ključ je s *the-odds-api.com* — pa je u `mcp/odds-the-odds-api/` mali server koji
> radi baš s tvojim ključem (alati: `list_sports`, `get_odds`, `get_events`,
> `get_event_odds`, `get_scores`).

## 4) (Opcionalno) Žive kvote u samom app-u

`supabase/functions/odds/` je Edge proxy (drži The Odds API ključ na serveru):

```bash
supabase link --project-ref <ref>
supabase secrets set ODDS_API_KEY=xxxx
supabase functions deploy odds
```

## Deploy app-a (GitHub Pages)

`.github/workflows/pages.yml` je spreman. Repo **Settings → Pages → Source: GitHub Actions**.
App će biti na `https://garrincha077.github.io/spine10/`. (Anon key u `config.js` je OK javno —
RLS štiti podatke.)

---

## Sigurnost
- U git idu samo `*.example` + `config.js` (URL + anon key — javno-sigurni).
- **Nikad** ne commitaj: `.env`, pravi `claude_desktop_config.json`, service_role key.
- PAT (`sbp_…`) je moćan (cijeli račun). Ako je bio u chatu/negdje izložen — **rotiraj ga**
  (Account → Access Tokens → revoke + novi).

## Datoteke
```
index.html                          app + Supabase sync + login
config.js                           Project URL + anon key (placeholderi dok ne pokreneš setup)
supabase/migrations/0001_init.sql   app_state + tickets + RLS + realtime
supabase/functions/odds/            Edge proxy za žive kvote (opcionalno)
mcp/odds-the-odds-api/              lokalni MCP server za the-odds-api.com
scripts/setup-supabase.mjs          one-shot Supabase setup (kreira projekt + shema + config.js)
.mcp.json                           Supabase MCP za Claude Code u repou
claude_desktop_config.json.example  MCP blok za desktop (3 servera)
.env.example                        tokeni/ključevi (placeholderi)
```

*App je planer/evidencija, ne usluga klađenja. EV je strukturno negativan — cijena asimetrije.*
