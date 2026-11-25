# Put MUSICFY on a domain with HTTPS and a login

The shape this guide builds:

```
browser → https://music.example.com → Caddy (HTTPS, certificate) → 127.0.0.1:8710
```

MUSICFY keeps listening on `127.0.0.1`. Only Caddy is reachable from the internet, on 80
and 443. Port 8710 is never opened.

There are no user accounts. The login is one shared password (`MUSICFY_TOKEN`) that every
person at the shop, studio or house types once per browser. That fits a store; it is not
multi-tenant software, so do not hand the password to customers.

If you do not want a domain, skip to [Without a domain](#without-a-domain-ssh-tunnel).

## 1. What you need

- A domain you control, for example `music.example.com` (a subdomain is enough).
- A server with a public IPv4 address, or a router that forwards ports 80 and 443 to it.
- MUSICFY installed and running: `musicfy status` says `running`.
- `sudo` on the server.

CGNAT or an ISP that blocks 80/443 breaks a direct domain. Use an HTTPS tunnel in that case;
the login and everything else stay the same.

Check the public address the world sees:

```sh
curl -4 -s https://ifconfig.me; echo
```

## 2. Keep MUSICFY on localhost

```sh
grep -E 'MUSICFY_(BIND|PORT|TOKEN)' ~/.musicfy/musicfy.env
```

Expected:

```ini
MUSICFY_PORT=8710
MUSICFY_BIND=127.0.0.1
MUSICFY_TOKEN=...
```

If the bind is `0.0.0.0`, change it to `127.0.0.1` and restart:

```sh
sed -i 's/^MUSICFY_BIND=.*/MUSICFY_BIND=127.0.0.1/' ~/.musicfy/musicfy.env
musicfy restart
```

Confirm the service is local:

```sh
ss -ltnp | grep 8710
```

It must show `127.0.0.1:8710`, never `0.0.0.0:8710` or `[::]:8710`.

## 3. Set the password

```sh
musicfy token --rotate
```

That prints a long random password. Use it as is, or replace it with a phrase staff can
type:

```sh
musicfy token          # shows the current one
```

To set your own, edit `~/.musicfy/musicfy.env`:

```ini
MUSICFY_TOKEN=uma-frase-longa-que-o-pessoal-da-loja-vai-digitar
```

At least 16 characters, nothing reused from another service. The file is written with mode
600. Then:

```sh
musicfy restart
curl -fsS http://127.0.0.1:8710/login | head -5
```

You should get HTML, not `unauthorized`. The login page is rate limited: repeated wrong
passwords from one address are delayed, so a script cannot guess it quickly.

Rotating the password logs out nobody immediately (the cookie is signed with the token, so
existing cookies stop matching). Rotate it if someone leaves or a phone is lost.

## 4. Point DNS at the server

At the registrar or DNS host — Hostinger, Cloudflare, Namecheap, whoever holds the zone —
create:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `music` | `YOUR_PUBLIC_IPV4` | 300 |
| AAAA | `music` | `YOUR_PUBLIC_IPV6` — only if the server really answers on it | 300 |

Hostinger's hPanel: **Domains → your domain → DNS / Nameservers → DNS records → Add
record**. Use the subdomain part only (`music`, not `music.example.com`). Leave the
nameservers at Hostinger unless you already moved them to Cloudflare.

Two rules that save an hour:

- **No AAAA record unless the server has a working IPv6 address.** A stale AAAA record
  makes browsers try an address that nothing answers on, and the page hangs before it
  falls back to IPv4.
- **Cloudflare proxy (orange cloud) is fine**, set SSL mode to **Full (strict)**. Do not
  use Flexible: it talks plain HTTP to Caddy and the login cookie's `Secure` flag then
  behaves unpredictably.

Verify before touching Caddy:

```sh
dig +short A music.example.com
dig +short AAAA music.example.com
```

The A answer must be your server's IPv4. The AAAA answer must either be empty or your
server's IPv6.

## 5. Open only 80, 443 and SSH

VPS with `ufw`:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Home router: forward TCP 80 → server:80 and TCP 443 → server:443. Never forward 8710.

## 6. Install Caddy

Caddy is open source and obtains and renews the certificate by itself.

```sh
sudo apt update && sudo apt install -y caddy
```

If the package is missing, use <https://caddyserver.com/docs/install>.

Edit `/etc/caddy/Caddyfile`:

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

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

The first HTTPS request can take a few seconds while the certificate is issued. Caddy needs
port 80 reachable for the ACME challenge.

## 7. Tell MUSICFY its public address

MUSICFY writes a `Secure` cookie when the request arrives over HTTPS and checks the origin
on state-changing requests, so it has to know the origin:

```sh
grep -q '^MUSICFY_ORIGINS=' ~/.musicfy/musicfy.env \
  || echo 'MUSICFY_ORIGINS=https://music.example.com' >> ~/.musicfy/musicfy.env
musicfy restart
```

If MUSICFY runs under systemd: `sudo systemctl restart musicfy`.

## 8. Log in and choose the mode

Open `https://music.example.com/`. You are redirected to the login page. Enter the password.
The cookie lasts a year on that browser.

Then **Settings → Mode**: choose **Listener** for a shop. It hides Prep, harmonic tools,
BPM/key chips and the Rekordbox/Traktor/USB exports, and leaves A&R, search, playlists,
covers and metadata. **DJ** shows everything.

The mode is stored on the server, so every browser follows it; a phone cannot switch the
shop back to DJ.

## 9. Verify from outside

On a phone with Wi-Fi off:

1. Open `https://music.example.com/` and log in.
2. Play a track.
3. Try `http://YOUR_PUBLIC_IP:8710/health` — it must time out or be refused.

If 8710 answers, a firewall rule or port forward is wrong. Close it before going further:
anyone who reaches it skips the login entirely unless `MUSICFY_TOKEN` is set, and even then
the port should not be public.

Check the certificate:

```sh
curl -sSI https://music.example.com/ | head -3
```

## 10. Survive a reboot

```sh
musicfy service install      # prints the commands for this host
sudo systemctl enable --now musicfy
sudo systemctl enable caddy
```

After a reboot:

```sh
systemctl is-active musicfy caddy
```

## 11. Backups and updates

HTTPS does not back anything up.

```sh
musicfy backup
```

Copy `~/.musicfy/backups` somewhere off the machine. A shop PC's disk is not a backup.

Update:

```sh
musicfy update      # pulls, then restarts; prints the version
musicfy version
```

## Without a domain: SSH tunnel

No DNS, no certificate, no open ports. From the laptop that needs access:

```sh
ssh -N -L 8710:127.0.0.1:8710 root@YOUR_SERVER
```

Then open <http://127.0.0.1:8710/> on the laptop. The login page still applies, and nothing
is exposed. This is the safest option for one or two people.

## Troubleshooting

| Symptom | Check |
|---|---|
| Domain does not load | `dig +short A music.example.com`; port 80/443; `systemctl status caddy` |
| Hangs, then loads slowly | stale **AAAA** record pointing at an IPv6 that does not answer |
| Certificate warning | Caddy logs: `journalctl -u caddy -n 80` — DNS must already resolve to this server |
| Cloudflare 522/525 | SSL mode must be **Full (strict)**; Caddy must answer on 443 |
| 502 from Caddy | MUSICFY is down: `musicfy status` |
| Login page reloads forever | cookie not stored: use HTTPS, not `http://IP`; check `MUSICFY_ORIGINS` |
| `unauthorized` on every request | `MUSICFY_TOKEN` changed; log in again |
| Slow or refused logins | rate limit after wrong passwords; wait a minute |
| Works on shop Wi-Fi only | port forwarding or ISP blocking; test on mobile data |
| 8710 answers publicly | close the port; set `MUSICFY_BIND=127.0.0.1` |
| Downloads fail after the move | unrelated to HTTPS: `musicfy netcheck` (see INSTALL.md) |
