#!/usr/bin/env bash
# ============================================================
# smoke-test-v4.sh — end-to-end smoke test for the v4 features
# (06_v4.sql: communities / community post images / item location /
#  item likes / item status / reports / user blocks / visits)
#
# Usage:
#   SUPABASE_URL=https://xxxx.supabase.co \
#   SUPABASE_ANON_KEY=eyJ... \
#   [TEST_PREFIX=smoketest] \
#   ADMIN_EMAIL=admin@id.koreasg.app ADMIN_PASSWORD=<admin-pw> \
#   ./smoke-test-v4.sh
#
# TEST_PREFIX must be lowercase [a-z0-9_] and short enough that
# "<prefix>a<RANDOM>" stays within 20 chars (default: smoketest).
#
# NOTE: email confirmation must be DISABLED in Supabase Auth so that
# POST /auth/v1/signup returns an access_token directly for the
# synthetic @id.koreasg.app addresses. An ADMIN account (profiles.is_admin)
# must already exist; pass its credentials via ADMIN_EMAIL/ADMIN_PASSWORD.
#
# Echoes PASS/FAIL per step; exits 1 on the first failure.
# Only needs curl + grep (no jq).
# ============================================================
set -u

: "${SUPABASE_URL:?SUPABASE_URL env var is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY env var is required}"
TEST_PREFIX="${TEST_PREFIX:-smoketest}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@id.koreasg.app}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD env var is required (admin account password)}"

BASE="${SUPABASE_URL%/}/rest/v1"
AUTH_BASE="${SUPABASE_URL%/}/auth/v1"
UUID_RE='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  if [ "$#" -gt 1 ]; then echo "      response: $2"; fi
  exit 1
}

# req METHOD PATH TOKEN [JSON_BODY]  -> prints response body
# TOKEN is a user access_token, or $SUPABASE_ANON_KEY for anonymous calls.
# Body is sent via stdin (--data-binary @-): Windows curl corrupts non-ASCII
# UTF-8 passed as a command-line argument.
req() {
  local method="$1" path="$2" token="$3" data="${4:-}"
  if [ -n "$data" ]; then
    printf '%s' "$data" | curl -s -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      --data-binary @-
  else
    curl -s -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json"
  fi
}

# req_code METHOD PATH TOKEN [JSON_BODY]  -> prints HTTP status code only
req_code() {
  local method="$1" path="$2" token="$3" data="${4:-}"
  if [ -n "$data" ]; then
    printf '%s' "$data" | curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      --data-binary @-
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json"
  fi
}

# signup USERNAME REGION  -> prints raw signup response body
signup() {
  local username="$1" region="$2"
  printf '%s' "{\"email\":\"${username}@id.koreasg.app\",\"password\":\"test1234\",\"data\":{\"username\":\"${username}\",\"region\":\"${region}\"}}" \
    | curl -s -X POST "$AUTH_BASE/signup" \
        -H "apikey: $SUPABASE_ANON_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @-
}

# login EMAIL PASSWORD  -> prints raw token response body
login() {
  local email="$1" password="$2"
  printf '%s' "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
    | curl -s -X POST "$AUTH_BASE/token?grant_type=password" \
        -H "apikey: $SUPABASE_ANON_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @-
}

extract_uuid()  { grep -oE "$UUID_RE" | head -n 1; }
extract_token() { grep -o '"access_token":"[^"]*"' | head -n 1 | cut -d'"' -f4; }
# json_build_object output may contain spaces around ':'
json_has() { grep -Eq "\"$1\"[[:space:]]*:[[:space:]]*$2"; }

echo "== SGcommunity v4 smoke test against $SUPABASE_URL =="

USER_A="${TEST_PREFIX}a${RANDOM}"
USER_B="${TEST_PREFIX}b${RANDOM}"

# ------------------------------------------------------------
# 0. sign up users A and B; log in the admin
# ------------------------------------------------------------
RESP=$(signup "$USER_A" "주롱")
TOKEN_A=$(printf '%s' "$RESP" | extract_token)
[ -n "$TOKEN_A" ] || fail "0a. signup for user A returned no access_token (email confirmation enabled?)" "$RESP"
pass "0a. signed up user A ($USER_A)"

RESP=$(signup "$USER_B" "싱가포르 외")
TOKEN_B=$(printf '%s' "$RESP" | extract_token)
[ -n "$TOKEN_B" ] || fail "0b. signup for user B returned no access_token" "$RESP"
pass "0b. signed up user B ($USER_B)"

