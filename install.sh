#!/bin/sh
# MUSICFY installer: clone into ~/.musicfy/app, create the data home, put `musicfy` on PATH.
# No sudo, no npm dependencies, no pip during a package lifecycle: this script is the
# explicit install and calls `musicfy setup`, which is where the Python venvs are made.
set -eu

REPO=${MUSICFY_REPO:-https://github.com/theh4v0c/musicfy.git}
REF=${MUSICFY_REF:-main}
ROOT=${MUSICFY_HOME:-$HOME/.musicfy}
APP="$ROOT/app"
SKIP=""

for arg in "$@"; do
  case "$arg" in
    --root=*) ROOT=${arg#--root=}; APP="$ROOT/app" ;;
    --repo=*) REPO=${arg#--repo=} ;;
    --ref=*) REF=${arg#--ref=} ;;
    --skip-deps) SKIP="--skip-deps" ;;
    -h|--help)
      echo "Usage: install.sh [--root=DIR] [--repo=URL] [--ref=BRANCH] [--skip-deps]"
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "MUSICFY needs $1 on PATH." >&2; exit 1; }; }
need git
need node

mkdir -p "$ROOT" "$HOME/.local/bin"
if [ -d "$APP/.git" ]; then
  echo "Updating $APP"
  git -C "$APP" fetch --depth 1 origin "$REF"
  git -C "$APP" checkout -q FETCH_HEAD
else
  echo "Cloning $REPO into $APP"
  git clone --depth 1 --branch "$REF" "$REPO" "$APP"
fi

node "$APP/bin/musicfy.mjs" setup --root "$ROOT" $SKIP

ln -sf "$APP/bin/musicfy.mjs" "$HOME/.local/bin/musicfy"
echo ""
echo "Linked $HOME/.local/bin/musicfy"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "Add $HOME/.local/bin to PATH, then reopen your shell." ;;
esac
echo "Start it with: musicfy start"
echo "Or install a service: musicfy service install"
