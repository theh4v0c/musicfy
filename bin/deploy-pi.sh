#!/bin/sh
# Deploy the working tree to the Pi and prove the running version matches it.
#
# The code folders alone are not enough: package.json carries the version the app reports
# and compares against releases. A deploy that skips it leaves the Pi claiming an old
# version while running new code, and the update check then lies.
set -eu

HOST=${MUSICFY_PI_HOST:-plm}
DEST=${MUSICFY_PI_DIR:-/opt/musicfy}
HERE=$(cd "$(dirname "$0")/.." && pwd)
WANT=$(node -p "require('$HERE/package.json').version" 2>/dev/null || node -p "require('./package.json').version")

rsync -az \
  --exclude .git --exclude backups --exclude data --exclude logs --exclude owned \
  --exclude musicfy.env --exclude musicfy.pid --exclude node_modules \
  --exclude dist --exclude desktop/vendor \
  "$HERE"/ "$HOST:$DEST"/

GOT=$(ssh "$HOST" "node -p \"require('$DEST/package.json').version\"")
if [ "$GOT" != "$WANT" ]; then
  echo "package.json did not land: remote $GOT, local $WANT" >&2
  exit 1
fi

ssh "$HOST" "sudo systemctl restart musicfy-core"
sleep 2

# the running process reports the version it loaded, not the file on disk
for i in 1 2 3 4 5 6 7 8 9 10; do
  RUN=$(ssh "$HOST" "curl -s --max-time 3 http://127.0.0.1:8710/api/settings" 2>/dev/null \
    | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(b).version||''))}catch{}})" \
    2>/dev/null || true)
  [ "$RUN" = "$WANT" ] && break
  sleep 1
done

if [ "$RUN" != "$WANT" ]; then
  echo "running $RUN, expected $WANT — check: ssh $HOST 'journalctl -u musicfy-core -n 40'" >&2
  exit 1
fi

STORE=$(ssh "$HOST" "curl -s --max-time 3 http://127.0.0.1:8710/api/settings" 2>/dev/null \
  | node -e "let b='';process.stdin.on('data',c=>b+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(b).storefront||''))}catch{}})" \
  2>/dev/null || true)
echo "$HOST: $RUN running, catalogue storefront ${STORE:-?}"
