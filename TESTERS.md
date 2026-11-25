# Testing a private MUSICFY build

Thank you for trying MUSICFY before it is public. This build is for a small group; please
do not post it publicly yet.

You do **not** need a GitHub account. You will receive one file:

```
musicfy-test.tar.gz
```

It contains the program. Your music, database and settings stay on your computer.

## What you need

- A **Mac** (macOS 13 or newer) or **64-bit Linux** computer.
- About **2 GB free** for the program and its Python helpers. Your music needs its own
  space.
- An internet connection for the first install.

Windows is not supported directly. If your computer is Windows, use Docker Desktop or WSL2;
ask me and I will send the Docker steps.

## Install on a Mac

1. Open **Terminal**: press `Command + Space`, type `Terminal`, press Enter.

2. Install the helper programs. If you do not have Homebrew, tell me and I will send the
   two-line install command.

   ```sh
   brew install node ffmpeg python
   ```

3. Unpack the file. Replace the path with where you saved it:

   ```sh
   cd ~/Downloads
   tar -xzf musicfy-test.tar.gz
   cd musicfy-<version>
   ```

4. Install MUSICFY into `~/.musicfy` and link the command:

   ```sh
   ./install.sh --local
   ```

   Wait 5 to 10 minutes. It downloads Python packages. You should see
   `MUSICFY is at http://localhost:8710`.

5. Start it:

   ```sh
   musicfy start
   ```

6. Open <http://localhost:8710>.

If `musicfy` is not found, close Terminal, open it again, and run `musicfy start`. If it
still fails:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## Install on Linux (Debian or Ubuntu)

1. Open **Terminal**: `Control + Alt + T`.

2. Install the helpers:

   ```sh
   sudo apt update
   sudo apt install -y curl ffmpeg python3 python3-venv
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. Unpack and install:

   ```sh
   cd ~/Downloads
   tar -xzf musicfy-test.tar.gz
   cd musicfy-<version>
   ./install.sh --local
   ```

4. Start and open:

   ```sh
   musicfy start
   ```

   Then open <http://localhost:8710>.

## Using it

- Add music with **Library → Upload files** or **Upload a folder**. There is no scanner for
  an existing music folder yet.
- Click a track to play. Use the search field, playlists and **Prep** for DJ exports.
- If you want it to start after a reboot: `musicfy service install`.
- To use it from your phone, see `musicfy doctor` and the phone section of `INSTALL.md`.
  Set a token first: `musicfy token --rotate`, then `musicfy restart`.

## If something goes wrong

Run this and copy the output:

```sh
musicfy doctor
```

Then send me:

1. What you were doing, step by step.
2. The last 40 lines of the log:

   ```sh
   musicfy logs
   ```

3. Your operating system and version (`sw_vers` on macOS; `cat /etc/os-release` on Linux).

Please **do not** send your database, your music files or `musicfy.env`. They are personal.
Logs may contain file paths; remove anything you do not want to share.

## Remove it

```sh
musicfy service uninstall
musicfy stop
rm -rf ~/.musicfy
rm -f ~/.local/bin/musicfy
```

This removes the program, database, settings and any music you uploaded into `~/.musicfy`.

## Known limits in this build

- No scanner for an existing folder; upload through the app.
- Native Windows is not supported; Docker or WSL2 only.
- Analysis (BPM, key, cue points) needs the Python environment created by the installer.
  If it is missing, playback and downloads still work.
- The first page may be empty until you upload music.
