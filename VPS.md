# MUSICFY on a VPS

This is the short, safe route for a test install on a VPS. It assumes Ubuntu 22.04 or
24.04 and a user with `sudo`. Debian works the same way; adjust the package manager for
other distributions.

The recommended test setup is:

- MUSICFY listens only on `127.0.0.1` on the VPS.
- You reach it through an SSH tunnel from your own computer.
- Port 8710 is never opened to the internet.
- A token is set anyway.

Once you like it, add a domain and a reverse proxy (section 7).

---

## 1. Connect to the VPS

From your computer:

```sh
ssh your-user@YOUR_VPS_IP
```

Replace `your-user` and `YOUR_VPS_IP`. If you normally use a key file, add
`-i ~/.ssh/your-key`.

Do the rest of the commands **on the VPS**, in that SSH session.

---

## 2. Install the prerequisites

```sh
sudo apt update
sudo apt install -y curl git ffmpeg python3 python3-venv
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Check:

```sh
node -v
python3 --version
ffmpeg -version
```

`node -v` must be **v22.13.0 or higher**.

For a 1 GB VPS, audio analysis may run out of memory. 2 GB or more is comfortable. Playback
and downloads work on 1 GB.

---

## 3. Get the source onto the VPS

### Option A: upload the private test bundle (no GitHub account)

On **your computer**, from the folder that contains the bundle:

```sh
scp musicfy-test.tar.gz your-user@YOUR_VPS_IP:/tmp/
```

Then on the **VPS**:

```sh
mkdir -p ~/musicfy-install
tar -xzf /tmp/musicfy-test.tar.gz -C ~/musicfy-install --strip-components=1
cd ~/musicfy-install
```

### Option B: clone the private repository with a deploy key

On the VPS:

```sh
ssh-keygen -t ed25519 -C "musicfy-vps" -f ~/.ssh/musicfy_deploy -N ""
cat ~/.ssh/musicfy_deploy.pub
```

Copy the printed public key. In GitHub, open the repository → **Settings** → **Deploy
keys** → **Add deploy key**, paste it, leave **Allow write access** off, and save.

Then:

```sh
GIT_SSH_COMMAND="ssh -i ~/.ssh/musicfy_deploy" git clone git@github.com:theh4v0c/musicfy.git ~/musicfy-install
cd ~/musicfy-install
```

---

## 4. Testing the exact GitHub one-liner while the repo is private

The README command downloads `install.sh` from `raw.githubusercontent.com`. A private
repository returns 404 there, so the exact command cannot work until the repository is
public. There are two ways to evaluate it now.

### Option A: make the repository public for the test (truest)

This is the only way to test the exact copy-paste command from the README. The repository
contains no database, music, settings or tokens.

On your own computer, with the GitHub CLI logged in:

```sh
gh repo edit theh4v0c/musicfy --visibility public --accept-visibility-change-consequences
```

On the **VPS**, make sure the firewall blocks 8710 first. The installer binds to
`127.0.0.1` by default, but this makes it explicit:

```sh
sudo ufw allow OpenSSH
sudo ufw deny 8710/tcp
sudo ufw enable
```

Now follow the README exactly, including the prerequisites, then the one-liner:

```sh
curl -fsSL https://raw.githubusercontent.com/theh4v0c/musicfy/main/install.sh | sh
musicfy start
```

Reach it through the tunnel in section 6. When you are finished evaluating:

```sh
gh repo edit theh4v0c/musicfy --visibility private --accept-visibility-change-consequences
```

Testers who already viewed or forked the public repository may keep a copy. The source is
AGPL, so that is allowed, but do not leave the repository public if you did not mean to.

### Option B: rehearse with GitHub authentication (does not test the raw URL)

If you do not want to change visibility, use the GitHub CLI. This tests the installer and
the clone step, but not the `raw.githubusercontent.com` hop.

```sh
sudo apt install -y gh
gh auth login
gh auth setup-git
gh api repos/theh4v0c/musicfy/contents/install.sh --jq .content | base64 -d > /tmp/install.sh
sh /tmp/install.sh
```

`gh auth setup-git` makes the private `git clone` inside the installer use your account.
The missing piece is only the public raw download; everything after it is the real script.

## 5. Install with a local-only bind and a token

```sh
./install.sh --local --root ~/.musicfy --bind=127.0.0.1 --token
```

This creates `~/.musicfy`, the two Python environments, and `musicfy.env` with:

```
MUSICFY_BIND=127.0.0.1
MUSICFY_TOKEN=<a long random value>
```

Copy the token and the URL printed at the end. The token is also in
`~/.musicfy/musicfy.env`.

Wait 5 to 10 minutes for the Python packages.

---

## 6. Start it and check it locally

```sh
musicfy start
musicfy status
```

`status` should say `health ok`. Without the token, `/health` returns 401 by design. To test
with curl, use the token:

```sh
TOKEN=$(grep '^MUSICFY_TOKEN=' ~/.musicfy/musicfy.env | cut -d= -f2-)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8710/health
```

You should see `{"ok":true,...}`.

### Reach it from your own computer with an SSH tunnel

On **your computer** (not the VPS), leave this running:

```sh
ssh -N -L 8710:127.0.0.1:8710 your-user@YOUR_VPS_IP
```

Then open:

```
http://localhost:8710/?token=PASTE-YOUR-TOKEN
```

Replace the token with the one from `musicfy.env`. The first visit sets a cookie and
redirects to the clean URL.

If port 8710 is busy on your computer, use a different local port:

```sh
ssh -N -L 9000:127.0.0.1:8710 your-user@YOUR_VPS_IP
```

and open `http://localhost:9000`.

