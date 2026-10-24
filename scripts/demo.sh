#!/bin/sh
# Click through the whole 4ruple buying journey on this Mac with fake money:
# a stand-in license service (:4701), the Basement Protocol site with the demo checkout (:4620),
# and the app as a fresh laptop (:4630). Ctrl+C stops all three.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${SITE:-$HOME/Documents/Codex/2026-09-09/nee/outputs/basement-protocol-standalone}"
TMP="$(mktemp -d)"
trap 'kill 0' INT TERM EXIT

node "$REPO/scripts/mock-license.mjs" 4701 "$TMP/keys.json" &
(cd "$SITE" && NEXT_PUBLIC_CHECKOUT_PROVIDER=demo FOURUPLE_LICENSE_API=http://127.0.0.1:4701/license \
  FOURUPLE_DEMO_ISSUE_URL=http://127.0.0.1:4701/issue npx next dev -p 4620) &
(cd "$REPO" && FOURUPLE_REQUIRE_LICENSE=1 FOURUPLE_DATA_DIR="$TMP/laptop" \
  FOURUPLE_LICENSE_API=http://127.0.0.1:4701/license PORT=4630 node server.js) &

sleep 10
cat <<MSG

  1. Buy (fake money):   http://localhost:4620/4ruple
  2. Use the app:        http://localhost:4630   (paste the key under "Already bought it?")
  3. Manage devices:     http://localhost:4620/4ruple/manage

  Keys only live while this runs. Ctrl+C to stop.
MSG
wait
