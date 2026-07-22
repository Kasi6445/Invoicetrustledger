# Invoice Trust Ledger — E2E evidence index

Final clean run: 2026-07-22 · **16/16 tests passed** (12 API-contract + 1 full
UI lifecycle + 3 real-document scenarios) against the **live Hyperledger Fabric
network** (`LEDGER_MODE=fabric`, chaincode `invoicecc` on `mychannel`).
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
- `04-lloyds-financed.png` — proves Lloyds funded the invoice (`FINANCED`,
  `financedBy: Lloyds Bank`), with the supplier's bank account masked to last-4
  (`••••9876`) and an explainable ledger-derived risk grade shown.
- `05-KILL-SHOT-duplicate-financing-blocked.png` + `otherbank-kill-shot.webm` —
  **the kill shot**: OtherBank's console was opened while the invoice was still
  APPROVED (fund button live — the real race window), Lloyds funded first, and
  OtherBank's stale Fund click was rejected *by the chaincode*:
  red banner "Ledger rejected this transaction · DUPLICATE FINANCING BLOCKED …
  already financed by Lloyds Bank".
- `06-audit-trail-immutable-history.png` — proves the immutable history modal:
  REGISTERED → APPROVED → FINANCED, each entry carrying a real Fabric
  transaction id and timestamp.
- `07-lender-tamper-flag.png` — proves that re-registering the same invoice
  number with a different amount (₹7,50,000 vs ₹5,00,000) permanently stamps a
  `tamperWarning`, and the lender console surfaces the ⚠ tamper flag on the
  altered row.
- Negative assertion (in-test, no screenshot): the full bank account number
  `004512349876` never rendered in any payer/lender view.

## Scenario 2 — Real fixture PDFs, as-is (`tests/real-documents.spec.ts`)

- `R1-ocr-second-layout-INV-2026-014.png` + `real-docs-R1-ocr-hash-proof.webm` —
  proves OCR generalizes to a second, differently-designed invoice layout
  (INV-2026-014, ₹3,25,000), and that the ledger anchored **exactly** the
  SHA-256 of the uploaded file (see hash proof below).
- `R2-duplicate-registration-blocked-real-pdf.png` +
  `real-docs-R2-duplicate-registration-blocked.webm` — proves the ledger refuses
  a second identical registration of the real INV-2026-007 PDF
  ("DUPLICATE REGISTRATION BLOCKED" on screen), and that exactly ONE such
  fingerprint exists on the ledger — ever.
- `R3-tampered-pdf-ocr-inflated-amount.png` — proves OCR read the TAMPERED twin
  PDF (same invoice number, amount inflated to ₹7,50,000) faithfully.
- `R4-lender-tamper-flag-real-tampered-pdf.png` +
  `real-docs-R3-tampered-tamper-flag.webm` — proves the ledger accepted the
  altered resubmission but permanently stamped it
  (`tamperWarning: … previously registered … 500000`), and the lender console
  shows the ⚠ tamper flag on the ₹7,50,000 row.

## Cryptographic doc-integrity proof (`hash-proof.txt`)

sha256 of the uploaded file vs the `docHash` the chaincode anchored on-chain:

```
invoice-clean-INV-2026-014.pdf
  sha256(file) = 6b97d18a892e1a35c88916e2bb9c14109cef46fd2d94d5ff2e49ab7fc38ea894
  docHash on-chain (inv-1784705235870) = 6b97d18a892e1a35c88916e2bb9c14109cef46fd2d94d5ff2e49ab7fc38ea894
  MATCH: YES

invoice-clean-INV-2026-007.pdf
  sha256(file) = 7551a6be169ecf24d54928636878ddbd70b6f9c684c55441c9fe7013d188c1d1
  docHash on-chain (inv-1784696631103) = 7551a6be169ecf24d54928636878ddbd70b6f9c684c55441c9fe7013d188c1d1
  MATCH: YES
```

The INV-2026-007 match is against the registration made during this morning's
manual upload — the same physical file, independently hashed then and now.

## Scenario 3 — API contract (`tests/api-regression.spec.ts`, no browser)

12 direct assertions against the running Fabric-backed API (no screenshots —
the Playwright report is the artifact): auth (401s), REGISTERED shape,
DUPLICATE REGISTRATION BLOCKED (409), role enforcement (403s),
fund-before-approval rejected, APPROVED, FINANCED, **DUPLICATE FINANCING
BLOCKED** (idempotent, for any lender), immutable 3-entry history with txIds,
and field-level RBAC masking for payer / lender / supplier.
