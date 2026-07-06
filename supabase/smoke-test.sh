#!/usr/bin/env bash
# ============================================================
# smoke-test.sh — end-to-end smoke test for the Supabase backend
#
# Usage:
#   SUPABASE_URL=https://xxxx.supabase.co \
#   SUPABASE_ANON_KEY=eyJ... \
#   ./smoke-test.sh
#
# Echoes PASS/FAIL per step; exits 1 on the first failure.
# Only needs curl + grep (no jq).
# ============================================================
set -u

: "${SUPABASE_URL:?SUPABASE_URL env var is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY env var is required}"

BASE="${SUPABASE_URL%/}/rest/v1"
UUID_RE='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  if [ "$#" -gt 1 ]; then echo "      response: $2"; fi
  exit 1
}

# req METHOD PATH [JSON_BODY]  -> prints response body
# Body is sent via stdin (--data-binary @-): Windows curl corrupts non-ASCII
# UTF-8 passed as a command-line argument.
req() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    printf '%s' "$data" | curl -s -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      --data-binary @-
  else
    curl -s -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json"
  fi
}

# req_code METHOD PATH [JSON_BODY]  -> prints HTTP status code only
req_code() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    printf '%s' "$data" | curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json" \
      --data-binary @-
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "apikey: $SUPABASE_ANON_KEY" \
      -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
      -H "Content-Type: application/json"
  fi
}

extract_uuid() { grep -oE "$UUID_RE" | head -n 1; }

echo "== SGcommunity smoke test against $SUPABASE_URL =="

# ------------------------------------------------------------
# 1. create_post -> expect uuid
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" \
  '{"p_title":"smoke test post","p_content":"smoke test content","p_password":"1234"}')
POST_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -n "$POST_ID" ]; then
  pass "1. create_post returned uuid ($POST_ID)"
else
  fail "1. create_post did not return a uuid" "$RESP"
fi

# ------------------------------------------------------------
# 2. posts_view has the row, and never leaks password_hash
# ------------------------------------------------------------
RESP=$(req GET "/posts_view?id=eq.$POST_ID")
if ! printf '%s' "$RESP" | grep -q "$POST_ID"; then
  fail "2. posts_view does not contain the created post" "$RESP"
fi
if printf '%s' "$RESP" | grep -q "password_hash"; then
  fail "2. posts_view LEAKS password_hash" "$RESP"
fi
pass "2. posts_view returns the post without password_hash"

# ------------------------------------------------------------
# 3. update_post with WRONG password -> error contains wrong_password
# ------------------------------------------------------------
RESP=$(req POST "/rpc/update_post" \
  "{\"p_id\":\"$POST_ID\",\"p_password\":\"9999\",\"p_title\":\"hacked\",\"p_content\":\"hacked\"}")
if printf '%s' "$RESP" | grep -q "wrong_password"; then
  pass "3. update_post rejected wrong password (wrong_password)"
else
  fail "3. update_post wrong password did not return wrong_password" "$RESP"
fi

# ------------------------------------------------------------
# 4. update_post with correct password -> 204
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/update_post" \
  "{\"p_id\":\"$POST_ID\",\"p_password\":\"1234\",\"p_title\":\"smoke test post (edited)\",\"p_content\":\"edited content\"}")
if [ "$CODE" = "204" ]; then
  pass "4. update_post with correct password -> 204"
else
  fail "4. update_post with correct password returned HTTP $CODE"
fi

# ------------------------------------------------------------
# 5. add_post_comment -> uuid; delete_post_comment with post owner pw -> 204
# ------------------------------------------------------------
RESP=$(req POST "/rpc/add_post_comment" \
  "{\"p_post_id\":\"$POST_ID\",\"p_author_name\":\"smoker\",\"p_content\":\"smoke comment\"}")
COMMENT_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$COMMENT_ID" ]; then
  fail "5. add_post_comment did not return a uuid" "$RESP"
fi
CODE=$(req_code POST "/rpc/delete_post_comment" \
  "{\"p_id\":\"$COMMENT_ID\",\"p_password\":\"1234\"}")
if [ "$CODE" = "204" ]; then
  pass "5. add_post_comment + delete_post_comment (owner moderation) -> 204"
else
  fail "5. delete_post_comment with post owner password returned HTTP $CODE"
fi

# ------------------------------------------------------------
# 6. delete_post with correct password -> 204
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/delete_post" \
  "{\"p_id\":\"$POST_ID\",\"p_password\":\"1234\"}")
if [ "$CODE" = "204" ]; then
  pass "6. delete_post with correct password -> 204"
else
  fail "6. delete_post returned HTTP $CODE"
fi

# ------------------------------------------------------------
# 7. direct table access must fail (read and write)
# ------------------------------------------------------------
CODE=$(req_code GET "/posts")
if [ "$CODE" -ge 400 ]; then
  pass "7a. direct GET /posts blocked (HTTP $CODE)"
else
  RESP=$(req GET "/posts")
  fail "7a. direct GET /posts was NOT blocked (HTTP $CODE)" "$RESP"
fi

CODE=$(req_code POST "/posts" \
  '{"title":"direct insert","content":"nope","password_hash":"x"}')
if [ "$CODE" -ge 400 ]; then
  pass "7b. direct POST /posts blocked (HTTP $CODE)"
else
  fail "7b. direct POST /posts was NOT blocked (HTTP $CODE)"
fi

# ------------------------------------------------------------
# 8. honeypot: create_post with p_website -> fake uuid, nothing stored
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" \
  '{"p_title":"spam post","p_content":"spam content","p_password":"1234","p_website":"http://spam"}')
SPAM_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$SPAM_ID" ]; then
  fail "8. honeypot create_post did not return a uuid" "$RESP"
fi
RESP=$(req GET "/posts_view?id=eq.$SPAM_ID")
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "[]" ]; then
  pass "8. honeypot returned fake uuid and stored nothing"
else
  fail "8. honeypot post appears in posts_view" "$RESP"
fi

# ------------------------------------------------------------
# 9. items round-trip: create_item -> items_view -> delete_item
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_item" \
  '{"p_title":"smoke item","p_category":"기타","p_price":1000,"p_description":"smoke item description","p_password":"1234"}')
ITEM_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$ITEM_ID" ]; then
  fail "9a. create_item did not return a uuid" "$RESP"
fi
pass "9a. create_item returned uuid ($ITEM_ID)"

RESP=$(req GET "/items_view?id=eq.$ITEM_ID")
if printf '%s' "$RESP" | grep -q "$ITEM_ID" && ! printf '%s' "$RESP" | grep -q "password_hash"; then
  pass "9b. items_view returns the item without password_hash"
else
  fail "9b. items_view missing item or leaking password_hash" "$RESP"
fi

CODE=$(req_code POST "/rpc/delete_item" \
  "{\"p_id\":\"$ITEM_ID\",\"p_password\":\"1234\"}")
# delete_item returns text[] (image paths), so PostgREST answers 200
if [ "$CODE" = "200" ]; then
  pass "9c. delete_item with correct password -> 200 (returned image_paths)"
else
  fail "9c. delete_item returned HTTP $CODE"
fi

echo "== ALL SMOKE TESTS PASSED =="
exit 0
