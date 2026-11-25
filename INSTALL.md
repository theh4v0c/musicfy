# Installing MUSICFY

MUSICFY is a single-user, self-hosted music library and DJ-prep server. It runs on one box,
for one person; every path it uses comes from the environment, so a clone on another
machine finds its own data, audio and venvs. Below is what a fresh install needs, and the
honest distance between that and a public release.

---

## 1. Requirements

- **Node 22.13+** (`node:sqlite` is unflagged from 22.13; no npm dependencies).
- **Python 3.11+** with `librosa` in a venv (audio analysis).
- **ffmpeg**, **ffprobe**, **zip** on PATH.
- **yt-dlp** in a venv (the download/stream resolver).
- A place to keep audio (ideally a mount that is always present).

---

## 2. Configuration

There is no config file to edit. Every path comes from an environment variable, read once
at boot by `core/paths.js`; the defaults are the reference Pi's, so a second machine sets
the few it differs on and inherits the rest of the behaviour.

| variable | default | what it is |
|---|---|---|
| `MUSICFY_HOME` | `/opt/musicfy` | root for data, logs, backups, venvs |
| `MUSICFY_DATA` | `$MUSICFY_HOME/data` | database, settings, caches, covers |
| `MUSICFY_OWNED` | `$MUSICFY_HOME/owned` | the audio library (may be another mount) |
| `MUSICFY_DB` | `$MUSICFY_DATA/musicfy.db` | the SQLite file |
| `MUSICFY_BIN` | `$MUSICFY_HOME/ytdlp-venv/bin` | where the downloader lives |
| `MUSICFY_YTDLP` | `$MUSICFY_BIN/yt-dlp` | the downloader binary |
| `MUSICFY_PYTHON` | `$MUSICFY_HOME/essentia-venv/bin/python` | the analyser interpreter |
| `MUSICFY_FFMPEG` | found on `PATH` | ffmpeg |
| `MUSICFY_FFPROBE` | found on `PATH` | ffprobe |
| `MUSICFY_BACKUP_DIR` | `$MUSICFY_HOME/backups` | nightly snapshots |
| `MUSICFY_PORT` | `8710` | listen port |
| `MUSICFY_BIND` | `0.0.0.0` | listen address |

The LLM endpoint is not an env var: it lives in `data/settings.json` and is edited in
Settings → Model endpoint (section 4).

At boot the server prints what it resolved, and names anything missing:

```
[deps] ffmpeg /opt/homebrew/bin/ffmpeg
[deps] analyser /opt/musicfy/essentia-venv/bin/python
[deps] MISSING analyser interpreter … — create the venv or set MUSICFY_PYTHON
```

---

## 3. Install

The short route:

```sh
curl -fsSL https://raw.githubusercontent.com/theh4v0c/musicfy/main/install.sh | sh
musicfy start
```

or `npm i -g musicfy && musicfy setup --root ~/.musicfy && musicfy start`.

`install.sh` clones into `~/.musicfy/app`, runs `musicfy setup` (directories, venvs,
checks, `musicfy.env`) and links `~/.local/bin/musicfy`. It never uses sudo. Pass
`--root=DIR`, `--repo=URL`, `--ref=BRANCH` or `--skip-deps`.

The manual route, if you want to see every step:

```bash
git clone https://github.com/theh4v0c/musicfy && cd musicfy

# Node: no dependencies, Node 22.13+ (node:sqlite is unflagged there).
# Python: the analyser. The directory name matters, or set MUSICFY_PYTHON.
python3 -m venv essentia-venv
./essentia-venv/bin/pip install librosa numpy scipy

# yt-dlp, in its own venv (the default MUSICFY_BIN)
python3 -m venv ytdlp-venv
./ytdlp-venv/bin/pip install -U yt-dlp

# where the audio and the database live
export MUSICFY_HOME="$PWD"
export MUSICFY_OWNED="/path/to/your/music"

node core/core.js
```

The first boot creates `data/`, `logs/` and the schema, then serves on `:8710`. Nothing
has to be seeded.

### The CLI

