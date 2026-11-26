# Fleet: the source of truth for hosts

Read this before touching a machine. It exists because two installs drifted once: the VPS
was updated, the Pi was not, and the version on screen disagreed with the release.

Addresses, hostnames and the owner's paths live in `backups/private-docs/FLEET.local.md`,
which is not tracked. This file is public and carries only roles and mechanisms.

## Hosts

| name | ssh | code root | data root | service | how it updates |
|---|---|---|---|---|---|
| VPS (store) | `mf-vps` (ssh alias, see the private note) | `$HOME/.musicfy/app` | `$HOME/.musicfy` | PID file, `musicfy` | `musicfy update` (git tag `main`) |
| Pi (home) | `plm` (ssh alias) | `/opt/musicfy` | `/opt/musicfy` (audio on an external mount) | `musicfy-core` systemd unit | rsync of the tree, then restart |

The VPS is a git checkout. The Pi is a bundle: its `package.json` is part of the deploy, and
that is what the app reports as its version.

## Ports on this Mac

| local | goes to | command |
|---|---|---|
| `localhost:8710` | the **Pi** | `ssh -f -N -L 8710:127.0.0.1:8710 plm` |
| `localhost:9200` | the **VPS** | `ssh -f -N -L 9200:127.0.0.1:8710 mf-vps` |

If a port answers nothing, the tunnel died, not the app. Check
`lsof -nP -iTCP:8710 -sTCP:LISTEN`, then restart the tunnel.

## Deploy

```sh
npm run deploy:all      # both hosts, then verifies version and / on each
npm run fleet:check     # read-only, exits 1 on drift
```

`deploy:all` uses `MUSICFY_PI_HOST`, `MUSICFY_VPS_HOST` and `MUSICFY_PI_DIR` when set.
It fails when a host does not answer with the version in this tree.

Rules:

1. **Both hosts, one command.** Never deploy one and call it done.
2. **Tag every release.** `package.json` version, `git tag`, push. A version with no tag is
   not a release and cannot be compared against anything.
3. **The asset version is automatic.** Since `0.1.55` the server rewrites `/app.js?v=…` to
   the running version and the service worker cache is `mf-shell-v6`; do not hand-edit `?v=`.
4. **Verify through the browser** on the port you actually use, with the service worker
   active. `curl` alone hid a stale client for three releases.
5. **Do not change instance settings without being asked**: token, bind, storefront country,
   listener/DJ mode, library paths. Those belong to the owner.

## Verifying

```sh
ssh mf-vps 'export PATH="$HOME/.local/bin:$PATH"; musicfy version'
ssh plm    'node -p "require(\"/opt/musicfy/package.json\").version"; systemctl is-active musicfy-core'
curl -s http://localhost:9200/api/settings | grep -o '"version":"[^"]*"'
curl -s http://localhost:8710/api/settings | grep -o '"version":"[^"]*"'
```

A host is healthy when `/` answers 200 in well under a second, `/api/settings` returns the
expected version, and `Settings` in the browser says **Em dia / Up to date**.

## When something hangs

- `ssh HOST` hanging on a command that ends with `curl …/` usually means the page is stuck,
  not ssh. Test `/health` first.
- The Pi's service: `ssh plm 'journalctl -u musicfy-core -n 40'`.
- The VPS's process: `ssh mf-vps 'tail -40 ~/.musicfy/logs/musicfy.log'`.
- A tunnel that dies: restart it with `ExitOnForwardFailure` and `ServerAliveInterval`.

## Current state

Both hosts run the version in `package.json` of this repository. `npm run fleet:check`
prints it and exits non-zero when they disagree.
