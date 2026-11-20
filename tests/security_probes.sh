#!/bin/sh
# POST-DEPLOY security probes against a STAGING project. Uses only PUBLIC values + test-user tokens.
#   SUPABASE_URL=https://<ref>.supabase.co ANON_KEY=<anon> PLAYER_JWT=<access_token of an ORDINARY test player> \
#   PLAYER_ID=<that player's uuid> sh tests/security_probes.sh
# STATUS: written but NOT executed. Never run with the admin's token or live keys.
: "${SUPABASE_URL:?}" "${ANON_KEY:?}" "${PLAYER_JWT:?}" "${PLAYER_ID:?}"
fail=0
probe() { # name expected(regex of allowed codes) method path auth body
  name=$1; allow=$2; method=$3; path=$4; auth=$5; body=$6
  code=$(curl -s -o /tmp/probe.out -w '%{http_code}' -X "$method" "$SUPABASE_URL$path" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $auth" -H "Content-Type: application/json" ${body:+-d "$body"})
  if echo "$code" | grep -Eq "^($allow)$"; then echo "PASS  $name ($code)"; else echo "FAIL  $name (got $code, wanted $allow): $(head -c 160 /tmp/probe.out)"; fail=1; fi
}
CREATE='{"p_title":"Probe","p_description":"","p_prize_title":"x1","p_prize_description":"x2","p_prize_image_url":null,"p_prize_value_ngn":0,"p_entry_fee_coins":1,"p_target_players":2,"p_games":["chess"],"p_publish":true,"p_prize_coins":0}'
# --- anonymous ---
probe "anon cannot read wallets"            "401|403" GET  "/rest/v1/dg_wallets?select=*" "$ANON_KEY"
probe "anon cannot read admins table"       "401|403" GET  "/rest/v1/dg_admins?select=*" "$ANON_KEY"
probe "anon cannot create tournaments"      "401|403|404" POST "/rest/v1/rpc/dg_admin_create_tournament" "$ANON_KEY" "$CREATE"
probe "anon cannot credit coins"            "401|403|404" POST "/rest/v1/rpc/dg_credit_purchase" "$ANON_KEY" '{"p_tx_ref":"x","p_flw_id":"1","p_amount":1,"p_currency":"NGN"}'
# --- ordinary player ---
probe "player cannot edit wallet balance"   "401|403|404" PATCH "/rest/v1/dg_wallets?user_id=eq.$PLAYER_ID" "$PLAYER_JWT" '{"available_coins":999999}'
probe "player cannot insert ledger rows"    "401|403" POST "/rest/v1/dg_wallet_ledger" "$PLAYER_JWT" '{"user_id":"'$PLAYER_ID'","entry_type":"purchase","available_delta":1,"available_after":1,"escrow_after":0,"idempotency_key":"probe"}'
probe "player cannot insert tournaments"    "401|403" POST "/rest/v1/dg_tournaments" "$PLAYER_JWT" '{"slug":"probe","title":"Probe"}'
probe "player cannot call admin create"     "400|401|403" POST "/rest/v1/rpc/dg_admin_create_tournament" "$PLAYER_JWT" "$CREATE"
probe "player cannot call credit_purchase"  "401|403|404" POST "/rest/v1/rpc/dg_credit_purchase" "$PLAYER_JWT" '{"p_tx_ref":"x","p_flw_id":"1","p_amount":1,"p_currency":"NGN"}'
probe "player cannot call save_game"        "401|403|404" POST "/rest/v1/rpc/dg_system_save_game" "$PLAYER_JWT" '{}'
probe "player cannot read match secrets"    "401|403" GET  "/rest/v1/dg_match_secrets?select=*" "$PLAYER_JWT"
probe "player cannot approve results"       "400|401|403|404" POST "/rest/v1/rpc/dg_admin_approve_result" "$PLAYER_JWT" '{"p_match_id":"00000000-0000-0000-0000-000000000000","p_winner":"'$PLAYER_ID'"}'
# --- edge functions ---
probe "webhook rejects missing hash"        "401" POST "/functions/v1/flutterwave-webhook" "$ANON_KEY" '{"event":"charge.completed","data":{"id":1,"tx_ref":"x"}}'
probe "checkout init requires a user JWT"   "401" POST "/functions/v1/flutterwave-init" "$ANON_KEY" '{"amount":1000}'
probe "game-action requires a user JWT"     "401" POST "/functions/v1/game-action" "$ANON_KEY" '{}'
# --- data minimisation: a player must see only their own wallet row ---
n=$(curl -s "$SUPABASE_URL/rest/v1/dg_wallets?select=user_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $PLAYER_JWT" | grep -o user_id | wc -l)
[ "$n" -le 1 ] && echo "PASS  player sees at most their own wallet ($n row)" || { echo "FAIL  player sees $n wallets"; fail=1; }
# --- drafts hidden from anonymous visitors ---
curl -s "$SUPABASE_URL/rest/v1/dg_tournaments?select=status&status=eq.draft" -H "apikey: $ANON_KEY" | grep -q draft \
  && { echo "FAIL  anonymous can see draft tournaments"; fail=1; } || echo "PASS  drafts are hidden from anonymous visitors"
exit $fail
