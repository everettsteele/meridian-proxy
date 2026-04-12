#!/usr/bin/env bash
# End-to-end smoke test against a running sorted-api.
# Usage: API=http://localhost:3003 bash scripts/smoke-plan.sh
set -eu
API="${API:-http://localhost:3003}"

echo "==> create"
CREATE=$(curl -sS -X POST "$API/api/plan" -H 'Content-Type: application/json' -d '{
  "crewName":"Smoke Test Crew",
  "crew":[{"name":"Org","phone":"+15551110000"},{"name":"Dave","phone":"+15552220000"}],
  "city":"Atlanta",
  "driveDistance":2,
  "vibe":{"adventure":3,"risk":2,"cost":2},
  "activity":{"name":"Skeet","blurb":"bang"},
  "organizerAvailability":"any Saturday after 1pm"
}')
echo "$CREATE"
ID=$(printf '%s' "$CREATE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).id))')
echo "id=$ID"

echo "==> get (phones should be absent)"
curl -sS "$API/api/plan/$ID" | head -c 600; echo

echo "==> vote (Dave)"
curl -sS -X POST "$API/api/plan/$ID/vote" -H 'Content-Type: application/json' -d '{"name":"Dave","availability":"4/18 works"}'; echo

echo "==> lock"
curl -sS -X POST "$API/api/plan/$ID/lock" | head -c 800; echo

echo "==> get after lock"
curl -sS "$API/api/plan/$ID" | head -c 800; echo

echo "smoke test complete."
