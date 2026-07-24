#!/usr/bin/env bash
# Full regression: the 26 business-flow checks (test-flow.sh) PLUS API-hardening
# checks. Server must be running. Usage: bash regression.sh
API=http://localhost:3000
DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
ok()   { echo "✅ PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ FAIL  $1"; echo "         got: $2"; FAIL=$((FAIL+1)); }
tok()  { curl -s $API/auth/login -H 'Content-Type: application/json' \
           -d "{\"username\":\"$1\",\"password\":\"demo123\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }

echo "===== 1/2 · business-flow conformance (test-flow.sh) ====="
bash "$DIR/test-flow.sh"
FLOW_RC=$?
[ $FLOW_RC -eq 0 ] || { echo "regression aborted: baseline flow failed"; exit 1; }

echo ""
echo "===== 2/2 · hardening checks ====="

ST=$(tok supplier1); LT=$(tok lloyds)

# wrong password → 401 Invalid credentials
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" $API/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"supplier1","password":"wrong"}')
[ "$CODE" = "401" ] && grep -q "Invalid credentials" /tmp/itl_body \
  && ok "wrong password → 401 Invalid credentials" || bad "wrong password" "HTTP $CODE $(cat /tmp/itl_body)"

# missing fields on register → 400 with field-level messages
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" $API/invoices \
  -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' -d '{"currency":"GBP"}')
[ "$CODE" = "400" ] && grep -q '"code":"VALIDATION_ERROR"' /tmp/itl_body \
  && grep -q '"invoiceNumber"' /tmp/itl_body && grep -q '"amount"' /tmp/itl_body \
  && ok "missing fields on register → 400 with field messages" || bad "missing-field validation" "HTTP $CODE $(cat /tmp/itl_body)"

# bad amount / bad currency / bad date → 400
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" $API/invoices \
  -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' \
  -d '{"invoiceNumber":"INV-VAL-1","payerName":"Northfield Retail Group plc","amount":-5,"currency":"POUNDS","dueDate":"30-08-2026"}')
[ "$CODE" = "400" ] && grep -q '"amount"' /tmp/itl_body && grep -q '"currency"' /tmp/itl_body \
  && grep -q '"dueDate"' /tmp/itl_body \
  && ok "bad amount/currency/dueDate → 400 with field messages" || bad "format validation" "HTTP $CODE $(cat /tmp/itl_body)"

# garbage token → 401
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" $API/invoices -H "Authorization: Bearer not-a-real-token")
[ "$CODE" = "401" ] && ok "garbage token → 401" || bad "garbage token" "HTTP $CODE $(cat /tmp/itl_body)"

# lender calling approve → 403
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" -X POST $API/invoices/anything/approve -H "Authorization: Bearer $LT")
[ "$CODE" = "403" ] && grep -q "may not do this" /tmp/itl_body \
  && ok "lender calling approve → 403" || bad "role check" "HTTP $CODE $(cat /tmp/itl_body)"

# oversized upload (6 MB) → rejected
# (no ";type=" suffix — Git Bash on Windows mangles it via MSYS path conversion;
#  curl infers application/pdf from the .pdf extension)
head -c 6291456 /dev/zero > /tmp/itl_big.pdf
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" $API/invoices -H "Authorization: Bearer $ST" \
  -F "invoiceNumber=INV-BIG-1" -F "payerName=Northfield Retail Group plc" -F "amount=1000" -F "requestedAmount=900" \
  -F "currency=GBP" -F "dueDate=2026-09-30" -F "invoiceCopy=@/tmp/itl_big.pdf")
[ "$CODE" = "413" ] && grep -q '"code":"UPLOAD_TOO_LARGE"' /tmp/itl_body \
  && ok "oversized file (6MB) → 413 rejected" || bad "oversized upload" "HTTP $CODE $(cat /tmp/itl_body)"

# wrong-type upload → rejected (curl sends .txt as text/plain — not an allowed type)
echo "just text" > /tmp/itl_bad.txt
CODE=$(curl -s -o /tmp/itl_body -w "%{http_code}" $API/invoices -H "Authorization: Bearer $ST" \
  -F "invoiceNumber=INV-TYPE-1" -F "payerName=Northfield Retail Group plc" -F "amount=1000" -F "requestedAmount=900" \
  -F "currency=GBP" -F "dueDate=2026-09-30" -F "invoiceCopy=@/tmp/itl_bad.txt")
[ "$CODE" = "415" ] && grep -q '"code":"UPLOAD_TYPE"' /tmp/itl_body \
  && ok "wrong-type file (.txt) → 415 rejected" || bad "wrong-type upload" "HTTP $CODE $(cat /tmp/itl_body)"

rm -f /tmp/itl_big.pdf /tmp/itl_bad.txt /tmp/itl_body

echo "———————————————"
echo "HARDENING RESULT: $PASS passed, $FAIL failed (plus 26/26 baseline above)"
[ $FAIL -eq 0 ]
