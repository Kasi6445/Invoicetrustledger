#!/usr/bin/env bash
# Full business-flow test with PASS/FAIL per step. Server must be running.
# Usage: bash test-flow.sh
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

NUM="INV-TEST-$RANDOM"
R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUM\",\"payerName\":\"BigRetail Ltd\",\"amount\":500000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
ID=$(echo "$R" | sed -n 's/.*"invoiceId":"\([^"]*\)".*/\1/p')
echo "$R" | grep -q '"status":"REGISTERED"' && ok "supplier registers → REGISTERED ($ID)" || bad "register" "$R"

R=$(curl -s $API/invoices/$ID/fund -X POST -H "Authorization: Bearer $LT")
echo "$R" | grep -q "Only payer-APPROVED" && ok "funding before approval is rejected" || bad "premature fund" "$R"

R=$(curl -s $API/invoices/$ID/approve -X POST -H "Authorization: Bearer $PT")
echo "$R" | grep -q '"status":"APPROVED"' && ok "payer approves → APPROVED" || bad "approve" "$R"

R=$(curl -s $API/invoices/$ID/fund -X POST -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"status":"FINANCED"' && ok "Lloyds funds → FINANCED" || bad "fund" "$R"

R=$(curl -s $API/invoices/$ID/fund -X POST -H "Authorization: Bearer $OT")
echo "$R" | grep -q "DUPLICATE FINANCING BLOCKED" \
  && ok "🎯 KILL SHOT: second lender blocked by the ledger" || bad "duplicate fund" "$R"

R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUM\",\"payerName\":\"BigRetail Ltd\",\"amount\":500000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
echo "$R" | grep -q "DUPLICATE REGISTRATION BLOCKED" && ok "exact re-registration blocked" || bad "dup register" "$R"

R=$(curl -s $API/invoices -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
     -d "{\"invoiceNumber\":\"$NUM\",\"payerName\":\"BigRetail Ltd\",\"amount\":750000,\"currency\":\"INR\",\"dueDate\":\"2026-08-30\"}")
echo "$R" | grep -q "tamperWarning\":\"Invoice number" && ok "altered amount carries tamper flag" || bad "tamper flag" "$R"

R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $PT")
echo "$R" | grep -q '••••9876' && echo "$R" | grep -qv '"risk"' \
  && ok "payer view: bank masked to last-4, risk hidden" || bad "payer masking" "$R"

R=$(curl -s $API/invoices/$ID -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"grade"' && echo "$R" | grep -q '••••9876' \
  && ok "lender view: risk grade present, bank last-4" || bad "lender masking" "$R"

R=$(curl -s $API/invoices/$ID/history -H "Authorization: Bearer $LT")
echo "$R" | grep -q 'REGISTERED' && echo "$R" | grep -q 'FINANCED' \
  && ok "audit trail shows full lifecycle with tx ids" || bad "history" "$R"

R=$(curl -s $API/invoices/$ID/approve -X POST -H "Authorization: Bearer $LT")
echo "$R" | grep -q "may not do this" && ok "RBAC: lender cannot approve" || bad "rbac" "$R"

R=$(curl -s $API/ledger/verify -H "Authorization: Bearer $LT")
echo "$R" | grep -q '"valid":true' && ok "ledger chain verifies (tamper-evident)" || bad "verify" "$R"

echo "———————————————"
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
