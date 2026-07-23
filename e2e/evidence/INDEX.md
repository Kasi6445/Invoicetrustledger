# Invoice Trust Ledger — E2E evidence index

Final clean run: 2026-07-23 · **18/18 tests passed** (14 API-contract + 1 full
UI lifecycle + 3 real-document scenarios) against the **live Hyperledger Fabric
network** (`LEDGER_MODE=fabric`, chaincode `invoicecc` on `mychannel`), under
the **v2 rules**: strict single-use invoice numbers (no tamper flag), lender
declines, and lender-to-lender anonymity — see `docs/RULES.md`.
Full machine-readable results: `../playwright-report/` (open with `npm run report`).

## Scenario 1 — Full invoice lifecycle (unique invoice number per run)

Video: `full-lifecycle.webm` — the entire flow below in one continuous recording.

- `01-supplier-ocr-autofill.png` — proves Gemini OCR read the uploaded PDF
  (`invoice-clean-INV-2026-007.pdf`) and autofilled invoice number + amount from
  the document itself.
- `02-supplier-registered.png` — proves the invoice landed on the Fabric ledger
  as `REGISTERED`, with the PDF's SHA-256 anchored on-chain as `docHash`.
- `03-payer-approved.png` — proves the payer console's Approve action moved the
  ledger state to `APPROVED` (verified via API poll, not just UI).
- `04-lloyds-financed.png` — proves Lloyds funded the invoice (`FINANCED`),
  which then appears under the lender console's **Funded by me** tab with a
  disabled `Financed by you` button, the supplier's bank account masked to
  last-4 (`••••9876`) and an explainable ledger-derived risk grade shown.
- `05-KILL-SHOT-duplicate-financing-blocked.png` + `otherbank-kill-shot.webm` —
  **the kill shot**: OtherBank's console was opened while the invoice was still
  APPROVED (fund button live — the real race window), Lloyds funded first, and
  OtherBank's stale Fund click was rejected *by the chaincode*: red banner
  "Ledger rejected this transaction · DUPLICATE FINANCING BLOCKED … already
  financed by **another financial institution**" — and the word "Lloyds"
  appears nowhere on OtherBank's screen (lender anonymity, asserted in-test).
- `06-audit-trail-immutable-history.png` — proves the immutable history modal:
  REGISTERED → APPROVED → FINANCED, each entry carrying a real Fabric
  transaction id and timestamp.
- `07-supplier-duplicate-invoice-blocked.png` — proves the v2 registration
  rule: re-registering the same invoice number with a different amount
  (₹7,50,000 vs ₹5,00,000) is REJECTED live at registration — red banner
  "DUPLICATE INVOICE BLOCKED … Possible tampered or fake invoice." — and the
  lender's All tab shows exactly one row for the number.
- Negative assertion (in-test, no screenshot): the full bank account number
  `004512349876` never rendered in any payer/lender view.

## Scenario 2 — Real fixture PDFs, as-is (`tests/real-documents.spec.ts`)

- `R1-ocr-second-layout-INV-2026-014.png` — proves OCR generalizes to a
  second, differently-designed invoice layout (INV-2026-014, ₹3,25,000), and
  that the ledger anchored **exactly** the SHA-256 of the uploaded file (see
  hash proof below).
- `R2-duplicate-invoice-blocked-real-pdf.png` — proves the ledger refuses a
  second registration of the real INV-2026-007 PDF's invoice number
  ("DUPLICATE INVOICE BLOCKED" on screen), and that exactly ONE registration
  of that number exists on the ledger — ever.
- `R3-tampered-pdf-ocr-inflated-amount.png` — proves OCR read the TAMPERED twin
  PDF (same invoice number, amount inflated to ₹7,50,000) faithfully.
- `R4-supplier-tampered-resubmission-blocked.png` — proves the tampered
  resubmission is REJECTED at registration under the single-use rule, with the
  "Possible tampered or fake invoice." warning in the ledger's own message.
- `R5-lender-sees-no-tampered-row.png` — proves the lender console (All tab)
  never shows a ₹7,50,000 row for INV-2026-007: the fake never reached the
  ledger at all.

## Cryptographic doc-integrity proof (`hash-proof.txt`)

sha256 of the uploaded file vs the `docHash` the chaincode anchored on-chain —
regenerated this run, both files MATCH: YES.

## Scenario 3 — API contract (`tests/api-regression.spec.ts`, no browser)

14 direct assertions against the running Fabric-backed API (no screenshots —
the Playwright report is the artifact): auth (401s), REGISTERED shape,
DUPLICATE INVOICE BLOCKED (409, with and without the tampered-or-fake note),
role enforcement (403s), fund-before-approval rejected, APPROVED, lender
decline (recorded, status unchanged, no double-decline, doesn't block funding),
FINANCED, **DUPLICATE FINANCING BLOCKED** (idempotent, competitor name masked),
lender anonymity on reads + history ("another financial institution", foreign
decline reasons stripped, payer/supplier see real names), immutable 3-entry
history with txIds, and field-level RBAC masking for payer / lender / supplier.
