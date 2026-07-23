#!/usr/bin/env bash
# Full business-flow test with PASS/FAIL per step. Server must be running.
# Usage: bash test-flow.sh
# Invoice numbers carry a $RANDOM suffix so the suite is re-runnable against a
# persistent ledger (an invoice number can register only once per supplier).
API=http://localhost:3000
PASS=0; FAIL=0
ok()   { echo "✅ PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ FAIL  $1"; echo "         got: $2"; FAIL=$((FAIL+1)); }
tok()  { curl -s $API/auth/login -H 'Content-Type: application/json' \
           -d "{\"username\":\"$1\",\"password\":\"demo123\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }

echo "— Invoice Trust Ledger flow test —"
ST=$(tok supplier1); PT=$(tok payer1); LT=$(tok lloyds); OT=$(tok otherbank)
[ -n "$ST" ] && [ -n "$PT" ] && [ -n "$LT" ] && [ -n "$OT" ] \
  && ok "all four role logins" || { bad "logins" "empty token"; exit 1; }

NUM="INV-2026-101-$RANDOM"
R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUM\",\"payerName\":\"BigRetail Ltd\",\"amount\":500000,\"requestedAmount\":450000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
ID=$(echo "$R" | sed -n 's/.*"invoiceId":"\([^"]*\)".*/\1/p')
echo "$R" | grep -q '"status":"REGISTERED"' && ok "supplier registers → REGISTERED ($ID)" || bad "register" "$R"

R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUM\",\"payerName\":\"BigRetail Ltd\",\"amount\":750000,\"requestedAmount\":700000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
echo "$R" | grep -q "DUPLICATE INVOICE BLOCKED" && echo "$R" | grep -q "Possible tampered or fake invoice" \
  && ok "re-used number + different amount → DUPLICATE INVOICE BLOCKED + tamper note" || bad "dup number (diff amount)" "$R"

R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUM\",\"payerName\":\"BigRetail Ltd\",\"amount\":500000,\"requestedAmount\":450000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
echo "$R" | grep -q "DUPLICATE INVOICE BLOCKED" && echo "$R" | grep -qv "Possible tampered or fake invoice" \
  && ok "exact re-registration → DUPLICATE INVOICE BLOCKED (no tamper note)" || bad "dup number (same amount)" "$R"

# financing cap: requestedAmount must be <= amount (face value)
NUMCAP="INV-CAP-$RANDOM"
R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUMCAP\",\"payerName\":\"BigRetail Ltd\",\"amount\":500000,\"requestedAmount\":600000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
echo "$R" | grep -q "FINANCING REQUEST REJECTED" \
  && ok "requestedAmount > amount → FINANCING REQUEST REJECTED" || bad "financing cap" "$R"

R=$(curl -s $API/invoices/$ID/fund -X POST -H "Authorization: Bearer $LT")
echo "$R" | grep -q "Only payer-APPROVED" && ok "funding before approval is rejected" || bad "premature fund" "$R"

R=$(curl -s $API/invoices/$ID/approve -X POST -H "Authorization: Bearer $PT")
echo "$R" | grep -q '"status":"APPROVED"' && ok "payer approves → APPROVED" || bad "approve" "$R"

R=$(curl -s $API/invoices/$ID/decline -X POST -H "Authorization: Bearer $OT" \
     -H 'Content-Type: application/json' -d '{"reason":"Outside risk appetite"}')
echo "$R" | grep -q '"declines":\[{' && echo "$R" | grep -q '"by":"OtherBank NBFC"' \
  && echo "$R" | grep -q '"status":"APPROVED"' \
  && ok "OtherBank declines → recorded, status stays APPROVED" || bad "decline" "$R"

R=$(curl -s $API/invoices/$ID/decline -X POST -H "Authorization: Bearer $OT" \
     -H 'Content-Type: application/json' -d '{"reason":"again"}')
echo "$R" | grep -q "has already declined" && ok "second decline by same lender rejected" || bad "double decline" "$R"

R=$(curl -s $API/invoices/$ID/fund -X POST -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"status":"FINANCED"' && ok "Lloyds funds → FINANCED (decline did not block)" || bad "fund" "$R"

R=$(curl -s $API/invoices/$ID/fund -X POST -H "Authorization: Bearer $OT")
echo "$R" | grep -q "DUPLICATE FINANCING BLOCKED" && echo "$R" | grep -q "another financial institution" \
  && echo "$R" | grep -qv "Lloyds" \
  && ok "🎯 KILL SHOT: second lender blocked — competitor name masked" || bad "duplicate fund" "$R"

R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $OT")
echo "$R" | grep -q '"financedBy":"another financial institution"' && echo "$R" | grep -qv "Lloyds" \
  && ok "otherbank read: financedBy masked" || bad "otherbank read" "$R"

R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"financedBy":"Lloyds Bank"' \
  && ok "lloyds read: sees own name as financer" || bad "lloyds read" "$R"

R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $PT")
echo "$R" | grep -q '"financedBy":"Lloyds Bank"' \
  && ok "payer read: sees real lender name" || bad "payer read" "$R"

R=$(curl -s $API/invoices/$ID/history -H "Authorization: Bearer $OT")
echo "$R" | grep -q 'FINANCED' && echo "$R" | grep -qv "Lloyds" \
  && ok "history as otherbank: no competitor name in any record" || bad "otherbank history" "$R"

R=$(curl -s $API/invoices/$ID/history -H "Authorization: Bearer $LT")
echo "$R" | grep -q 'REGISTERED' && echo "$R" | grep -q 'FINANCED' && echo "$R" | grep -q "Lloyds Bank" \
  && ok "history as lloyds: full lifecycle with own name" || bad "lloyds history" "$R"

R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $PT")
echo "$R" | grep -q '••••9876' && echo "$R" | grep -qv '"risk"' && echo "$R" | grep -qv '"requestedAmount"' \
  && ok "payer view: bank last-4, no risk, no requestedAmount" || bad "payer masking" "$R"

# non-funding lender (OtherBank) sees the supplier's bank MASKED
R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $OT")
echo "$R" | grep -q '"grade"' && echo "$R" | grep -q '••••9876' && echo "$R" | grep -qv '004512349876' \
  && ok "non-funding lender: risk grade present, bank last-4" || bad "lender masking (non-funder)" "$R"

# funding lender (Lloyds financed this) — entitlement unlock reveals full bank details
R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"grade"' && echo "$R" | grep -q '004512349876' \
  && ok "funding lender: entitlement unlock reveals supplier bank in full" || bad "lender entitlement unlock" "$R"

# payment-instructions: funder-only, and the 403 must NOT name the funder
PI=$(curl -s -w $'\n%{http_code}' $API/invoices/$ID/payment-instructions -H "Authorization: Bearer $OT")
PICODE=$(echo "$PI" | tail -1); PIBODY=$(echo "$PI" | sed '$d')
[ "$PICODE" = "403" ] && echo "$PIBODY" | grep -qv "Lloyds" && echo "$PIBODY" | grep -q "another institution" \
  && ok "payment-instructions as non-funder → 403, funder not named" || bad "payment-instructions 403" "$PICODE $PIBODY"

PI=$(curl -s $API/invoices/$ID/payment-instructions -H "Authorization: Bearer $LT")
echo "$PI" | grep -q '004512349876' && echo "$PI" | grep -q '"ifsc"' \
  && ok "payment-instructions as funder → 200 full bank details" || bad "payment-instructions 200" "$PI"

# --- similar-invoice detection (API-layer, read-time; flag, never block) ---
SIMA="SIM-A-$RANDOM"; SIMB="SIM-B-$RANDOM"; CTRL="SIM-CTRL-$RANDOM"
RA=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$SIMA\",\"payerName\":\"BigRetail Ltd\",\"amount\":314159,\"requestedAmount\":251327,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
RB=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$SIMB\",\"payerName\":\"BigRetail Ltd\",\"amount\":314159,\"requestedAmount\":251327,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
IDA=$(echo "$RA" | sed -n 's/.*"invoiceId":"\([^"]*\)".*/\1/p')
IDB=$(echo "$RB" | sed -n 's/.*"invoiceId":"\([^"]*\)".*/\1/p')
echo "$RA" | grep -q '"status":"REGISTERED"' && echo "$RB" | grep -q '"status":"REGISTERED"' \
  && ok "similar pair (same supplier/payer/amount, different numbers) both register" || bad "similar pair register" "$RA / $RB"

VA=$(curl -s $API/invoices/$IDA -H "Authorization: Bearer $LT")
VB=$(curl -s $API/invoices/$IDB -H "Authorization: Bearer $LT")
echo "$VA" | grep -q "Similar invoice(s) on ledger" && echo "$VA" | grep -q "$SIMB" \
  && echo "$VB" | grep -q "Similar invoice(s) on ledger" && echo "$VB" | grep -q "$SIMA" \
  && ok "lender sees soft similar flag on both, naming the twin" || bad "soft similar flag" "$VA"

RC=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$CTRL\",\"payerName\":\"BigRetail Ltd\",\"amount\":271828,\"requestedAmount\":217462,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
IDC=$(echo "$RC" | sed -n 's/.*"invoiceId":"\([^"]*\)".*/\1/p')
VC=$(curl -s $API/invoices/$IDC -H "Authorization: Bearer $LT")
SC_A=$(echo "$VA" | sed -n 's/.*"score":\([0-9]*\).*/\1/p')
SC_C=$(echo "$VC" | sed -n 's/.*"score":\([0-9]*\).*/\1/p')
[ -n "$SC_A" ] && [ "$SC_A" = "$SC_C" ] \
  && ok "soft flag is informational only — score/grade unchanged ($SC_A)" || bad "soft flag scoring" "flagged=$SC_A control=$SC_C"

R=$(curl -s $API/invoices/$ID/approve -X POST -H "Authorization: Bearer $LT")
echo "$R" | grep -q "may not do this" && ok "RBAC: lender cannot approve" || bad "rbac" "$R"

R=$(curl -s $API/ledger/verify -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"valid":true' && ok "ledger chain verifies (tamper-evident)" || bad "verify" "$R"

echo "———————————————"
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
