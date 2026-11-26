#!/bin/sh
# Deploy every host, then prove each one runs the version in this tree.
#
# Two installs, two mechanisms: the VPS is a git checkout updated with `musicfy update`,
# the Pi is a bundle synced with rsync. Deploying one and forgetting the other is how the
# two drifted; this script does both and fails when a version does not match.
# A host behind the token login is checked with the token; its / answers 401 when logged out,
# so the login page is the "it is up" check.
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
WANT=$(node -p "require('$HERE/package.json').version")
PI=${MUSICFY_PI_HOST:-plm}
VPS=${MUSICFY_VPS_HOST:-mf-vps}
PI_DIR=${MUSICFY_PI_DIR:-/opt/musicfy}

say() { printf '%s\n' "$*"; }

say "== MUSICFY $WANT -> $PI, $VPS"

rsync -az \
  --exclude .git --exclude backups --exclude data --exclude logs --exclude owned \
  --exclude musicfy.env --exclude musicfy.pid --exclude node_modules \
  "$HERE"/ "$PI:$PI_DIR"/
ssh "$PI" 'sudo systemctl restart musicfy-core'
say "   $PI: synced and restarted"

# `musicfy restart` refuses while the systemd unit is active; restart the unit instead.
ssh "$VPS" 'export PATH="$HOME/.local/bin:$PATH"; musicfy update >/dev/null 2>&1 || true
if systemctl is-active --quiet musicfy; then systemctl restart musicfy; else musicfy restart >/dev/null 2>&1 || true; fi'
say "   $VPS: updated and restarted"

fail=0
check() {
  host=$1
  out=$(ssh "$host" 'T=$(grep -s ^MUSICFY_TOKEN= "$HOME/.musicfy/musicfy.env" | cut -d= -f2-)
if [ -n "$T" ]; then
  curl -s -m 6 -H "authorization: Bearer $T" http://127.0.0.1:8710/api/settings; echo
else
  curl -s -m 6 http://127.0.0.1:8710/api/settings; echo
fi
curl -s -m 6 -o /dev/null -w "%{http_code}" http://127.0.0.1:8710/login; echo
if [ -n "$T" ]; then
  curl -s -m 6 -o /dev/null -w "%{http_code}" -H "authorization: Bearer $T" http://127.0.0.1:8710/; echo
else
  curl -s -m 6 -o /dev/null -w "%{http_code}" http://127.0.0.1:8710/; echo
fi
if [ -n "$T" ]; then
  curl -s -m 6 -H "authorization: Bearer $T" http://127.0.0.1:8710/ | grep -oE "app[.]js[?]v=[0-9.]+" | head -1
else
  curl -s -m 6 http://127.0.0.1:8710/ | grep -oE "app[.]js[?]v=[0-9.]+" | head -1
fi' 2>/dev/null || true)
  ver=$(printf '%s\n' "$out" | sed -n '1p' | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(b).version||''))}catch{}})" 2>/dev/null || true)
  code=$(printf '%s\n' "$out" | sed -n '2p')
  root=$(printf '%s\n' "$out" | sed -n '3p')
  asset=$(printf '%s\n' "$out" | sed -n '4p')
  if [ "$ver" = "$WANT" ] && { [ "$code" = "200" ] || [ "$root" = "200" ]; }; then
    say "   $host: $ver, login ${code}, root ${root}, asset ${asset:-?}"
  else
    say "   $host: FAILED (version ${ver:-none}, login ${code:-none}, root ${root:-none})" >&2
    fail=1
  fi
}
check "$PI"
check "$VPS"

[ "$fail" = 0 ] || { say "deploy incomplete" >&2; exit 1; }
say "== both hosts on $WANT"
