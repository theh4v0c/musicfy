#!/bin/sh
# Deploy every host, then prove each one runs the version in this tree.
#
# Two installs, two mechanisms: the VPS is a git checkout updated with `musicfy update`,
# the Pi is a bundle synced with rsync. Deploying one and forgetting the other is how the
# two drifted; this script does both and fails when a version does not match.
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
WANT=$(node -p "require('$HERE/package.json').version")
PI=${MUSICFY_PI_HOST:-plm}
VPS=${MUSICFY_VPS_HOST:-mf-vps}
PI_DIR=${MUSICFY_PI_DIR:-/opt/musicfy}

say() { printf '%s\n' "$*"; }

say "== MUSICFY $WANT -> $PI, $VPS"

# --- Pi: bundle install, rsync the whole tree (package.json carries the version)
rsync -az \
  --exclude .git --exclude backups --exclude data --exclude logs --exclude owned \
  --exclude musicfy.env --exclude musicfy.pid --exclude node_modules \
  "$HERE"/ "$PI:$PI_DIR"/
ssh "$PI" 'sudo systemctl restart musicfy-core'
say "   $PI: synced and restarted"

# --- VPS: git checkout, update then restart (update alone can leave the old process)
ssh "$VPS" 'export PATH="$HOME/.local/bin:$PATH"; musicfy update >/dev/null 2>&1 || true; musicfy restart >/dev/null 2>&1 || true'
say "   $VPS: updated and restarted"

# --- verify both through their own HTTP port
fail=0
check() {
  host=$1
  ver=$(ssh "$host" "curl -s -m 6 http://127.0.0.1:8710/api/settings" 2>/dev/null \
    | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(b).version||''))}catch{}})" 2>/dev/null || true)
  code=$(ssh "$host" "curl -s -m 6 -o /dev/null -w '%{http_code}' http://127.0.0.1:8710/" 2>/dev/null || true)
  asset=$(ssh "$host" "curl -s -m 6 http://127.0.0.1:8710/ | grep -oE '/app\\\\?v=[^\"]+'" 2>/dev/null | head -1 || true)
  if [ "$ver" = "$WANT" ] && [ "$code" = "200" ]; then
    say "   $host: $ver, / 200, asset ${asset:-?}"
  else
    say "   $host: FAILED (version ${ver:-none}, / ${code:-none})" >&2
    fail=1
  fi
}
check "$PI"
check "$VPS"

[ "$fail" = 0 ] || { say "deploy incomplete" >&2; exit 1; }
say "== both hosts on $WANT"
