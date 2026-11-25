# Install with an agent

MUSICFY can be installed by an open-source coding agent that can run terminal commands,
such as **OpenCode** or **Hermes**. The prompt below is self-contained: it checks the
machine, installs the prerequisites with your approval, installs MUSICFY on localhost,
and verifies it. It never opens a firewall port or exposes the app to a network.

No paid service is required for this flow. The agent uses the same shell commands a person
would use.

## Start the agent in a checkout

```sh
git clone https://github.com/theh4v0c/musicfy.git
cd musicfy
opencode
```

Use `hermes` instead of `opencode` if that is your agent. If the repository is private, the
clone needs your normal GitHub authentication first.

## Paste this into the agent

~~~text
Install MUSICFY on this computer. Work carefully and stop if something does not match.

Rules:
- Use only open-source tools and the commands in this prompt. Do not use paid services.
- If a step needs sudo, show me the exact command and wait for my approval before running it.
- Do not overwrite an existing ~/.musicfy directory or database. If one exists, stop and tell me.
- Do not bind MUSICFY to 0.0.0.0, do not open firewall ports, and do not print tokens.
- If you cannot do a step, stop and give me the command and the exact error.

Steps:
1. Tell me the operating system and CPU architecture you detect.
   - If this is native Windows, stop: native Windows is not supported. Tell me to use
     Docker Desktop or WSL2 instead.
   - macOS 13+ and 64-bit Linux are supported.
2. Check that these commands exist: node, ffmpeg, ffprobe, python3, git.
   Print their versions. Node must be 22.13.0 or newer.
   If something is missing, show me the install command for my OS and wait for approval.
3. Clone https://github.com/theh4v0c/musicfy.git into ~/.musicfy-src.
   If that directory already exists, stop and ask me what to do.
4. In ~/.musicfy-src, run:
   ./install.sh --local --root "$HOME/.musicfy" --bind=127.0.0.1
   This installs the program and the two Python environments. It can take 5 to 10 minutes.
   Do not add sudo to this command.
5. Run:
   musicfy doctor
   Show me every line. A missing analyser is acceptable for playback but must be reported.
6. Run:
   musicfy start
   Then run:
   musicfy status
   and:
   curl -fsS http://127.0.0.1:8710/health
   The health response must contain "ok":true.
7. Report back:
   - MUSICFY version
   - the data directory
   - the local URL
   - the full doctor result
   - anything that is still missing
8. If the installation failed, stop and show me:
   - the step that failed
   - the command you ran
   - the last 40 lines of the output
   Do not invent a workaround.
~~~

## What success looks like

The agent should finish with:

```
musicfy doctor        no problems, or only the optional analyser missing
musicfy status        MUSICFY is running ... health ok
http://127.0.0.1:8710
```

Then open <http://localhost:8710> on that computer. Add music through
**Library → Upload files**.

## If you want another computer or phone to reach it

Do that as a separate, deliberate step. It means changing the bind address and setting a
token:

```sh
musicfy setup --root "$HOME/.musicfy" --bind=0.0.0.0
musicfy token --rotate
musicfy restart
```

Do not ask an agent to open the port to the public internet. Use a VPN or an authenticated
HTTPS proxy for that.

## If the agent cannot run commands

Give it the same prompt and ask it to produce a numbered list of the commands for your OS.
Do not let it invent flags; the real steps are in `README.md` and `INSTALL.md`.
