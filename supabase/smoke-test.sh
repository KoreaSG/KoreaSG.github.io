#!/usr/bin/env bash
# ============================================================
# smoke-test.sh — end-to-end smoke test for the Supabase backend
# (Supabase Auth account flows)
#
# Usage:
#   SUPABASE_URL=https://xxxx.supabase.co \
#   SUPABASE_ANON_KEY=eyJ... \
#   [TEST_PREFIX=smoketest] \
#   ./smoke-test.sh
#
# TEST_PREFIX must be lowercase [a-z0-9_] and short enough that
# "<prefix>a<RANDOM>" stays within 20 chars (default: smoketest).
#
# NOTE: email confirmation must be DISABLED in Supabase Auth so that
# POST /auth/v1/signup returns an access_token directly for the
# synthetic @id.koreasg.app addresses.
#
# Echoes PASS/FAIL per step; exits 1 on the first failure.
# Only needs curl + grep (no jq).
# ============================================================
set -u

: "${SUPABASE_URL:?SUPABASE_URL env var is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY env var is required}"
TEST_PREFIX="${TEST_PREFIX:-smoketest}"

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

extract_uuid()  { grep -oE "$UUID_RE" | head -n 1; }
extract_token() { grep -o '"access_token":"[^"]*"' | head -n 1 | cut -d'"' -f4; }

echo "== SGcommunity smoke test against $SUPABASE_URL =="

USER_A="${TEST_PREFIX}a${RANDOM}"
USER_B="${TEST_PREFIX}b${RANDOM}"

# ------------------------------------------------------------
# 1. sign up user A (region 주롱) -> access_token
# ------------------------------------------------------------
RESP=$(signup "$USER_A" "주롱")
TOKEN_A=$(printf '%s' "$RESP" | extract_token)
if [ -n "$TOKEN_A" ]; then
  pass "1. signed up user A ($USER_A)"
else
  fail "1. signup for user A returned no access_token (email confirmation enabled?)" "$RESP"
fi

# ------------------------------------------------------------
# 2. sign up user B (region 싱가포르 외) -> access_token
# ------------------------------------------------------------
RESP=$(signup "$USER_B" "싱가포르 외")
TOKEN_B=$(printf '%s' "$RESP" | extract_token)
if [ -n "$TOKEN_B" ]; then
  pass "2. signed up user B ($USER_B)"
else
  fail "2. signup for user B returned no access_token" "$RESP"
fi

# ------------------------------------------------------------
# 3. as A: create_post (not anonymous) -> uuid; posts_view shows
#    author_display = A's username and never leaks password/user_id
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" "$TOKEN_A" \
  '{"p_title":"smoke test post","p_content":"smoke test content","p_is_anonymous":false}')
POST_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$POST_ID" ]; then
  fail "3. create_post did not return a uuid" "$RESP"
fi

RESP=$(req GET "/posts_view?id=eq.$POST_ID" "$SUPABASE_ANON_KEY")
if ! printf '%s' "$RESP" | grep -q "\"author_display\":\"$USER_A\""; then
  fail "3. posts_view author_display is not user A's username" "$RESP"
fi
if printf '%s' "$RESP" | grep -q "password"; then
  fail "3. posts_view LEAKS a password column" "$RESP"
fi
if printf '%s' "$RESP" | grep -q '"user_id"'; then
  fail "3. posts_view LEAKS user_id" "$RESP"
fi
pass "3. create_post as A ($POST_ID); author_display = $USER_A, no password/user_id"

# ------------------------------------------------------------
# 4. as A: anonymous post -> author_display = 익명, no username leakage
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" "$TOKEN_A" \
  '{"p_title":"smoke anon post","p_content":"smoke anon content","p_is_anonymous":true}')
ANON_POST_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$ANON_POST_ID" ]; then
  fail "4. anonymous create_post did not return a uuid" "$RESP"
fi

