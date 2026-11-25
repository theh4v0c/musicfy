# Installing MUSICFY

MUSICFY is a music library that runs on a computer you own. You use it in a web browser on
the same computer, or on your phone over your home network. It does not need an account,
a subscription or a cloud service.

This guide assumes you have never used a terminal. Do the steps in order. Copy one block
at a time, paste it, press Enter, and wait for it to finish before moving on.

If you only want the shortest path and your computer is a Mac or Linux, the
[README quick start](README.md#install) is four steps. This file explains every step and
what to do when something fails.

---

## 1. Check you have the right computer

MUSICFY runs on a computer, not on a phone or tablet. The phone is only a browser you use
to reach the computer.

| Your computer | What to do |
|---|---|
| **macOS 13+** (Apple Silicon or Intel) | Follow **Mac** below. |
| **64-bit Linux** (Debian, Ubuntu, Mint, Pop!_OS, Fedora, Arch and similar) | Follow **Linux** below. |
| **Windows 10 or 11** | Follow **Windows** below. Native Windows is not supported; use Docker Desktop or WSL2. |
| **NAS / home server** | Follow **Docker** below if it can run Linux containers. |
| **Phone or tablet** | Do not install the server here. Open the address of the computer that runs it. |

You need a **64-bit** machine. MUSICFY also needs:

- **Node.js 22.13 or newer**
- **Python 3.10 or newer** with `python3-venv`
- **ffmpeg** and **ffprobe**
- **yt-dlp** (for downloads and streaming from the web)
- About **2 GB free** for the program, Python packages and database. Your music needs its
  own space.

The installer creates two Python environments under `~/.musicfy`:

- `ytdlp-venv` for downloading
- `essentia-venv` for audio analysis (BPM, key, loudness)

It does **not** install ffmpeg or Node. Those come from your operating system.

---

## 2. Words used in this guide

- **Terminal**: the black window where you type commands. On macOS it is called Terminal.
  On Windows it is PowerShell.
- **Command**: a line of text you paste into the terminal and run with Enter.
- **`~`**: your home folder. On macOS this is `/Users/yourname`; on Linux
  `/home/yourname`.
- **`localhost`**: this computer. `http://localhost:8710` means "port 8710 on the machine
  you are sitting at".
- **Port**: a numbered door on the computer. MUSICFY uses door `8710` by default.
- **Copy and paste**: select the text with the mouse, press `Command + C` on macOS or
  `Control + C` on Linux/Windows, click the terminal, then press `Command + V` or
  `Control + V`. Press Enter to run a command.

---

## 3. Mac

### 3.1 Open Terminal

Press `Command + Space`, type `Terminal`, and press Enter. A window with a prompt appears.

### 3.2 Install the helper programs

MUSICFY uses Homebrew to install Node, Python and ffmpeg. Check whether Homebrew is
already installed:

```sh
brew --version
```

If that prints a version, skip to the next block. If it says `command not found`, install
Homebrew first:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Homebrew may ask for your password. It is the same password you use to unlock the Mac.
When it finishes, it prints two commands to add Homebrew to your PATH; run the two lines
it shows, then close and reopen Terminal.

Now install the helpers:

```sh
brew install node ffmpeg python git
```

This can take several minutes. When it returns to the prompt, continue.

### 3.3 Check the versions

Run each line. You should see a version number for each.

```sh
node -v
python3 --version
ffmpeg -version
```

`node -v` must print **v22.13.0 or higher**. If it prints an older version, run
`brew upgrade node` and check again.

### 3.4 Install MUSICFY

Paste this whole line and press Enter:

```sh
curl -fsSL https://raw.githubusercontent.com/theh4v0c/musicfy/main/install.sh | sh
```

What this does:

1. downloads the MUSICFY source into `~/.musicfy/app`
2. runs `musicfy setup`, which creates `~/.musicfy` for your data and the two Python
   environments
3. links the `musicfy` command into `~/.local/bin`

It can take 5 to 10 minutes because it downloads Python packages. **Leave the window
open.** When it finishes you should see a line like:

```
MUSICFY is at http://localhost:8710
```

### 3.5 Start MUSICFY

```sh
musicfy start
```

You should see:

```
Started  pid 12345 · http://localhost:8710
```

The terminal can now be closed; the server keeps running in the background. To stop it
later, run `musicfy stop`.

If you see `musicfy: command not found`, close Terminal, open it again, and run
`musicfy start`. If it still fails, run this once and try again:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

### 3.6 Open it

Open <http://localhost:8710> in Safari, Chrome, Firefox or Edge. The first page is Home.
The first start creates the database automatically.

### 3.7 Add music

Open **Library** in the left sidebar. Use **Upload files** or **Upload a folder**. At the
moment there is no scanner for an existing music folder; files have to be uploaded through
the app. Uploaded files are copied into `~/.musicfy/owned`.

### 3.8 Make it start automatically (optional)

If you want MUSICFY to come back after a restart:

```sh
musicfy service install
```

On macOS this writes a launchd job. On Linux this writes a systemd unit. Run it as your
normal user, not with `sudo`; it prints the `sudo` command if it cannot install it itself.

### 3.9 Use it from your phone (optional)

Your phone must be on the same Wi-Fi as the computer. The installer binds MUSICFY to the
computer only; the first command below opens it to your home network.

1. Allow other devices on your network, then set a token:

   ```sh
   musicfy setup --root ~/.musicfy --bind=0.0.0.0
   musicfy token --rotate
   ```

   The token is printed once. Copy it somewhere safe.

2. Find the computer's local address:

   macOS:

   ```sh
   ipconfig getifaddr en0
   ```

   Linux:

   ```sh
   hostname -I
   ```

   It prints something like `192.168.1.50`.

3. Restart and open the address on the phone:

   ```sh
   musicfy restart
   ```

   On the phone, open `http://192.168.1.50:8710/`. Replace the address with the one from
   step 2 and enter the token on the login page.

If the phone cannot connect, check that both devices are on the same Wi-Fi and that the
computer's firewall allows port 8710. Plain `http://` on the LAN is enough for browsing;
offline playback and "install app" need HTTPS (a reverse proxy or VPN).

---

## 4. Linux

These commands are for **Debian, Ubuntu, Mint, Pop!_OS** and similar. For Fedora or Arch,
see the notes after the block.

### 4.1 Open Terminal

Press `Control + Alt + T`. If that does nothing, open your applications menu and search
for **Terminal**.

### 4.2 Install the helper programs

Copy this whole block, paste it, and press Enter:

```sh
sudo apt update
sudo apt install -y curl git ffmpeg python3 python3-venv
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

`sudo` asks for your login password. You will not see dots while typing; that is normal.

**Fedora:**

```sh
sudo dnf install -y curl git ffmpeg python3 nodejs
```

If `node -v` is below 22.13 after this, install Node 22 from
<https://nodejs.org/en/download> or use NodeSource for RPM-based systems.

**Arch:**

```sh
sudo pacman -S --needed curl git ffmpeg python nodejs npm
```

### 4.3 Check the versions

```sh
node -v
python3 --version
ffmpeg -version
```

`node -v` must be **v22.13.0 or higher**.

### 4.4 Install MUSICFY

```sh
curl -fsSL https://raw.githubusercontent.com/theh4v0c/musicfy/main/install.sh | sh
```

Wait until it prints `MUSICFY is at http://localhost:8710`. The Python step takes several
minutes.

### 4.5 Start it

```sh
musicfy start
```

You should see `Started pid ...` and `http://localhost:8710`. The terminal can be closed.
To stop it later, run `musicfy stop`.

If `musicfy` is not found, close the terminal, open it again, and run `musicfy start`.
Alternatively:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

### 4.6 Open it, add music, optional service

Open <http://localhost:8710>, then follow **3.6**, **3.7**, **3.8** and **3.9** above. The
commands are the same on Linux.

---

## 5. Windows

Native Windows is not supported because MUSICFY expects Unix-style Python environments
and ffmpeg. There are two working routes.

### Windows option A: Docker Desktop (recommended)

1. Install **Docker Desktop** from <https://www.docker.com/products/docker-desktop/>.
   Restart the computer when it asks.
2. Open the Start menu, type `PowerShell`, and open **Windows PowerShell**.
3. Download the project. The easiest way without Git:
   - open <https://github.com/theh4v0c/musicfy>
   - click the green **Code** button
   - click **Download ZIP**
   - extract the ZIP, then rename or move the extracted folder so the path is
     `C:\musicfy` (that folder must contain `package.json`)
4. In PowerShell, go to that folder:

   ```powershell
   cd C:\musicfy
   ```

5. Build the image. This downloads Node, ffmpeg and Python packages and can take
   10 minutes or more:

   ```powershell
   docker build -t musicfy .
   ```

6. Make a folder for your music, for example `C:\music`, then start the container:

   ```powershell
   docker run -d --name musicfy -p 8710:8710 -v musicfy-data:/data -v C:\music:/music musicfy
   ```

7. Open <http://localhost:8710>.

Useful Docker commands:

```powershell
docker logs musicfy
docker stop musicfy
docker start musicfy
docker rm -f musicfy
```

If port 8710 is busy, change the first number: `-p 8711:8710`, then open
<http://localhost:8711>.

On a home network, add a token so other devices must authenticate. Replace
`replace-with-a-long-random-text` with a long phrase only you know:

```powershell
docker rm -f musicfy
docker run -d --name musicfy -p 8710:8710 -v musicfy-data:/data -v C:\music:/music -e MUSICFY_TOKEN=replace-with-a-long-random-text musicfy
```

### Windows option B: WSL2

1. Install WSL2 and Ubuntu from the Microsoft Store or with `wsl --install` in PowerShell.
2. Open the Ubuntu app.
3. Follow the **Linux** steps above inside Ubuntu.

The files inside WSL2 are separate from `C:\`; use the Ubuntu home folder for
`~/.musicfy`.

---

## 6. Docker on Linux or macOS

```sh
git clone https://github.com/theh4v0c/musicfy.git
cd musicfy
docker build -t musicfy .
docker run -d --name musicfy -p 127.0.0.1:8710:8710 \
  -v musicfy-data:/data -v "$HOME/Music":/music musicfy
```

Open <http://localhost:8710>. The image runs as the `node` user; the music folder must be
readable by it. For access from another device, publish `8710:8710` instead of
`127.0.0.1:8710:8710` and set `MUSICFY_TOKEN`.

There is no prebuilt image on Docker Hub yet; the `docker build` step builds it locally.

---

## 7. If something goes wrong

First run:

```sh
musicfy doctor
```

It prints a line for Node, ffmpeg, yt-dlp, the analyser, the database, HTTP and disk, and
tells you which one failed.

`musicfy setup` creates `yt-dlp-musicfy`, a wrapper that runs yt-dlp with the installed
Node runtime and the open-source EJS challenge solver. `musicfy update` creates the same
wrapper for an existing install. If you upgraded from an older build, run
`musicfy setup --root "$HOME/.musicfy" --skip-deps` once.

| What you see | What it means | What to do |
|---|---|---|
| `musicfy: command not found` | `~/.local/bin` is not in your PATH | `export PATH="$HOME/.local/bin:$PATH"`, or close and reopen Terminal |
| `Failed to start` | the server could not stay up | `musicfy logs`, then `musicfy doctor` |
| `EADDRINUSE` or "port in use" | another program uses 8710 | `musicfy start --port=8711`; open <http://localhost:8711> |
| `ffmpeg` or `ffprobe` missing | the helper is not installed | install it (section 3.2 or 4.2), then `musicfy doctor` |
| `yt-dlp` missing | downloads will not work | run `musicfy setup` again without `--skip-deps` |
| analyser missing | BPM/key analysis will not run | run `musicfy setup` again; it creates `essentia-venv` |
| Permission denied on a music folder | the user cannot read that folder | move the files to a folder you own, or fix permissions |
| Phone cannot reach it | different network, firewall, or wrong address | use the computer's LAN IP, the same Wi-Fi, and allow port 8710 |
| Page loads but is empty | no music has been added | Library → **Upload files** |
| Old interface after an update | the browser cached the old files | hard reload (`Command + Shift + R` or `Control + Shift + R`) |

Logs live in `~/.musicfy/logs/musicfy.log`:

```sh
musicfy logs
musicfy logs -f
```

`-f` follows new lines; press `Control + C` to stop following.

---

## 8. Updating and removing

### Update

Take a backup first:

```sh
musicfy backup
```

Then, if you installed with `install.sh`:

```sh
musicfy update
```

`musicfy update` runs `git pull` in `~/.musicfy/app`. If the repository is private,
configure a read-only GitHub deploy key on that machine first, or the pull will fail. If
MUSICFY runs as a systemd service, the command prints the restart line:
`sudo systemctl restart musicfy`.

Settings also shows the installed version and **Check for updates**. **Update now** pulls
the code, but the running process keeps the old version until MUSICFY is restarted. The
footer prints the restart command for the way it is running.

If you installed with npm:

```sh
npm i -g musicfy@latest
musicfy restart
```

If you use Docker, download the new source and run `docker build` and `docker run` again.
The `musicfy-data` volume keeps your database.

### Remove

```sh
musicfy service uninstall
musicfy stop
rm -rf ~/.musicfy
rm -f ~/.local/bin/musicfy
```

**This deletes the database, settings and uploaded audio inside `~/.musicfy`.** If
`MUSICFY_OWNED` points at another folder, that music is separate and is not removed by
this command. Keep a `musicfy backup` first if you might return.

Docker:

```sh
docker rm -f musicfy
docker volume rm musicfy-data
```

Your music in `C:\music` or `~/Music` is not touched.

---

## 9. Advanced: manual install, settings and services

<details>
<summary>Show the manual route and every environment variable</summary>

### Manual install

```sh
git clone https://github.com/theh4v0c/musicfy.git
cd musicfy

python3 -m venv essentia-venv
./essentia-venv/bin/pip install librosa numpy scipy

python3 -m venv ytdlp-venv
./ytdlp-venv/bin/pip install -U yt-dlp

export MUSICFY_HOME="$PWD"
export MUSICFY_OWNED="/path/to/your/music"
node core/core.js
```

The first boot creates `data/`, `logs/` and the schema. Nothing has to be seeded.

### Environment variables

| variable | default | what it is |
|---|---|---|
| `MUSICFY_HOME` | `/opt/musicfy` | root for data, logs, backups, venvs |
| `MUSICFY_DATA` | `$MUSICFY_HOME/data` | database, settings, caches, covers |
| `MUSICFY_OWNED` | `$MUSICFY_HOME/owned` | the audio library (may be another mount) |
| `MUSICFY_DB` | `$MUSICFY_DATA/musicfy.db` | the SQLite file |
| `MUSICFY_BIN` | `$MUSICFY_HOME/ytdlp-venv/bin` | where the downloader lives |
| `MUSICFY_YTDLP` | `$MUSICFY_BIN/yt-dlp-musicfy` after setup, otherwise `$MUSICFY_BIN/yt-dlp` | the downloader wrapper |
| `MUSICFY_PYTHON` | `$MUSICFY_HOME/essentia-venv/bin/python` | the analyser interpreter |
| `MUSICFY_FFMPEG` | found on `PATH` | ffmpeg |
| `MUSICFY_FFPROBE` | found on `PATH` | ffprobe |
| `MUSICFY_BACKUP_DIR` | `$MUSICFY_HOME/backups` | nightly snapshots |
| `MUSICFY_PORT` | `8710` | listen port |
| `MUSICFY_BIND` | `0.0.0.0` | listen address |
| `MUSICFY_TOKEN` | unset | optional shared secret |
| `MUSICFY_ORIGINS` | unset | extra allowed origins behind a proxy |
| `MUSICFY_DOWNLOAD_CONCURRENCY` | `4` | downloads at once; 1–2 on a server address YouTube throttles |
| `MUSICFY_YTDLP_IPV4` | unset | `1` adds `--force-ipv4`; use it when a VPS IPv6 route is slow |
| `MUSICFY_PREFER_SOUNDCLOUD` | unset | `1` asks SoundCloud first, for addresses YouTube blocks |

### Downloads on a server address

YouTube treats a home connection and a datacenter address differently. A home line gets
the full-speed stream; a VPS often gets `429 Too Many Requests`, a bot check, or a slow
IPv6 route, and each retry costs time before the next source is tried.

MUSICFY now fails fast: once a YouTube attempt reports 429 or a bot check, it stops walking
the client list and goes to SoundCloud instead of spending minutes on clients that meet the
same wall. `--concurrent-fragments 8` is used on both the direct and search paths.

If downloads are still slow on a VPS, try in `~/.musicfy/musicfy.env`, one at a time:

```ini
MUSICFY_DOWNLOAD_CONCURRENCY=2
MUSICFY_YTDLP_IPV4=1
MUSICFY_PREFER_SOUNDCLOUD=1
```

Then `musicfy restart`. Concurrency 1 is the safest for a rate limit but it also means one
slow retry blocks every other job; 2 usually finishes a queue faster without tripping the
limit again. If `MUSICFY_YTDLP_IPV4=1` makes no difference, your IPv6 route was not the
problem and you can drop it.

`musicfy.env` under the data root holds the same values and is written with mode 600.
The `install.sh` and `musicfy setup` routes use `~/.musicfy` as `MUSICFY_HOME` and write
`MUSICFY_BIND=127.0.0.1`; `/opt/musicfy` and `0.0.0.0` are only the defaults when the
program is started without the wrapper. Pass `--bind=0.0.0.0` when you want the LAN.

### systemd

```ini
[Unit]
Description=MUSICFY
After=network-online.target

[Service]
WorkingDirectory=/opt/musicfy/app
EnvironmentFile=/opt/musicfy/musicfy.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node --no-warnings /opt/musicfy/app/core/core.js
Restart=always
RestartSec=3
User=musicfy

[Install]
WantedBy=multi-user.target
```

`musicfy service install` writes this for you and prints the `sudo` commands when it is not
running as root.

### Adding your own model endpoint

Settings → **Model endpoint** stores `llm_base_url`, `llm_model` and `llm_api_key` in
`data/settings.json`. Any OpenAI-compatible server works. Leave the key blank to keep the
stored one; changing the base URL clears the key.

### Security

- A new install listens on `127.0.0.1`. For a trusted LAN, run
  `musicfy setup --root ~/.musicfy --bind=0.0.0.0`, then set a token:
  `musicfy token --rotate`, and restart. This is not for public internet exposure.
- On a VPS, keep `127.0.0.1` and use an SSH tunnel or an authenticated HTTPS proxy. HTTPS
  is also required for offline playback on iOS.
- Do not port-forward it directly to the internet. There are no per-user accounts.
- `SECURITY.md` explains how to report a vulnerability.

</details>
