#!/usr/bin/env bash
# ============================================================
# smoke-test-v3.sh — end-to-end smoke test for the v3 features
# (05_messages_likes.sql: 쪽지 / likes / view counts)
#
# Usage:
#   SUPABASE_URL=https://xxxx.supabase.co \
#   SUPABASE_ANON_KEY=eyJ... \
#   [TEST_PREFIX=smoketest] \
#   ./smoke-test-v3.sh
#
# TEST_PREFIX must be lowercase [a-z0-9_] and short enough that
# "<prefix>c<RANDOM>" stays within 20 chars (default: smoketest).
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
# json_build_object output may contain spaces around ':'
json_has() { grep -Eq "\"$1\"[[:space:]]*:[[:space:]]*$2"; }

echo "== SGcommunity v3 smoke test against $SUPABASE_URL =="

USER_C="${TEST_PREFIX}c${RANDOM}"
USER_D="${TEST_PREFIX}d${RANDOM}"

# ------------------------------------------------------------
# 1. sign up users C and D
# ------------------------------------------------------------
RESP=$(signup "$USER_C" "주롱")
TOKEN_C=$(printf '%s' "$RESP" | extract_token)
if [ -n "$TOKEN_C" ]; then
  pass "1a. signed up user C ($USER_C)"
else
  fail "1a. signup for user C returned no access_token (email confirmation enabled?)" "$RESP"
fi

RESP=$(signup "$USER_D" "싱가포르 외")
TOKEN_D=$(printf '%s' "$RESP" | extract_token)
if [ -n "$TOKEN_D" ]; then
  pass "1b. signed up user D ($USER_D)"
else
  fail "1b. signup for user D returned no access_token" "$RESP"
fi

# ------------------------------------------------------------
# 2. C creates a post; D likes it (toggle on -> on view -> toggle off)
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" "$TOKEN_C" \
  '{"p_title":"smoke v3 post","p_content":"smoke v3 content","p_is_anonymous":false}')
POST_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$POST_ID" ]; then
  fail "2a. create_post as C did not return a uuid" "$RESP"
fi
pass "2a. create_post as C ($POST_ID)"

RESP=$(req POST "/rpc/toggle_post_like" "$TOKEN_D" "{\"p_post_id\":\"$POST_ID\"}")
if printf '%s' "$RESP" | json_has "liked" "true" \
   && printf '%s' "$RESP" | json_has "like_count" "1"; then
  pass "2b. toggle_post_like by D -> liked true, like_count 1"
else
  fail "2b. toggle_post_like by D did not return {liked:true, like_count:1}" "$RESP"
fi

RESP=$(req GET "/posts_view?id=eq.$POST_ID" "$SUPABASE_ANON_KEY")
if printf '%s' "$RESP" | json_has "like_count" "1" \
   && printf '%s' "$RESP" | json_has "liked_by_me" "false"; then
  pass "2c. posts_view (anon) shows like_count 1, liked_by_me false"
else
  fail "2c. posts_view (anon) does not show like_count 1 / liked_by_me false" "$RESP"
fi

RESP=$(req POST "/rpc/toggle_post_like" "$TOKEN_D" "{\"p_post_id\":\"$POST_ID\"}")
if printf '%s' "$RESP" | json_has "liked" "false" \
   && printf '%s' "$RESP" | json_has "like_count" "0"; then
  pass "2d. second toggle_post_like -> liked false, like_count 0"
else
  fail "2d. second toggle_post_like did not return {liked:false, like_count:0}" "$RESP"
fi

# ------------------------------------------------------------
# 3. increment_view('post', id) x2 as anon -> view_count >= 1
#    (the 2nd call may be swallowed by the per-caller rate limit)
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/increment_view" "$SUPABASE_ANON_KEY" \
  "{\"p_kind\":\"post\",\"p_id\":\"$POST_ID\"}")
if [ "$CODE" != "204" ]; then
  fail "3. first anon increment_view returned HTTP $CODE (expected 204)"
