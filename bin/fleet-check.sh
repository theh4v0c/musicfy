#!/bin/sh
# Read-only: are both hosts running the version in this tree? Exit 1 when they are not.
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
WANT=$(node -p "require('$HERE/package.json').version")
PI=${MUSICFY_PI_HOST:-plm}
VPS=${MUSICFY_VPS_HOST:-mf-vps}

status() {
  host=$1
  ver=$(ssh "$host" 'T=$(grep -s ^MUSICFY_TOKEN= "$HOME/.musicfy/musicfy.env" | cut -d= -f2-)
if [ -n "$T" ]; then
  curl -s -m 6 -H "authorization: Bearer $T" http://127.0.0.1:8710/api/settings
else
  curl -s -m 6 http://127.0.0.1:8710/api/settings
fi' 2>/dev/null \
    | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{try{const d=JSON.parse(b);process.stdout.write((d.version||'')+' storefront='+(d.storefront||'')+' pending='+(d.pending_restart?'yes':'no'))}catch{}})" 2>/dev/null || true)
  printf '%-8s %s\n' "$host" "${ver:-unreachable}"
  case "$ver" in "$WANT "*) return 0 ;; *) return 1 ;; esac
}

echo "local    $WANT"
rc=0
status "$PI" || rc=1
status "$VPS" || rc=1
[ "$rc" = 0 ] || { echo "drift: deploy with npm run deploy:all" >&2; exit 1; }
echo "both on $WANT"
