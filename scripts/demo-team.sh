#!/bin/sh
# Try the team flow on this one Mac: a stand-in licence and team service, plus two copies of 4ruple
# acting as two laptops (a boss and a junior), each with its own licence. Ctrl+C stops all three.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'kill 0' INT TERM EXIT

node "$REPO/scripts/mock-license.mjs" 4701 "$TMP/keys.json" &
sleep 2
(cd "$REPO" && FOURUPLE_REQUIRE_LICENSE=1 FOURUPLE_DEVICE_ID=boss-laptop FOURUPLE_DATA_DIR="$TMP/boss" \
  FOURUPLE_LICENSE_API=http://127.0.0.1:4701/license PORT=4640 node server.js) &
(cd "$REPO" && FOURUPLE_REQUIRE_LICENSE=1 FOURUPLE_DEVICE_ID=junior-laptop FOURUPLE_DATA_DIR="$TMP/junior" \
  FOURUPLE_LICENSE_API=http://127.0.0.1:4701/license PORT=4650 node server.js) &
sleep 8

# Each laptop activates its own licence, the way a real buyer would after their key arrives.
node -e '
const fs = require("fs");
const keys = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const activate = (port, key) => fetch(`http://127.0.0.1:${port}/api/license/activate`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
}).then((r) => r.json()).then((r) => console.log(`  port ${port}: ${r.ok ? "licence active" : r.error}`));
Promise.all([activate(4640, keys.ownerKey), activate(4650, keys.memberKey)]);
' "$TMP/keys.json"

cat <<MSG

  Boss laptop:    http://localhost:4640
  Junior laptop:  http://localhost:4650

  1. On the boss, open Settings and create a team, then Invite a teammate and copy the code.
  2. On the junior, open Settings, join with that code, and add a few people on Leads.
  3. Both sync every minute, or press Sync now. Open Team on the boss to see the junior's day.

  Nothing here is real: keys and team data live only while this runs. Ctrl+C to stop.
MSG
wait