fi
CODE=$(req_code POST "/rpc/increment_view" "$SUPABASE_ANON_KEY" \
  "{\"p_kind\":\"post\",\"p_id\":\"$POST_ID\"}")
if [ "$CODE" != "204" ]; then
  fail "3. second anon increment_view returned HTTP $CODE (expected 204, even if rate-swallowed)"
fi

RESP=$(req GET "/posts_view?id=eq.$POST_ID" "$SUPABASE_ANON_KEY")
VIEWS=$(printf '%s' "$RESP" | grep -oE '"view_count"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$' | head -n 1)
if [ -n "$VIEWS" ] && [ "$VIEWS" -ge 1 ]; then
  pass "3. increment_view x2 as anon -> posts_view view_count = $VIEWS (>= 1)"
else
  fail "3. posts_view view_count is not >= 1" "$RESP"
fi

# ------------------------------------------------------------
# 4. D messages C via the (non-anonymous) post; C reads / deletes
# ------------------------------------------------------------
RESP=$(req POST "/rpc/send_message_to_post" "$TOKEN_D" \
  "{\"p_post_id\":\"$POST_ID\",\"p_content\":\"쪽지 테스트입니다\"}")
MSG_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$MSG_ID" ]; then
  fail "4a. send_message_to_post did not return a uuid" "$RESP"
fi
pass "4a. send_message_to_post by D ($MSG_ID)"

RESP=$(req GET "/my_messages_view?id=eq.$MSG_ID" "$TOKEN_C")
if ! printf '%s' "$RESP" | grep -q '"direction":"in"'; then
  fail "4b. C's my_messages_view direction is not 'in'" "$RESP"
fi
if ! printf '%s' "$RESP" | grep -q "\"counterpart_username\":\"$USER_D\""; then
  fail "4b. C's my_messages_view counterpart_username is not $USER_D" "$RESP"
fi
if ! printf '%s' "$RESP" | grep -q '"context_title":"smoke v3 post"'; then
  fail "4b. C's my_messages_view context_title is not the post title" "$RESP"
fi
pass "4b. C sees the message: direction in, counterpart $USER_D, context_title = post title"

RESP=$(req POST "/rpc/unread_count" "$TOKEN_C" '{}')
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "1" ]; then
  pass "4c. unread_count as C -> 1"
else
  fail "4c. unread_count as C is not 1" "$RESP"
fi

CODE=$(req_code POST "/rpc/mark_message_read" "$TOKEN_C" "{\"p_id\":\"$MSG_ID\"}")
if [ "$CODE" != "204" ]; then
  fail "4d. mark_message_read as C returned HTTP $CODE"
fi
RESP=$(req POST "/rpc/unread_count" "$TOKEN_C" '{}')
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "0" ]; then
  pass "4d. mark_message_read as C -> unread_count 0"
else
  fail "4d. unread_count after mark_message_read is not 0" "$RESP"
fi

CODE=$(req_code POST "/rpc/delete_message" "$TOKEN_C" "{\"p_id\":\"$MSG_ID\"}")
if [ "$CODE" != "204" ]; then
  fail "4e. delete_message as C (recipient) returned HTTP $CODE"
fi
CODE=$(req_code POST "/rpc/delete_message" "$TOKEN_D" "{\"p_id\":\"$MSG_ID\"}")
if [ "$CODE" != "204" ]; then
  fail "4e. delete_message as D (sender) returned HTTP $CODE"
fi
RESP=$(req GET "/my_messages_view?id=eq.$MSG_ID" "$TOKEN_C")
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "[]" ]; then
  pass "4e. delete_message on both sides -> message gone from C's view"
else
  fail "4e. message still visible after both sides deleted it" "$RESP"
fi

# ------------------------------------------------------------
# 5. anonymous post protects the author: send_message_to_post -> forbidden
# ------------------------------------------------------------
RESP=$(req POST "/rpc/create_post" "$TOKEN_C" \
  '{"p_title":"smoke v3 anon post","p_content":"smoke v3 anon content","p_is_anonymous":true}')
