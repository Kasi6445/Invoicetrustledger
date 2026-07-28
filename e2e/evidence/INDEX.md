# Invoice Trust Ledger — E2E evidence index

Final clean run: 2026-07-28 · **26/26 tests passed** (20 API-contract + 1 full
UI lifecycle + 4 real-document scenarios + 1 targeted OCR test) against the
**live Hyperledger Fabric network** (`LEDGER_MODE=fabric`, chaincode `invoicecc`
**v3.0 / sequence 1** on `mychannel`, fresh ledger). Now on the **v4 UK/Lloyds
localisation** (GBP, Companies House CRN, Pennine Textiles / Northfield Retail
Group plc / Lloyds Bank Commercial Banking / Meridian Invoice Finance Ltd). Covers the v3 rules **plus
CR01** (multi-document hashes, payer credit profiles, funder-only
payment-instructions entitlement) **plus the pre-demo hardening pass**:
- **invoice copy MANDATORY** — no invoice registers without a real document hash
  (enforced at the ledger, not just the API; the API also fast-fails 400);
- **financing cap tightened to 90%** of face value (was 100%).

**Plus CR02 — supplier-controlled lender visibility.** The supplier picks which
funders an invoice is offered to, and a lender's queue holds only what was
applied to them (plus anything they financed). This is an APP-LAYER filter on
what a lender is *shown*: one invoice is still one ledger record, which is
exactly what lets the ledger catch the second funder. **No chaincode, ledger or
risk rule changed** — CR02 touches no rule implementation. It also makes the
payer's `requestedAmount` visible (the advance sought against an invoice they
are asked to confirm) and makes a dispute reason mandatory.

Note when reading these shots: an invoice registered with **no funder chosen
reaches no lender queue**. The seed applies its invoices for you; the specs that
need a lender to see an ad-hoc registration apply explicitly.

See `docs/RULES.md` (R1b, R1c) and `docs/CHANGE-REQUEST-01.md`.

**Gemini is stubbed** in the whole suite (zero live quota): `/ai/extract` is
intercepted with a fixed response. The OCR path is covered by one targeted test
(`R8` below). Real OCR accuracy is a manual demo check.

## Scenario 1 — Full invoice lifecycle (`invoice-lifecycle.spec.ts`)

Video: `full-lifecycle.webm` (main page) + `otherbank-kill-shot.webm` (the
second lender's console). This is the backup demo video, re-recorded against the
CR01 UI.

- `01-supplier-ocr-autofill.png` — supplier register form after uploading the
  invoice copy (the upload anchors the on-chain docHash; form filled). **CR02**:
  the form also carries the funder picker — *"Submit financing request to"* —
  where the supplier chooses which lenders may see the invoice.
- `02-supplier-registered.png` — REGISTERED on the Fabric ledger; docHash =
  SHA-256 of the invoice copy; `requestedAmount` persisted. **CR02**: the
  supplier's own table adds a **Submitted to** column (a chip per funder the
  invoice was applied to) beside the new **Requested** column.
- `03-payer-approved.png` — payer console Approve → APPROVED (API-verified).
- `04-lloyds-financed.png` — Lloyds funded → FINANCED; the invoice moves to the
  **Funded by me** tab with a disabled `Financed by me` button.
- `05-lloyds-payment-instructions.png` — **CR01 entitlement unlock**: the funder
  (Lloyds) opens the Payment instructions modal and sees the supplier's FULL
  bank account + sort code. No other lender can.
- `06-KILL-SHOT-duplicate-financing-blocked.png` — **the kill shot**: Meridian
  (non-funder, still sees the bank MASKED to `••••5678`) clicks its stale Fund
  button and the chaincode rejects it: red banner "LEDGER REJECTED THIS
  TRANSACTION · DUPLICATE FINANCING BLOCKED … another financial institution".
  The assertion is the **absence** of "Lloyds" anywhere on Meridian's screen —
  never the presence of a particular euphemism, so re-wording the mask cannot
  fake a pass. (Video file keeps its original name, `otherbank-kill-shot.webm`.)
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
- `R3-tampered-pdf-ocr-inflated-amount.png` — the tampered twin (£750,000, same
  number) at registration.
- `R4-supplier-tampered-resubmission-blocked.png` — that tampered resubmission is
  REJECTED ("Possible tampered or fake invoice.").
- `R5-lender-sees-no-tampered-row.png` — the lender's All tab never shows a
  £750,000 row for INV-2026-007 (the fake never reached the ledger). **CR02**:
  "All" now means all invoices *applied to this lender*, so the spec applies the
  genuine invoice to Lloyds first — otherwise the row would be absent for the
  uninteresting reason that Lloyds was never offered it.
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

20 direct assertions: auth/roles, REGISTERED shape, DUPLICATE INVOICE BLOCKED
(± tamper note), **FINANCING REQUEST REJECTED** (requestedAmount over the 90%
cap), **register with no invoice copy → 400**, **document integrity verify**
(recomputed hash matches the ledger anchor; a tampered on-disk file is caught),
**Companies House supplier check** (register status, cached-snapshot fallback),
fund-before-approval, lender decline (no double-decline, doesn't block others),
FINANCED, **DUPLICATE FINANCING BLOCKED** (competitor masked), lender anonymity
on reads + history, immutable history with txIds, and CR01 masking: payer
(no risk, sort code masked — `requestedAmount` **is** visible since CR02),
non-funding lender (masked bank +
"another financial institution"), funding lender (**entitlement unlock** →
full bank), and **payment-instructions** (funder 200 / non-funder 403 that never
names the funder).