RESP=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
TOKEN_ADMIN=$(printf '%s' "$RESP" | extract_token)
[ -n "$TOKEN_ADMIN" ] || fail "0c. admin login ($ADMIN_EMAIL) returned no access_token" "$RESP"
pass "0c. logged in admin ($ADMIN_EMAIL)"

# ------------------------------------------------------------
# 1. communities_view (anon) returns 자유게시판 + 건의함
# ------------------------------------------------------------
RESP=$(req GET "/communities_view?select=slug,name" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '자유게시판' && printf '%s' "$RESP" | grep -q '건의함'; then
  pass "1. communities_view (anon) includes 자유게시판 + 건의함"
else
  fail "1. communities_view (anon) missing seeds" "$RESP"
fi

# ------------------------------------------------------------
# 2. admin RPCs: create/update_community; non-admin forbidden
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_community" "$TOKEN_A" \
  '{"p_slug":"testtopic","p_name":"테스트주제"}')
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "2a. non-admin create_community -> forbidden"
else
  fail "2a. non-admin create_community was NOT forbidden" "$RESP"
fi

RESP=$(req POST "/rpc/create_community" "$TOKEN_ADMIN" \
  '{"p_slug":"testtopic","p_name":"테스트주제","p_description":"스모크 주제","p_sort_order":50}')
COMM_ID=$(printf '%s' "$RESP" | extract_uuid)
[ -n "$COMM_ID" ] || fail "2b. admin create_community did not return a uuid" "$RESP"
pass "2b. admin create_community -> $COMM_ID"

RESP=$(req GET "/communities_view?slug=eq.testtopic" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '테스트주제'; then
  pass "2c. communities_view now includes 테스트주제"
else
  fail "2c. communities_view does not include the new topic" "$RESP"
fi

CODE=$(req_code POST "/rpc/update_community" "$TOKEN_ADMIN" \
  "{\"p_id\":\"$COMM_ID\",\"p_name\":\"테스트주제\",\"p_description\":\"비활성\",\"p_sort_order\":50,\"p_is_active\":false}")
[ "$CODE" = "204" ] || fail "2d. admin update_community (deactivate) returned HTTP $CODE"
RESP=$(req GET "/communities_view?slug=eq.testtopic" "$SUPABASE_ANON_KEY")
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "[]" ]; then
  pass "2d. update_community deactivate -> topic disappears from view"
else
  fail "2d. deactivated topic still visible in communities_view" "$RESP"
fi

# ------------------------------------------------------------
# 3. community post with community_id (free) + image_paths
# ------------------------------------------------------------
FREE_ID=$(req GET "/communities_view?slug=eq.free&select=id" "$SUPABASE_ANON_KEY" | extract_uuid)
[ -n "$FREE_ID" ] || fail "3. could not resolve the 'free' community id"

RESP=$(req POST "/rpc/create_post" "$TOKEN_A" \
  "{\"p_title\":\"smoke v4 post\",\"p_content\":\"smoke v4 content\",\"p_is_anonymous\":false,\"p_community_id\":\"$FREE_ID\",\"p_image_paths\":[\"posts/x/0.webp\"]}")
POST_ID=$(printf '%s' "$RESP" | extract_uuid)
[ -n "$POST_ID" ] || fail "3. create_post (free community + image_paths) did not return a uuid" "$RESP"

RESP=$(req GET "/posts_view?id=eq.$POST_ID&select=community_name,has_image,image_paths" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '자유게시판'; then
  pass "3a. posts_view shows community_name '자유게시판'"
else
  fail "3a. posts_view community_name is not 자유게시판" "$RESP"
fi
if printf '%s' "$RESP" | json_has "has_image" "true"; then
  pass "3b. posts_view has_image true (image_paths set)"
else
  fail "3b. posts_view has_image is not true" "$RESP"
fi

# update_post (new 6-arg): change community to null-default (free) + clear images
CODE=$(req_code POST "/rpc/update_post" "$TOKEN_A" \
  "{\"p_id\":\"$POST_ID\",\"p_title\":\"smoke v4 post edited\",\"p_content\":\"edited content\",\"p_is_anonymous\":false,\"p_community_id\":null,\"p_image_paths\":[]}")
[ "$CODE" = "204" ] || fail "3c. update_post (new 6-arg) returned HTTP $CODE"
RESP=$(req GET "/posts_view?id=eq.$POST_ID&select=community_name,has_image" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '자유게시판' && printf '%s' "$RESP" | json_has "has_image" "false"; then
  pass "3c. update_post -> community_name 자유게시판, has_image false (images cleared)"
else
  fail "3c. update_post did not apply community/image changes" "$RESP"
fi

# ------------------------------------------------------------
# 4. item: location + likes + status
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_item" "$TOKEN_A" \
  '{"p_title":"smoke v4 item","p_category":"기타","p_price":1000,"p_description":"desc","p_location":"주롱","p_image_paths":[]}')
ITEM_ID=$(printf '%s' "$RESP" | extract_uuid)
[ -n "$ITEM_ID" ] || fail "4a. create_item with p_location did not return a uuid" "$RESP"
pass "4a. create_item with p_location 주롱 -> $ITEM_ID"

RESP=$(req GET "/items_view?id=eq.$ITEM_ID&select=location,like_count,popularity" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '주롱' && printf '%s' "$RESP" | json_has "like_count" "0"; then
  pass "4b. items_view shows location 주롱, like_count 0"
else
  fail "4b. items_view location/like_count wrong" "$RESP"
fi

# update_item (new 8-arg): change 거래지역 to 시티/오차드
CODE=$(req_code POST "/rpc/update_item" "$TOKEN_A" \
  '{"p_id":"'"$ITEM_ID"'","p_title":"smoke v4 item edited","p_category":"기타","p_price":2000,"p_description":"desc2","p_image_paths":[],"p_status":"selling","p_location":"시티/오차드"}')
[ "$CODE" = "204" ] || fail "4b2. update_item (new 8-arg) returned HTTP $CODE"
RESP=$(req GET "/items_view?id=eq.$ITEM_ID&select=location,price" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '시티/오차드'; then
  pass "4b2. update_item -> items_view location 시티/오차드"
else
  fail "4b2. update_item did not apply location change" "$RESP"
fi

RESP=$(req POST "/rpc/toggle_item_like" "$TOKEN_B" "{\"p_item_id\":\"$ITEM_ID\"}")
if printf '%s' "$RESP" | json_has "liked" "true" && printf '%s' "$RESP" | json_has "like_count" "1"; then
  pass "4c. toggle_item_like by B -> liked true, like_count 1"
else
  fail "4c. toggle_item_like did not return {liked:true, like_count:1}" "$RESP"
fi

RESP=$(req GET "/items_view?id=eq.$ITEM_ID&select=like_count,popularity" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | json_has "like_count" "1" && printf '%s' "$RESP" | json_has "popularity" "1"; then
  pass "4d. items_view reflects like_count 1, popularity 1"
else
  fail "4d. items_view like_count/popularity not updated" "$RESP"
fi

RESP=$(req POST "/rpc/set_item_status" "$TOKEN_B" "{\"p_id\":\"$ITEM_ID\",\"p_status\":\"sold\"}")
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "4e. set_item_status by non-owner -> forbidden"
else
  fail "4e. set_item_status by non-owner was NOT forbidden" "$RESP"
fi

CODE=$(req_code POST "/rpc/set_item_status" "$TOKEN_A" "{\"p_id\":\"$ITEM_ID\",\"p_status\":\"sold\"}")
[ "$CODE" = "204" ] || fail "4f. set_item_status by owner returned HTTP $CODE"
RESP=$(req GET "/items_view?id=eq.$ITEM_ID&select=status" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q '"status":"sold"'; then
  pass "4f. set_item_status by owner -> items_view status sold"
else
  fail "4f. items_view status is not sold" "$RESP"
fi

# ------------------------------------------------------------
# 5. reports
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_report" "$TOKEN_A" \
  "{\"p_target_type\":\"post\",\"p_target_id\":\"$POST_ID\",\"p_reason\":\"스팸\"}")
REPORT_ID=$(printf '%s' "$RESP" | extract_uuid)
[ -n "$REPORT_ID" ] || fail "5a. create_report did not return a uuid" "$RESP"
pass "5a. create_report('post', <postid>, '스팸') -> $REPORT_ID"

RESP=$(req POST "/rpc/admin_reports" "$TOKEN_A" '{"p_status":"open"}')
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "5b. non-admin admin_reports -> forbidden"
else
  fail "5b. non-admin admin_reports was NOT forbidden" "$RESP"
fi

RESP=$(req POST "/rpc/admin_reports" "$TOKEN_ADMIN" '{"p_status":"open"}')
if printf '%s' "$RESP" | grep -q "$REPORT_ID"; then
  pass "5c. admin admin_reports('open') includes the report"
else
  fail "5c. admin admin_reports did not include the report" "$RESP"
fi

CODE=$(req_code POST "/rpc/resolve_report" "$TOKEN_ADMIN" "{\"p_id\":\"$REPORT_ID\"}")
[ "$CODE" = "204" ] || fail "5d. resolve_report returned HTTP $CODE"
pass "5d. admin resolve_report -> ok"

# ------------------------------------------------------------
# 6. blocks: B blocks A -> A cannot message B; unblock -> works
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/block_user" "$TOKEN_B" "{\"p_username\":\"$USER_A\"}")
[ "$CODE" = "204" ] || fail "6a. block_user by B returned HTTP $CODE"
pass "6a. B block_user($USER_A) -> ok"

RESP=$(req POST "/rpc/send_message_to_user" "$TOKEN_A" \
  "{\"p_username\":\"$USER_B\",\"p_content\":\"차단된 사용자에게 쪽지\"}")
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "6b. A send_message_to_user(B) while blocked -> forbidden"
else
  fail "6b. blocked message was NOT forbidden" "$RESP"
fi

CODE=$(req_code POST "/rpc/unblock_user" "$TOKEN_B" "{\"p_username\":\"$USER_A\"}")
[ "$CODE" = "204" ] || fail "6c. unblock_user by B returned HTTP $CODE"

RESP=$(req POST "/rpc/send_message_to_user" "$TOKEN_A" \
  "{\"p_username\":\"$USER_B\",\"p_content\":\"차단 해제 후 쪽지\"}")
MSG_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -n "$MSG_ID" ]; then
  pass "6c. B unblock_user($USER_A) -> A can message B again ($MSG_ID)"
else
  fail "6c. message still blocked after unblock" "$RESP"
fi

# ------------------------------------------------------------
# 7. visits: record_visit x2 (anon) -> visit_stats today >= 1, total >= prev
# ------------------------------------------------------------
RESP=$(req POST "/rpc/visit_stats" "$SUPABASE_ANON_KEY" '{}')
PREV_TOTAL=$(printf '%s' "$RESP" | grep -oE '"total"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -n 1)
[ -n "$PREV_TOTAL" ] || PREV_TOTAL=0

CODE=$(req_code POST "/rpc/record_visit" "$SUPABASE_ANON_KEY" '{}')
[ "$CODE" = "204" ] || fail "7a. first anon record_visit returned HTTP $CODE"
CODE=$(req_code POST "/rpc/record_visit" "$SUPABASE_ANON_KEY" '{}')
[ "$CODE" = "204" ] || fail "7a. second anon record_visit returned HTTP $CODE"
pass "7a. record_visit x2 (anon) -> 204"

RESP=$(req POST "/rpc/visit_stats" "$SUPABASE_ANON_KEY" '{}')
TODAY=$(printf '%s' "$RESP" | grep -oE '"today"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -n 1)
TOTAL=$(printf '%s' "$RESP" | grep -oE '"total"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -n 1)
if [ -n "$TODAY" ] && [ "$TODAY" -ge 1 ] && [ -n "$TOTAL" ] && [ "$TOTAL" -ge "$PREV_TOTAL" ]; then
  pass "7b. visit_stats today=$TODAY (>=1), total=$TOTAL (>= prev $PREV_TOTAL)"
else
  fail "7b. visit_stats today/total not advancing" "$RESP"
fi

# ------------------------------------------------------------
# 8. cleanup: delete the created post + item; note leftovers
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/delete_post" "$TOKEN_A" "{\"p_id\":\"$POST_ID\"}")
[ "$CODE" = "204" ] && pass "8a. delete_post (cleanup) -> 204" || fail "8a. delete_post cleanup returned HTTP $CODE"

CODE=$(req_code POST "/rpc/delete_item" "$TOKEN_A" "{\"p_id\":\"$ITEM_ID\"}")
# delete_item returns text[] (image paths), so 200 with a JSON array body
if [ "$CODE" = "200" ] || [ "$CODE" = "204" ]; then
  pass "8b. delete_item (cleanup) -> HTTP $CODE"
else
  fail "8b. delete_item cleanup returned HTTP $CODE"
fi

echo ""
echo "NOTE: test post/item deleted in-flow. The deactivated 'testtopic'"
echo "      community and the step-6 message remain (an admin can purge"
echo "      them). Leftover test/admin auth users are left untouched:"
echo "        - $USER_A (${USER_A}@id.koreasg.app)"
echo "        - $USER_B (${USER_B}@id.koreasg.app)"
echo "        - admin ($ADMIN_EMAIL) — intentionally preserved"
echo ""
echo "== ALL V4 SMOKE TESTS PASSED =="
exit 0
