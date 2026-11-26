# Handoff: put MUSICFY behind a login for the store

For the agent working on the store VPS. Read `FLEET.md` first; the machine's address
and user are in the private fleet note, not here. This is a hosting task: no
application code changes, no library changes, no settings changed beyond the ones named
here. If a step needs a decision from the owner, stop and ask.

## The machine

| | |
|---|---|
| host | the store VPS, ssh alias `mf-vps`; its address and user are in the private fleet note |
| code | `$HOME/.musicfy/app` (git checkout, current release) |
| data | `$HOME/.musicfy` (database, covers, audio under `$HOME/.musicfy/owned`) |
| process | PID file, `musicfy start|stop|restart|status`; **no systemd unit** |
| listen | `MUSICFY_BIND=127.0.0.1`, port `8710` |
| login | `MUSICFY_TOKEN` — not set today |

`export PATH="$HOME/.local/bin:$PATH"` before any `musicfy` command.

## Goal

The parents open a URL on a phone in the store, type one password, and get the player.
Nothing else is exposed. `8710` stays on localhost.

The full step-by-step is in the repository at `DOMAIN.md`; this handout is the agent's
checklist with the decisions already made.

Decisions:

1. **One shared password**, not per-user accounts. MUSICFY has no user table and is not
   multi-tenant.
2. **Caddy** terminates TLS and is the only public service (80/443).
3. A **subdomain** of a domain the owner controls, e.g. `music.example.com`.
4. **Listener mode** for the store: hides Prep, harmonic tools, BPM/key chips and the
   Rekordbox/Traktor/USB exports; keeps A&R, search, playlists, covers, metadata.
5. Do **not** open `8710`, do not use a self-signed certificate, do not put the password in
   a URL.

## Steps

1. **Back up first.** `musicfy backup`, then confirm a new directory under
   `~/.musicfy/backups/`.
2. **Password.**
   ```sh
   musicfy token --rotate        # prints the password once
   grep MUSICFY_TOKEN ~/.musicfy/musicfy.env
   ```
   Record it somewhere the owner can reach; do not paste it into the repo or a chat log.
3. **Bind stays local.** `MUSICFY_BIND=127.0.0.1`, then `musicfy restart`. Confirm:
   ```sh
   ss -ltnp | grep 8710     # 127.0.0.1:8710, never 0.0.0.0
   curl -fsS http://127.0.0.1:8710/ | head -3
   ```
4. **DNS.** At the registrar (Hostinger hPanel): `A music -> <server public IP>`, TTL 300. Add an
   `AAAA` **only** if the server answers on the IPv6 address; a stale AAAA makes the page
   hang before falling back. Verify with `dig +short A music.example.com`.
5. **Firewall.** Allow SSH, 80, 443; nothing else. `ufw status` must not list 8710.
6. **Caddy.**
   ```caddyfile
   music.example.com {
     encode zstd gzip
     reverse_proxy 127.0.0.1:8710 {
       header_up Host {host}
       header_up X-Forwarded-Proto {scheme}
       header_up X-Real-IP {remote_host}
     }
   }
   ```
   `caddy validate`, `systemctl reload caddy`, `systemctl status caddy`.
7. **Tell MUSICFY its origin.** `MUSICFY_ORIGINS=https://music.example.com` in
   `~/.musicfy/musicfy.env`, `musicfy restart`. This makes the login cookie `Secure` and lets
   state-changing requests through.
8. **Listener mode.** Settings → Mode → Listener. It is stored server-side, so every phone
   follows it.
9. **Verify from outside**, on mobile data, not the store Wi-Fi:
   - the URL loads over HTTPS and shows the login page;
   - the password works and the player loads;
   - `curl -m 5 http://<server public IP>:8710/health` times out or is refused;
   - Settings shows the version from `FLEET.md` and "up to date".
10. **Survive a reboot.** The app is a PID file, not a service. Either install the unit
    (`musicfy service install`) or confirm whatever starts it now is enabled; `caddy` must
    be enabled too.

## Do not

- Change the storefront country, timezone, city, library paths or A&R model.
- Run `musicfy update` as part of this task (that is `npm run deploy:all` from the owner's
  machine, and it must hit both hosts).
- Edit `web/` or `core/`.
- Leave the password in shell history on a shared account.

## Rollback

Remove the `MUSICFY_TOKEN` line and `musicfy restart` (login off, still localhost-only), or
stop Caddy. The library and database are untouched by this task.

---

# Feasibility: live "now playing", and an agent endpoint for A&R

Nothing here was implemented. This is what the code already supports and what each option
would cost.

## 1. Watching what is playing in the store

What exists today:

- `GET /api/diag/media` (since `0.1.38`) returns the last 120 media requests: track id, byte
  range, status, timing, user agent. Enough to see activity, not a real now-playing.
- `listens` table and `/api/stats` are history, not live.
- The player keeps position in the browser only; the server does not know it.

Options, cheapest first:

**A. Derive it from stream requests (no client change).** A "now playing" is the track with
a stream request in the last ~30 s for a given user agent / IP. One read-only endpoint,
token-protected, refreshed every few seconds. Accurate enough to see "someone is playing X";
cannot show pause or position, and a track already buffered may look silent. Cost: an
endpoint, no player change.

**B. Player heartbeat + server push (recommended if it should be truthful).** The player
posts `{trackId, position, paused}` every 10–15 s to `/api/now-playing`; the server keeps a
small map keyed by session and exposes `GET /api/now-playing` (JSON) and an SSE stream for a
live page. Shows title, artist, position, paused, and how many devices are listening. Cost:
~15 lines in the player, one endpoint, one small page; no database writes, no effect on
playback. Must be behind the same token.

**C. Full dashboard.** B adds a history sparkline from `listens` and per-device rows. Not
needed to answer "what is on right now".

A monitoring page is read-only. It should not be visible in Listener mode to customers unless
the owner wants it; put it behind a separate path or the token.

## 2. Connecting an agent such as Hermes to A&R

A&R already speaks one contract: an OpenAI-compatible `/v1/chat/completions` call that must
return JSON (`core/llm.js`, prompt in `core/agent.js`). Anything that speaks that contract
can be selected in Settings → Model endpoint today.

Three cases:

| Hermes exposes | What to do | Code change |
|---|---|---|
| an OpenAI-compatible HTTP endpoint | Settings: base URL + model, `http://127.0.0.1:PORT/v1` is allowed for a local service | none |
| a CLI, websocket or custom API | a small local bridge (Node, ~80 lines) that accepts `/v1/chat/completions` and calls Hermes; point Settings at the bridge | none in MUSICFY |
| an agent with tools and its own loop | same bridge first, with the A&R plan prompt as the system message. Tool-calling can come later; the planner needs a JSON plan, not a conversation | bridge only |

Constraints to check before promising it:

- **JSON discipline.** The planner requires `{"intent":…,"args":{…}}`. A free-form agent will
  fail the parse; the current code retries twice and falls back to the rules planner.
- **Latency.** A&R waits up to 45 s; a slow agent makes every draft feel slow.
- **Locality.** `http://` model endpoints are only accepted for localhost/LAN addresses, by
  design (the API key must not travel in clear text).
- **Isolation.** Hermes should not be able to change settings, delete tracks or trigger
  downloads on its own; today A&R only returns a proposal, and a human confirms it. Keep
  that boundary.

Recommended order: point Settings at Hermes (or its bridge) and run `npm run ar:check`
against the store. If 5/5 passes, the integration is done; if not, the failure is in the
model's JSON discipline, not in A&R.
