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
FROM=""

for arg in "$@"; do
  case "$arg" in
    --root=*) ROOT=${arg#--root=}; APP="$ROOT/app" ;;
    --repo=*) REPO=${arg#--repo=} ;;
    --ref=*) REF=${arg#--ref=} ;;
    --skip-deps) SKIP="--skip-deps" ;;
    --local) FROM=$(pwd) ;;
    --from=*) FROM=${arg#--from=} ;;
    -h|--help)
      echo "Usage: install.sh [--root=DIR] [--repo=URL] [--ref=BRANCH] [--local|--from=DIR] [--skip-deps]"
      echo "  --local/--from  install the source in this folder instead of cloning GitHub"
      exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "MUSICFY needs $1 on PATH." >&2; exit 1; }; }
need node
if [ -n "$FROM" ]; then
  [ -f "$FROM/bin/musicfy.mjs" ] || { echo "No MUSICFY source in $FROM (missing bin/musicfy.mjs)." >&2; exit 1; }
else
  need git
fi

mkdir -p "$ROOT" "$HOME/.local/bin"
if [ -n "$FROM" ]; then
  FROM=$(cd "$FROM" && pwd -P)
  echo "Installing the source in $FROM"
  if [ "$FROM" != "$APP" ]; then
    rm -rf "$APP"
    mkdir -p "$APP"
    tar -C "$FROM" --exclude=.git --exclude=backups --exclude=data --exclude=musicfy.env --exclude=musicfy.pid -cf - . | tar -C "$APP" -xf -
  fi
elif [ -d "$APP/.git" ]; then
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