| command | what it does |
|---|---|
| `musicfy setup` | dirs, venvs, `.env`, dependency check, URL |
| `musicfy serve` | foreground, the way a service runs it |
| `musicfy start/stop/restart/status` | detached process, PID file, `logs/musicfy.log` |
| `musicfy logs [-f]` | last 100 lines, or follow |
| `musicfy doctor` | Node, ffmpeg, yt-dlp, Python, DB integrity, HTTP, disk, token warning |
| `musicfy backup [--keep N]` | `VACUUM INTO` snapshot + settings/covers archive |
| `musicfy restore <snapshot.db>` | replace the database (stop first) |
| `musicfy token [--rotate]` | write or rotate `MUSICFY_TOKEN` |
| `musicfy service install` | systemd (Linux) or launchd (macOS) |
| `musicfy update` | git pull, then restart if running |

### systemd

```ini
[Unit]
Description=MUSICFY core
After=network-online.target

[Service]
WorkingDirectory=/opt/musicfy
ExecStart=/usr/bin/node --no-warnings /opt/musicfy/core/core.js
Environment=MUSICFY_HOME=/opt/musicfy
Environment=MUSICFY_OWNED=/media/yourdisk/musicfy/owned
Restart=always
Environment=MUSICFY_PORT=8710

[Install]
WantedBy=multi-user.target
```

### Docker (optional)

One image with Node 22, ffmpeg and a shared Python venv (yt-dlp + librosa), built from the
included `Dockerfile`:

```sh
docker build -t musicfy .
docker run -d --name musicfy -p 127.0.0.1:8710:8710 \
  -v musicfy-data:/data -v /path/to/music:/music musicfy
```

`/data` holds the database and settings; the Python venv is inside the image. `/music` is
the library root (`MUSICFY_OWNED`). The image runs as the `node` user, so the mounted music
directory must be readable by it. For a LAN install, publish `8710:8710` and set a token;
otherwise keep the `127.0.0.1` binding above.

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

**Security note:** there are no per-user accounts or password reset; authentication is one
optional shared token (`MUSICFY_TOKEN`). Do not expose the port to the internet without a
VPN or an authenticated proxy, and bind it to `127.0.0.1` if the proxy is on the same host.

---

## 5. Pointing at your own folders

- **Library audio:** `MUSICFY_OWNED`. New downloads land here.
- **Downloads root:** Settings → Downloads → "Download folder".
- **Existing library:** the DB is SQLite at `MUSICFY_DB`. To import an existing folder,
  the clean approach is a one-off scanner (not built yet) that walks the folder and inserts
  `tracks` + `files` rows. Today, audio enters via download or upload.

---

## 6. What a public release still has open

1. **Accounts** — a single-user token exists (`MUSICFY_TOKEN`), and `setup --token` creates
   one, but there is no per-user account or first-run password flow.
2. **A scanner for an existing folder** — so people do not have to re-upload their library.
3. **Platform matrix** — the analysis venv and yt-dlp are Linux/macOS; Windows has not been
   tested.
4. **Authentication is still opt-in** — the default install warns at boot when it listens
   on every interface without a token. Use `musicfy setup --token`, or bind to localhost
   behind a TLS proxy.

Packaging now ships `package.json`, `bin/musicfy.mjs`, `install.sh`, systemd/launchd
installers, a Dockerfile, LICENSE, SECURITY and CI for unit, design and boot smoke.

Paths, the schema-on-boot, the CDJ USB export (`export.pdb` + ANLZ) and the test suite are
done; see `MILESTONES.md`.

## Security switches (env)

- **`MUSICFY_TOKEN`** — set a shared secret and every request needs it. Visit
  `http://host:8710/?token=<secret>` once; the server sets an HttpOnly cookie and
  redirects to the clean URL. API clients can send `Authorization: Bearer <secret>`.
  Unset leaves the app open; only do that on a trusted LAN.
- **`MUSICFY_ORIGINS`** — comma-separated extra origins allowed to make writes
  (needed when a proxy rewrites `Host`, e.g. `https://musicfy.example.com`).
- **`MUSICFY_BIND`** — bind host, default `0.0.0.0`. Set `127.0.0.1` when a reverse proxy
  on the same machine is the only client; the server warns at boot when it is listening on
  every interface without a token.

## Where things live (env)

The complete table is in §2; it is the only list, so it cannot drift from itself.
Nothing in the code spells an absolute path. A second machine needs only those variables;
it inherits behaviour, not your paths.

Built-in defences: writes require a same-origin `Origin`; request bodies are capped
(4 MB, 64 MB uploads); the generic streamer refuses loopback/private/metadata URLs;
changing the LLM base URL clears the stored key.
