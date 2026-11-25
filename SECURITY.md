# Security

MUSICFY is a single-user server. It holds your library, your listening history and,
optionally, an API key for a model endpoint. Treat it like a private service, not a public
website.

## Supported versions

Security fixes land on the latest release line. This is a young project; there are no
backports to older tags.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

<https://github.com/theh4v0c/musicfy/security/advisories/new>

Do not open a public issue for anything that can read files, write files, bypass the
token or reach an internal address. Include the version (`musicfy version`), the platform,
and the smallest request or steps that reproduce it. You will get an acknowledgement, a
fix or a documented reason, and credit if you want it.

## Secrets

These files contain secrets and are ignored by git:

| file | contents |
|---|---|
| `musicfy.env` | `MUSICFY_TOKEN` and install paths |
| `data/settings.json` | model endpoint URL, model name, API key |
| `data/llm.json` | legacy/alternate model configuration |
| `data/soundcloud.json`, `data/sc-client.json` | SoundCloud credentials |
| `backups/*` | copies of the database and the files above |

`musicfy.env` is written with mode 600. Never commit it, paste it into an issue, or put it
in a Docker image. Rotate a leaked token with `musicfy token --rotate` and restart.

## Exposing it

- Default install listens on `0.0.0.0` so a phone on the same network can reach it.
- Set `MUSICFY_TOKEN` (`musicfy setup --token`, or `musicfy token --rotate`) before doing
  that. Every request then needs the cookie set by `/?token=…` or
  `Authorization: Bearer …`.
- Better: bind to `127.0.0.1` and put a TLS reverse proxy or VPN in front. HTTPS is also
  required for the service worker and offline playback on iOS.
- Do not port-forward it directly to the internet. There is no per-user account system,
  no password reset, and no rate limit designed for hostile traffic.

Settings and the SQLite database are readable by the operating-system user that runs the
service. Run it as a dedicated user, not as root.

## Dependencies

The Node service has no npm dependencies. It invokes `ffmpeg`, `ffprobe`, `yt-dlp` and a
Python environment with `librosa`; keep those updated through the operating system and
`musicfy update`. `yt-dlp` in particular needs frequent updates as sites change.

## Scope

Out of scope: a hostile user with local shell access, a compromised reverse proxy, and
denial of service against a single-user install. In scope: remote file read/write, token
bypass, command injection through metadata or filenames, SSRF through download/stream
URLs, and secrets leaking into logs.
