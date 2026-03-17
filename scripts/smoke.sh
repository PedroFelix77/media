#!/usr/bin/env bash
set -euo pipefail

HTTP_PORT="${SFU_HTTP_PORT:-3100}"
API_SECRET="${SFU_API_SECRET:-dev-api-secret}"

base="http://127.0.0.1:${HTTP_PORT}"

echo "[1/4] health"
curl -sS "${base}/health" | jq .

echo "[2/4] create room"
room_id="$(
  curl -sS -X POST "${base}/rooms" \
    -H "Authorization: Bearer ${API_SECRET}" \
    -H 'Content-Type: application/json' \
    -d '{"callId":"call_smoke"}' | jq -r .room_id
)"
echo "room_id=${room_id}"

echo "[3/4] metrics"
curl -sS "${base}/metrics" -H "Authorization: Bearer ${API_SECRET}" | jq .

echo "[4/4] destroy room"
curl -sS -X DELETE "${base}/rooms/${room_id}" -H "Authorization: Bearer ${API_SECRET}" | jq .

echo "OK"