RESP=$(req GET "/posts_view?id=eq.$ANON_POST_ID" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | grep -q "$USER_A"; then
  fail "4. anonymous post LEAKS the author's username" "$RESP"
fi
if ! printf '%s' "$RESP" | grep -q '"author_display":"익명"'; then
  fail "4. anonymous post author_display is not 익명" "$RESP"
fi
pass "4. anonymous post shows author_display = 익명 and no username"

# ------------------------------------------------------------
# 5. as B: update_post on A's post -> forbidden
# ------------------------------------------------------------
RESP=$(req POST "/rpc/update_post" "$TOKEN_B" \
  "{\"p_id\":\"$POST_ID\",\"p_title\":\"hacked\",\"p_content\":\"hacked\",\"p_is_anonymous\":false}")
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "5. update_post by non-owner rejected (forbidden)"
else
  fail "5. update_post by non-owner did not return forbidden" "$RESP"
fi

# ------------------------------------------------------------
# 6. anonymous client (anon key only): create_post -> blocked
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" "$SUPABASE_ANON_KEY" \
  '{"p_title":"anon attempt","p_content":"anon attempt"}')
CODE=$(req_code POST "/rpc/create_post" "$SUPABASE_ANON_KEY" \
  '{"p_title":"anon attempt","p_content":"anon attempt"}')
if printf '%s' "$RESP" | grep -q "auth_required" || [ "$CODE" -ge 400 ]; then
  pass "6. anonymous create_post blocked (HTTP $CODE)"
else
  fail "6. anonymous create_post was NOT blocked (HTTP $CODE)" "$RESP"
fi

# ------------------------------------------------------------
# 7. as A: update_post own -> 204; delete_post own -> 204
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/update_post" "$TOKEN_A" \
  "{\"p_id\":\"$POST_ID\",\"p_title\":\"smoke test post (edited)\",\"p_content\":\"edited content\",\"p_is_anonymous\":false}")
if [ "$CODE" = "204" ]; then
  pass "7a. update_post own post -> 204"
else
  fail "7a. update_post own post returned HTTP $CODE"
fi

CODE=$(req_code POST "/rpc/delete_post" "$TOKEN_A" "{\"p_id\":\"$POST_ID\"}")
if [ "$CODE" = "204" ]; then
  pass "7b. delete_post own post -> 204"
else
  fail "7b. delete_post own post returned HTTP $CODE"
fi

CODE=$(req_code POST "/rpc/delete_post" "$TOKEN_A" "{\"p_id\":\"$ANON_POST_ID\"}")
if [ "$CODE" = "204" ]; then
  pass "7c. delete_post own anonymous post (cleanup) -> 204"
else
  fail "7c. delete_post own anonymous post returned HTTP $CODE"
fi

# ------------------------------------------------------------
# 8. as A: create_item -> uuid; items_view shows seller_username + region
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_item" "$TOKEN_A" \
  '{"p_title":"smoke item","p_category":"기타","p_price":1000,"p_description":"smoke item description"}')
ITEM_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$ITEM_ID" ]; then
  fail "8. create_item did not return a uuid" "$RESP"
fi

RESP=$(req GET "/items_view?id=eq.$ITEM_ID" "$SUPABASE_ANON_KEY")
if ! printf '%s' "$RESP" | grep -q "\"seller_username\":\"$USER_A\""; then
  fail "8. items_view seller_username is not user A's username" "$RESP"
fi
if ! printf '%s' "$RESP" | grep -q '"seller_region":"주롱"'; then
  fail "8. items_view seller_region is not 주롱" "$RESP"
fi
pass "8. create_item as A ($ITEM_ID); items_view shows seller_username + seller_region"

# ------------------------------------------------------------
# 9. as B: delete_item A's item -> forbidden; as A -> 200
# ------------------------------------------------------------
RESP=$(req POST "/rpc/delete_item" "$TOKEN_B" "{\"p_id\":\"$ITEM_ID\"}")
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "9a. delete_item by non-owner rejected (forbidden)"
else
  fail "9a. delete_item by non-owner did not return forbidden" "$RESP"
fi

CODE=$(req_code POST "/rpc/delete_item" "$TOKEN_A" "{\"p_id\":\"$ITEM_ID\"}")
# delete_item returns text[] (image paths), so PostgREST answers 200
if [ "$CODE" = "200" ]; then
  pass "9b. delete_item by owner -> 200 (returned image_paths)"
else
  fail "9b. delete_item by owner returned HTTP $CODE"
fi

# ------------------------------------------------------------
# 10. username_available: taken -> false, fresh -> true
# ------------------------------------------------------------
RESP=$(req POST "/rpc/username_available" "$SUPABASE_ANON_KEY" "{\"p_username\":\"$USER_A\"}")
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "false" ]; then
  pass "10a. username_available($USER_A) -> false (taken)"
else
  fail "10a. username_available for a taken username did not return false" "$RESP"
fi

FRESH="${TEST_PREFIX}f${RANDOM}"
RESP=$(req POST "/rpc/username_available" "$SUPABASE_ANON_KEY" "{\"p_username\":\"$FRESH\"}")
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "true" ]; then
  pass "10b. username_available($FRESH) -> true (fresh)"
else
  fail "10b. username_available for a fresh username did not return true" "$RESP"
fi

# ------------------------------------------------------------
# 11. direct GET /profiles with anon key -> blocked
# ------------------------------------------------------------
CODE=$(req_code GET "/profiles" "$SUPABASE_ANON_KEY")
if [ "$CODE" -ge 400 ]; then
  pass "11. direct GET /profiles blocked (HTTP $CODE)"
else
  RESP=$(req GET "/profiles" "$SUPABASE_ANON_KEY")
  fail "11. direct GET /profiles was NOT blocked (HTTP $CODE)" "$RESP"
fi

# ------------------------------------------------------------
# 12. cleanup note
# ------------------------------------------------------------
echo ""
echo "NOTE: test posts/items were deleted in-flow, but the auth users remain."
echo "      An admin can purge leftover '${TEST_PREFIX}*' test accounts later:"
echo "        - $USER_A (${USER_A}@id.koreasg.app)"
echo "        - $USER_B (${USER_B}@id.koreasg.app)"
echo ""
echo "== ALL SMOKE TESTS PASSED =="
exit 0
