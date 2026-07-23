# Invoice Trust Ledger — E2E evidence index

Final clean run: 2026-07-23 · **24/24 tests passed** (18 API-contract + 1 full
UI lifecycle + 4 real-document scenarios + 1 targeted OCR test) against the
**live Hyperledger Fabric network** (`LEDGER_MODE=fabric`, chaincode `invoicecc`
**v2.0 / sequence 1** on `mychannel`, fresh ledger). Covers the v3 rules **plus
CR01** (multi-document hashes, payer credit profiles, funder-only
payment-instructions entitlement) **plus the pre-demo hardening pass**:
- **invoice copy MANDATORY** — no invoice registers without a real document hash
  (enforced at the ledger, not just the API; the API also fast-fails 400);
- **financing cap tightened to 90%** of face value (was 100%).
See `docs/RULES.md` (R1b, R1c) and `docs/CHANGE-REQUEST-01.md`.

**Gemini is stubbed** in the whole suite (zero live quota): `/ai/extract` is
intercepted with a fixed response. The OCR path is covered by one targeted test
(`R8` below). Real OCR accuracy is a manual demo check.

## Scenario 1 — Full invoice lifecycle (`invoice-lifecycle.spec.ts`)

Video: `full-lifecycle.webm` (main page) + `otherbank-kill-shot.webm` (the
second lender's console). This is the backup demo video, re-recorded against the
CR01 UI.

- `01-supplier-ocr-autofill.png` — supplier register form after uploading the
  invoice copy (the upload anchors the on-chain docHash; form filled).
- `02-supplier-registered.png` — REGISTERED on the Fabric ledger; docHash =
  SHA-256 of the invoice copy; `requestedAmount` persisted.
- `03-payer-approved.png` — payer console Approve → APPROVED (API-verified).
- `04-lloyds-financed.png` — Lloyds funded → FINANCED; the invoice moves to the
  **Funded by me** tab with a disabled `Financed by you` button.
- `05-lloyds-payment-instructions.png` — **CR01 entitlement unlock**: the funder
  (Lloyds) opens the Payment instructions modal and sees the supplier's FULL
  bank account + IFSC. No other lender can.
- `06-KILL-SHOT-duplicate-financing-blocked.png` — **the kill shot**: OtherBank
  (non-funder, still sees the bank MASKED to `••••9876`) clicks its stale Fund
  button and the chaincode rejects it: red banner "LEDGER REJECTED THIS
  TRANSACTION · DUPLICATE FINANCING BLOCKED … another financial institution".
  "Lloyds" appears nowhere on OtherBank's screen (asserted).
- `07-audit-trail-immutable-history.png` — immutable history REGISTERED →
  APPROVED → FINANCED, each with a real Fabric txId + timestamp.
- `08-supplier-duplicate-invoice-blocked.png` — re-registering the same number
  with a different amount is REJECTED live: "DUPLICATE INVOICE BLOCKED …
  Possible tampered or fake invoice."
- Negative (in-test, no shot): the PAYER (never entitled) never sees the full
  bank account.

## Scenario 2 — Real fixture PDFs (`real-documents.spec.ts`)

Forms filled manually (Gemini stubbed); the uploaded file still drives the real
docHash.

- `R1-ocr-second-layout-INV-2026-014.png` — a differently-designed invoice
  (INV-2026-014) registers; on-chain docHash === sha256 of the file (hash proof).
- `R2-duplicate-invoice-blocked-real-pdf.png` — the real INV-2026-007 registered
  twice → the ledger blocks the second registration of the number.
- `R3-tampered-pdf-ocr-inflated-amount.png` — the tampered twin (₹7,50,000, same
  number) at registration.
- `R4-supplier-tampered-resubmission-blocked.png` — that tampered resubmission is
  REJECTED ("Possible tampered or fake invoice.").
- `R5-lender-sees-no-tampered-row.png` — the lender's All tab never shows a
  ₹7,50,000 row for INV-2026-007 (the fake never reached the ledger).
- `R6-same-pdf-new-number-registered.png` — the SAME PDF under a NEW number
  registers (different numbers are legitimate).
- `R7-lender-similar-flag-same-document.png` — but the read-time document-hash
  match flags it: amber ⚠ similar chip + "Same document already registered …
  (−25)" naming the twin.
- `R8-ocr-autofill-wiring.png` — the one targeted OCR test: uploading the invoice
  copy autofills the form from the (stubbed) extraction.

## Cryptographic doc-integrity proof (`hash-proof.txt`)

sha256(file) vs on-chain docHash for the 014 and 007 invoice copies — MATCH: YES.

## Scenario 3 — API contract (`api-regression.spec.ts`, no browser, zero Gemini)

18 direct assertions: auth/roles, REGISTERED shape, DUPLICATE INVOICE BLOCKED
(± tamper note), **FINANCING REQUEST REJECTED** (requestedAmount over the 90%
cap), **register with no invoice copy → 400**,
fund-before-approval, lender decline (no double-decline, doesn't block others),
FINANCED, **DUPLICATE FINANCING BLOCKED** (competitor masked), lender anonymity
on reads + history, immutable history with txIds, and CR01 masking: payer
(no risk/requestedAmount, IFSC masked), non-funding lender (masked bank +
"another financial institution"), funding lender (**entitlement unlock** →
full bank), and **payment-instructions** (funder 200 / non-funder 403 that never
names the funder).
