# Put MUSICFY on a domain with HTTPS and a login

This is the setup for a shop, studio or home where other people use the player and the
server must not be exposed. Target shape:

```
browser -> https://music.example.com -> Caddy (HTTPS + login gate) -> 127.0.0.1:8710
```

MUSICFY stays bound to `127.0.0.1`. Only Caddy is reachable from outside, on 80 and 443.
Port 8710 is never opened.

## 1. You need

- A domain or subdomain, for example `music.example.com`.
- A public IPv4 address for the server, or a router that can forward ports 80 and 443 to it.
- The server running MUSICFY on `127.0.0.1:8710`.
- `sudo` on the server.

If your internet provider puts you behind CGNAT, or blocks ports 80/443, a direct domain
will not work. Use a VPN or an HTTPS tunnel instead of port forwarding.

## 2. Set the password and keep the bind local

On the server:

```sh
musicfy token --rotate
```

That prints a long password. This is the password for the login page; it is not a username.
If you want a phrase that is easier to type for staff, edit `~/.musicfy/musicfy.env` and set:

```ini
MUSICFY_TOKEN=the-long-password-the-store-will-use
```

Use at least 16 characters. Do not use the same password as anything else.

Make sure the bind is local:

```sh
grep MUSICFY_BIND ~/.musicfy/musicfy.env
```

It must say `MUSICFY_BIND=127.0.0.1`. Then:

```sh
musicfy restart
```

Open `http://127.0.0.1:8710/login` on the server with `curl` to check it answers:

```sh
curl -fsS http://127.0.0.1:8710/login | head -5
```

You should see HTML, not `unauthorized`.

## 3. Point the domain at the server

At your DNS provider, create an **A record**:

```
music.example.com  ->  YOUR_PUBLIC_IP
```

Wait until `dig +short music.example.com` (or `nslookup`) returns that IP. DNS can take a
few minutes.

## 4. Forward the ports

On the router in front of the server, forward:

- TCP **80** -> server port 80
- TCP **443** -> server port 443

Do **not** forward 8710.

If the server is a VPS with a public IP and a host firewall, allow only SSH, 80 and 443:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 5. Install Caddy and reverse-proxy MUSICFY

Caddy is open source and obtains the HTTPS certificate automatically.

Ubuntu/Debian:

```sh
sudo apt update
sudo apt install -y caddy
```

If that package is not available, use the instructions at
<https://caddyserver.com/docs/install>.

Edit `/etc/caddy/Caddyfile`:

```caddyfile
music.example.com {
    reverse_proxy 127.0.0.1:8710 {
        header_up Host {host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Reload:

```sh
sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy creates the certificate. The first request may take a few seconds.

Tell MUSICFY about the public origin:

```sh
echo 'MUSICFY_ORIGINS=https://music.example.com' >> ~/.musicfy/musicfy.env
musicfy restart
```

If MUSICFY runs as a systemd service:

```sh
sudo systemctl restart musicfy
```

## 6. Choose the store mode

In the browser, open **Settings → Mode** and choose **Listener** for a shop. It hides
Prep, A&R, harmonic tools, BPM/key chips and every Rekordbox/Traktor/USB export. Switch to
**DJ** only when someone is preparing a set.

## 7. Log in

Open:

```
https://music.example.com/
```

You should be redirected to the MUSICFY login page. Enter the password from step 2. The
cookie lasts one year on that browser, so staff do not log in every time.

Do not share a `?token=` URL. The login page is the intended flow; the query form remains
for scripts and API clients.

## 8. Test from outside

Turn off Wi-Fi on your phone and use mobile data. Open the domain and log in. If that works,
the shop Wi-Fi is not required and the server is reachable from the internet through Caddy
only.

Then check that 8710 is closed from outside:

```sh
curl -m 5 http://YOUR_PUBLIC_IP:8710/health
```

It should time out or be refused. If it answers, a firewall or port forward is wrong.

## 9. Make it survive a reboot

If MUSICFY is not already a service:

```sh
musicfy service install
```

Follow the printed commands, then:

```sh
sudo systemctl enable --now musicfy
sudo systemctl enable caddy
```

Check after a reboot:

```sh
systemctl is-active musicfy caddy
```

## 10. Backups

The domain does not back up the library. Run:

```sh
musicfy backup
```

and copy `~/.musicfy/backups` somewhere else. A shop computer's disk is not a backup.

## Troubleshooting

| Symptom | Check |
|---|---|
| Domain does not load | DNS A record, router port forward 80/443, `sudo systemctl status caddy` |
| Certificate warning | Caddy logs: `sudo journalctl -u caddy -n 80`; DNS must already point at the server |
| Login page loops | the cookie is not being stored; use HTTPS, not plain HTTP |
| 502 from Caddy | MUSICFY is not running: `musicfy status` or `sudo systemctl status musicfy` |
| Works on shop Wi-Fi, not mobile | port forwarding or ISP blocking; check 80/443 from outside |
| 8710 answers publicly | close it: firewall rule and remove the port forward |
