#!/bin/sh
# fast health sweep: every critical endpoint answers, and the ones that must not be empty are not
# defaults to a local instance; set BASE to sweep a deployed one
BASE=${BASE:-http://localhost:8710}
fail=0
check() {
  code=$(curl -s -o /tmp/smoke_body -w '%{http_code}' -m "${3:-25}" "$BASE$1")
  size=$(wc -c < /tmp/smoke_body | tr -d ' ')
  if [ "$code" != "200" ] || [ "$size" -lt "${2:-2}" ]; then
    echo "FAIL  $1  http=$code bytes=$size"
    fail=1
  else
    echo "ok    $1  ${size}B"
  fi
}
check "/" 500
check "/api/stats" 20
check "/api/tracks" 1000
check "/api/playlists" 5
check "/api/downloads" 20
check "/api/health/rungs" 20 60
check "/api/analyze/status" 20
check "/api/genre/status" 20
check "/api/recommend?days=30&limit=3" 20 40
check "/api/listens/recent?days=30" 5
check "/api/cover-playlist/$(curl -s -m 10 $BASE/api/playlists | head -c 400 | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')" 100
rm -f /tmp/smoke_body
[ "$fail" = "0" ] && echo "ALL GREEN" || echo "FAILURES PRESENT"
exit $fail