ANON_POST_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -z "$ANON_POST_ID" ]; then
  fail "5. anonymous create_post did not return a uuid" "$RESP"
fi

RESP=$(req POST "/rpc/send_message_to_post" "$TOKEN_D" \
  "{\"p_post_id\":\"$ANON_POST_ID\",\"p_content\":\"익명 글 쪽지 시도\"}")
if printf '%s' "$RESP" | grep -q "forbidden"; then
  pass "5. send_message_to_post on an anonymous post rejected (forbidden)"
else
  fail "5. send_message_to_post on an anonymous post was NOT forbidden" "$RESP"
fi

# ------------------------------------------------------------
# 6. send_message_to_user: to C -> ok; to yourself -> invalid_input
# ------------------------------------------------------------
RESP=$(req POST "/rpc/send_message_to_user" "$TOKEN_D" \
  "{\"p_username\":\"$USER_C\",\"p_content\":\"유저네임으로 보내는 쪽지\"}")
MSG2_ID=$(printf '%s' "$RESP" | extract_uuid)
if [ -n "$MSG2_ID" ]; then
  pass "6a. send_message_to_user($USER_C) by D -> uuid"
else
  fail "6a. send_message_to_user did not return a uuid" "$RESP"
fi

RESP=$(req POST "/rpc/send_message_to_user" "$TOKEN_D" \
  "{\"p_username\":\"$USER_D\",\"p_content\":\"나에게 보내기\"}")
if printf '%s' "$RESP" | grep -q "invalid_input"; then
  pass "6b. self-send rejected (invalid_input)"
else
  fail "6b. self-send was NOT rejected with invalid_input" "$RESP"
fi

# ------------------------------------------------------------
# 7. anon client: my_messages_view blocked; unread_count -> 0
# ------------------------------------------------------------
CODE=$(req_code GET "/my_messages_view" "$SUPABASE_ANON_KEY")
if [ "$CODE" -ge 400 ]; then
  pass "7a. anon GET /my_messages_view blocked (HTTP $CODE)"
else
  RESP=$(req GET "/my_messages_view" "$SUPABASE_ANON_KEY")
  if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "[]" ]; then
    pass "7a. anon GET /my_messages_view returned empty (HTTP $CODE)"
  else
    fail "7a. anon GET /my_messages_view leaked rows (HTTP $CODE)" "$RESP"
  fi
fi

RESP=$(req POST "/rpc/unread_count" "$SUPABASE_ANON_KEY" '{}')
if [ "$(printf '%s' "$RESP" | tr -d '[:space:]')" = "0" ]; then
  pass "7b. anon unread_count -> 0"
else
  fail "7b. anon unread_count is not 0" "$RESP"
fi

# ------------------------------------------------------------
# 8. cleanup: delete the test posts; note leftovers
# ------------------------------------------------------------
CODE=$(req_code POST "/rpc/delete_post" "$TOKEN_C" "{\"p_id\":\"$POST_ID\"}")
if [ "$CODE" = "204" ]; then
  pass "8a. delete_post (cleanup, normal post) -> 204"
else
  fail "8a. delete_post cleanup for normal post returned HTTP $CODE"
fi
CODE=$(req_code POST "/rpc/delete_post" "$TOKEN_C" "{\"p_id\":\"$ANON_POST_ID\"}")
if [ "$CODE" = "204" ]; then
  pass "8b. delete_post (cleanup, anonymous post) -> 204"
else
  fail "8b. delete_post cleanup for anonymous post returned HTTP $CODE"
fi

echo ""
echo "NOTE: test posts were deleted in-flow, but the auth users (and the"
echo "      step-6 message between them; it cascades on user deletion)"
echo "      remain. An admin can purge leftover '${TEST_PREFIX}*' accounts:"
echo "        - $USER_C (${USER_C}@id.koreasg.app)"
echo "        - $USER_D (${USER_D}@id.koreasg.app)"
echo ""
echo "== ALL V3 SMOKE TESTS PASSED =="
exit 0
