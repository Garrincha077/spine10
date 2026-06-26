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

## 1) Supabase (jednom, na tvom računalu)

> Claude Code web-sandbox ne smije do `api.supabase.com` (mrežna politika), pa ovo pokreni
> lokalno — skripta odradi sve: kreira projekt, primijeni shemu, napiše `config.js`.

```bash
git clone https://github.com/Garrincha077/spine10
cd spine10

export SUPABASE_ACCESS_TOKEN=sbp_xxx          # Supabase → Account → Access Tokens
node scripts/setup-supabase.mjs
```

Skripta: kreira projekt `asimetrija` → pričeka da bude zdrav → primijeni
`supabase/migrations/0001_init.sql` (tablice + RLS + realtime) → upiše `config.js`
(Project URL + anon key). Ispisat će i `project ref`.

Zatim napravi svoj jedini login-račun:
**Dashboard → Authentication → Users → Add user** (postavi lozinku, uključi *Auto Confirm User*).

> Alternativa bez skripte: napravi projekt u dashboardu, otvori **SQL Editor**, zalijepi
> sadržaj `supabase/migrations/0001_init.sql`, Run. Pa u `config.js` upiši Project URL + anon key
> (Project Settings → API).

## 2) Pokreni app

Otvori `index.html` (lokalno ili hostano — vidi *Deploy*). Prvi put: prijava (email+lozinka
iz koraka gore). Nakon toga plan i Dnevnik se sinkroniziraju na svim uređajima pod tim računom.
Indikator u vrhu: `sinkronizirano` = sve OK.

## 3) Žive kvote — MCP serveri (Claude Desktop)

Kopiraj `mcpServers` blok iz `claude_desktop_config.json.example` u svoj
`claude_desktop_config.json` i zamijeni placeholdere:

| server | čemu služi | ključ |
|---|---|---|
| `supabase` | Claude čita/piše Dnevnik + bazu | Supabase PAT + `project-ref` |
| `api-football` | forme, ozljede, rasporedi (npm `api-football-mcp`) | API-Football key |
| `asimetrija-odds` | žive kvote s **the-odds-api.com** (lokalni server iz `mcp/`) | The Odds API key |

Za `asimetrija-odds` (jedini lokalni server) instaliraj ovisnosti jednom:

```bash
cd mcp/odds-the-odds-api && npm install
```

…pa u configu stavi punu putanju do `server.mjs` (vidi primjer). Lokacija config-a:
macOS `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows `%APPDATA%\Claude\claude_desktop_config.json`,
Linux `~/.config/Claude/claude_desktop_config.json`.
**Potpuno ugasi i otvori Claude Desktop** → ikona čekića pokazuje alate.

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
