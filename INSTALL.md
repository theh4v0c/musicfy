# Installing MUSICFY

MUSICFY is a single-user, self-hosted music library and DJ-prep server. This is the honest
state: it runs on one box, for one person, and today several paths are hardcoded to the
reference Pi. Below is what works now, what must change before a stranger can `git clone`,
and how configuration is meant to look.

---

## 1. Requirements

- **Node 22** (uses `node:sqlite`, `node:http`, no npm dependencies).
- **Python 3.11+** with `librosa` in a venv (audio analysis).
- **ffmpeg**, **ffprobe**, **zip** on PATH.
- **yt-dlp** in a venv (the download/stream resolver).
- A place to keep audio (ideally a mount that is always present).

---

## 2. Configuration (the intended shape)

Today the app reads a few env vars but hardcodes the rest. The target is one config file,
`config.json`, next to `core/`, plus env overrides. Nothing secret is committed.

```json
{
  "root": "/opt/musicfy",
  "owned": "/srv/musicfy/owned",
  "db": "/opt/musicfy/data/musicfy.db",
  "port": 8710,
  "python": "/opt/musicfy/venv/bin/python",
  "ytdlp": "/opt/musicfy/ytdlp-venv/bin/yt-dlp",
  "wnl_url": "http://127.0.0.1:8742",
  "llm": { "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "api_key": "" }
}
```

The hardcoded constants to replace (all in `core/core.js`) are:

| constant | current | should be |
|---|---|---|
| `ROOT` | `/opt/musicfy` | `config.root` / `MUSICFY_ROOT` |
| `OWNED` | `/srv/music/owned` | `config.owned` / `MUSICFY_OWNED` |
| `DB_PATH` | `ROOT/data/musicfy.db` | `config.db` / `MUSICFY_DB` |
| `PORT` | `8710` | `MUSICFY_PORT` (already env) |
| `PY` (analyze.js) | `/opt/musicfy/essentia-venv/bin/python` | `config.python` |
| yt-dlp path | `/opt/musicfy/ytdlp-venv/bin/yt-dlp` | `config.ytdlp` |
| `WNL` | `http://wnl-host:8742` | optional `config.wnl_url` |

**This is the first refactor any public release needs.** It is mechanical: read the file
once at boot, fall back to env, fall back to defaults, and never hardcode `/opt` or `/media`.

---

## 3. Install (reference, once config is in place)

```bash
git clone https://github.com/<you>/MUSICFY && cd MUSICFY

# Node deps: none. Python deps:
python3 -m venv venv
./venv/bin/pip install librosa numpy

# yt-dlp:
python3 -m venv ytdlp-venv
./ytdlp-venv/bin/pip install -U yt-dlp

# config
cp config.example.json config.json   # edit root/owned/llm
mkdir -p "$(jq -r .owned config.json)"

# run
node core/core.js
```

### systemd

```ini
[Unit]
Description=MUSICFY core
After=network-online.target

[Service]
WorkingDirectory=/opt/musicfy
ExecStart=/usr/bin/node --no-warnings /opt/musicfy/core/core.js
Restart=always
Environment=MUSICFY_PORT=8710

[Install]
WantedBy=multi-user.target
```

### Docker (optional)

One image with Node 22, ffmpeg, and the two Python venvs; mount `owned/` and `data/` as
volumes; expose 8710 on localhost only.

---

## 4. Adding your own LLM

Two ways, both writing the same `settings.json`:

- **UI:** Settings → Model endpoint. Set **Base URL** (`https://api.openai.com/v1`,
  `http://localhost:11434/v1` for Ollama, any OpenAI-compatible server), **Model**, and
  **API key**. Leave the key blank to keep the stored one.
- **File:** `data/settings.json` → `llm_base_url`, `llm_model`, `llm_api_key`.

The Ask/Agent features use this endpoint only to parse a request into an intent; the
library query itself is deterministic (`core/query.js`). If the endpoint is unreachable,
everything still works with the local planner.

**Security note:** the current build has no app-layer auth. Do not expose the port to the
internet. Put it behind a VPN or an SSO proxy, and bind it to `127.0.0.1` if the proxy is
on the same host.

---

## 5. Pointing at your own folders

- **Library audio:** `owned/` in `config.json`. New downloads land here.
- **Downloads root:** Settings → Downloads → "Download folder".
- **Existing library:** the DB is SQLite at `config.db`. To import an existing folder, the
  clean approach is a one-off scanner (not built yet) that walks the folder and inserts
  `tracks` + `files` rows. Today, audio enters via download, upload, or the WNL ingest.

---

## 6. What a public release still needs

1. **Config refactor** (section 2) — remove hardcoded paths. *Blocking.*
2. **Auth / first-run setup** — a single-user token or a first-run admin password. *Blocking
   for anything beyond a private LAN.*
3. **A scanner for an existing folder** — so people do not have to re-download their library.
4. **DJ export is the import path** — the ZIP carries audio + `rekordbox.xml`/`traktor.nml`
   and is imported into Rekordbox/Traktor desktop. A true CDJ USB (PDB + ANLZ) is not built.
5. **Platform matrix** — the analysis venv and yt-dlp are Linux/macOS; Windows needs paths
   and possibly a different ffmpeg.
6. **Tests** — `bin/test.mjs` currently depends on a route that does not exist; fix before
   advertising CI.

None of this is hidden in the app; it is the honest distance between "works on my Pi" and
"anyone can install it".

---

## Security switches (env)

- **`MUSICFY_TOKEN`** — set a shared secret and every request needs it. Visit
  `http://host:8710/?token=<secret>` once; the server sets an HttpOnly cookie and
  redirects to the clean URL. API clients can send `Authorization: Bearer <secret>`.
  Unset = no auth (current LAN behaviour).
- **`MUSICFY_ORIGINS`** — comma-separated extra origins allowed to make writes
  (needed when a proxy rewrites `Host`, e.g. `https://musicfy.example.com`).
- **`MUSICFY_BIND`** — optional bind host; set `127.0.0.1` when a local reverse proxy
  is the only client.

Built-in defences: writes require a same-origin `Origin`; request bodies are capped
(4 MB, 64 MB uploads); the generic streamer refuses loopback/private/metadata URLs;
changing the LLM base URL clears the stored key.