Press `Control + C` on the tunnel when you are done. The server on the VPS keeps running.

---

## 7. Optional: a real HTTPS URL

Do this only when you want to use the VPS from a phone or share it. You need a domain name
whose DNS **A record** points at the VPS IP.

Keep `MUSICFY_BIND=127.0.0.1`. Put a reverse proxy on the same VPS.

### Caddy (shortest)

Install Caddy from <https://caddyserver.com/docs/install> for your distribution, then edit
`/etc/caddy/Caddyfile`:

```caddyfile
music.example.com {
    reverse_proxy 127.0.0.1:8710
}
```

Reload:

```sh
sudo systemctl reload caddy
```

Caddy obtains and renews the TLS certificate automatically.

Add the public origin to the environment file, because the browser sends an `Origin` that
must match the proxy host:

```sh
echo 'MUSICFY_ORIGINS=https://music.example.com' >> ~/.musicfy/musicfy.env
musicfy restart
```

Open:

```
https://music.example.com/?token=PASTE-YOUR-TOKEN
```

### Firewall

Allow SSH, HTTP and HTTPS. Do **not** allow 8710 when the proxy is in use.

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

If you are not using a proxy, do not open 8710 just to test. Use the SSH tunnel. Opening
8710 directly exposes the app to the whole internet; the token helps, but HTTPS and a proxy
are the right shape for a public server.

---

## 8. Run it as a service

```sh
musicfy service install
```

Run that as your normal user, **not** with `sudo`. It writes `~/musicfy.service` and prints
the `sudo` commands to install it. Run those commands. On Ubuntu they are usually:

```sh
sudo cp ~/musicfy.service /etc/systemd/system/musicfy.service
sudo systemctl daemon-reload
sudo systemctl enable --now musicfy
```

From then on use systemd:

```sh
sudo systemctl status musicfy
sudo systemctl restart musicfy
sudo journalctl -u musicfy -f
```

**Do not mix the two managers.** `musicfy start/stop/status` manage a separate detached
process and its PID file. If the systemd service is installed, use `systemctl` for it.

The service reads `~/.musicfy/musicfy.env`. Keep that file mode 600.

---

## 9. Backups, updates and removal

Back up the database and settings:

```sh
musicfy backup
```

Update a test install from the folder you installed:

```sh
cd ~/musicfy-install
# replace with the new tarball or: git pull
./install.sh --local --root ~/.musicfy --bind=127.0.0.1
sudo systemctl restart musicfy
```

The install step copies the new source over `~/.musicfy/app`; your database, settings and
audio stay in `~/.musicfy`.

Remove everything:

```sh
sudo systemctl disable --now musicfy
rm -f ~/.local/bin/musicfy
rm -rf ~/.musicfy
```

That deletes the database, settings and uploaded audio under `~/.musicfy`. It does not
touch files elsewhere.

---

## 10. What to expect on a fresh VPS

- The first page is empty. Add music with **Library → Upload files**. There is no folder
  scanner yet.
- Uploaded files are copied to `~/.musicfy/owned` and count against the VPS disk.
- Analysis runs in the background; on a small VPS, start with a few tracks.
- `musicfy doctor` is the first command to run when something is missing.
- The service worker and offline playback need **HTTPS**. The SSH tunnel is `http://`, so
  playback works but offline install does not until you add the proxy.
