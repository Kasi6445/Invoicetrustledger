# Change Request 01 — Role Data Model (as built)

This is the reconciled record of CR01 **as actually implemented**. The original
CR was written against a pre-v2 snapshot of the repo; where its literal wording
conflicted with the shipped v2/v3 code, we kept the v3 semantics and implemented
the CR's *intent*. This document is the source of truth; the original ticket's
stale wording is captured in the deviation table below so it can be corrected.

## What CR01 added

- **Financing cap** (chaincode + mockLedger): `requestedAmount` must be `> 0` and
  `<= amount` (face value), else `FINANCING REQUEST REJECTED`. Not partial
  financing — still exactly one `FundInvoice` per invoice; R5 still blocks a
  second financing.
- **Document hashes**: `RegisterInvoice` takes a `docHashes` JSON string of
  `{ invoiceCopy, purchaseOrder, goodsReceived }` SHA-256s, parsed defensively;
  stored as `docs`; `docHash` kept as `docs.invoiceCopy || 'no-document'`. Goods
  description is off-chain narrative only.
- **Off-chain**: `payerProfiles` (BigRetail Ltd: terms/rating/programme
  limit/settlement account); supplier `sortCode` → `ifsc` + `bankName`; nested
  `docs` map.
- **Masking / RBAC**: `maskForRole(invoice, supplierProfile, payerProfile, role,
  viewerName)`. Payer loses `risk`, `requestedAmount`, `payerProfile`; supplier
  bank last-4 + IFSC masked, KYC restricted. Lender gets full `payerProfile` and
  risk; supplier bank/IFSC masked **unless this lender funded the invoice**
  (entitlement unlock, evaluated on the raw invoice **before** anonymity). v2/v3
  lender anonymity and the similar-invoice flag survive intact.
- **API**: multi-file upload; `GET /invoices/:id/doc/:type` (whitelisted,
  traversal-guarded); `GET /invoices/:id/payment-instructions` (funder-only; the
  403 never names the funder, so it can't be used as an oracle).
- **Risk**: advance-ratio and payer-terms signals; weights sum to 100; grades
  **A≥78 / B≥55 / C**, with a **structural cap: an unrated payer can never grade
  A (capped at B)** — this is why MegaMart grades B, deliberately, not because of
  a one-point margin.
- **Portal**: supplier requested-amount (client check) + three file inputs (only
  the invoice copy runs OCR) + goods description; payer goods summary + document
  viewer; lender payer-terms column + funder-only payment-instructions modal. The
  red `LEDGER REJECTED` banner is unchanged.

Full rules: `docs/RULES.md` (R1b, R1c, and the role/field matrix).

## Deviations from the CR's literal text

| CR clause | Literal text | As built | Why |
|---|---|---|---|
| §0/§2 | edit `api/fabric.js` / `mockLedger()` | rules mirrored in `api/mockLedger.js` behind `api/ledger.js` | no `fabric.js` in this repo |
| §7 test 2 | duplicate → `DUPLICATE REGISTRATION BLOCKED` | `DUPLICATE INVOICE BLOCKED` | v2 renamed it; intent (register twice → blocked) met |
| §1.3 | `_fingerprint` is the dedup guard | left `_fingerprint` unchanged; real guard is the `NUM_` key | v2 moved dedup to per-supplier number key; guard not weakened |
| §4 | `maskForRole(invoice, supplierProfile, payerProfile, role)` | added 5th arg `viewerName` | required by both v2 anonymity and the CR's funder entitlement |
| §4 | delete `risk`, `tamperWarning`, `requestedAmount` for payer | delete `risk`, `requestedAmount` | `tamperWarning` was removed in v2 (no-op) |
| §5 | "re-tune ≥80/≥55" | weights re-balanced to total 100; **A≥78 / B≥55** + unrated-payer B-cap | honest re-tune; cap makes the demo grade structural |
| §3 | (supplier's view of payerProfile unspecified) | supplier sees `payerProfile: null` | buyer rating/settlement is confidential to underwriting |

## Verification

`api/test-flow.sh` (26 checks) + `api/regression.sh` (7 hardening) pass in **mock
and fabric**. The Playwright suite (`e2e/`) stubs Gemini (zero live quota; OCR
covered by one targeted test), asserts the rendered kill-shot banner, and covers
the non-funder-masking and funder-payment-instructions interactions.
