# RULES.md — Ledger invariants (portable spec)

This is the single source of truth for the business rules. Every ledger backend
must enforce ALL of these identically: the Fabric chaincode (JavaScript), the
mock hash-chained ledger, and — when access is granted — the GCUL smart
contract (Python). `api/test-flow.sh` is the conformance test: any backend that
passes all 26 checks is a valid implementation.

## Identity

- **Fingerprint** = SHA-256 of `UPPER(TRIM(invoiceNumber)) | UPPER(TRIM(supplierCRN)) | Number(amount)`
  (stored on the record as provenance; no longer used for duplicate detection)
- **NumberKey**   = SHA-256 of `UPPER(TRIM(invoiceNumber)) | UPPER(TRIM(supplierCRN))`
  (the uniqueness key)

## Rules

| # | Rule |
|---|------|
| R0 | An `invoiceId` can be created only once. |
| R1 | **One number, one registration:** an invoice number may be registered ONCE per supplier (per NumberKey), regardless of amount. Any reuse fails with a message starting `DUPLICATE INVOICE BLOCKED` naming the prior invoice, both amounts and the original registration time; when the amounts differ the message ends with `Possible tampered or fake invoice.` Uniqueness is scoped per supplier — two different suppliers may legitimately use the same invoice number. |
| R1b | **Financing cap (CR01, tightened):** at registration, `amount` (invoice face value) must be > 0 and `requestedAmount` (advance sought) must be > 0 and `<= 90% of amount` (a haircut that leaves the supplier with skin in the game). Violations fail with a message starting `FINANCING REQUEST REJECTED` stating the requested amount, `90%` and the computed max. This bounds the size of the ONE financing event — it is not partial/tranched financing (there is still exactly one `FundInvoice` per invoice, and R5 still blocks any second financing). |
| R1c | **Document hash slot (CR01) — invoice copy MANDATORY:** `docHashes` arrives as a JSON string of `{ invoiceCopy, purchaseOrder, goodsReceived }` SHA-256s, parsed defensively (malformed JSON is rejected; `""`/`"{}"` mean none). The parsed object is stored as `docs`, and `docHash` is kept equal to `docs.invoiceCopy` so risk scoring and the demo read the invoice-copy proof unchanged. The invoice copy is REQUIRED: registration throws `INVOICE COPY REQUIRED` when it is absent (there is no `'no-document'` fallback), and the API fast-fails 400 before the ledger. Purchase order and goods-received note stay optional. Goods description is commercial narrative and is NOT put on-chain. |
| R2 | **Lender decline:** a lender may decline an `APPROVED` invoice (recorded as `{by, reason, at}` in the `declines` array). The same lender cannot decline the same invoice twice. A decline does NOT change `status` — it is that institution's own credit decision, never a global block: other lenders can still fund. |
| R3 | Only a `REGISTERED` invoice can become `APPROVED` or `DISPUTED` (payer action, actor recorded). |
| R4 | Only an `APPROVED` invoice can become `FINANCED` (lender action, actor recorded). |
| R5 | **The kill shot:** a `FINANCED` invoice can NEVER be financed again. The attempt fails with a message starting `DUPLICATE FINANCING BLOCKED` naming the original lender and time — regardless of who calls, at the ledger level. (The API rewrites the lender's name to `another financial institution` before the message reaches a competing lender — a read-time masking concern, not a ledger rule.) |
| R6 | Only a `FINANCED` invoice can become `SETTLED`. |
| R7 | **Immutable audit trail:** every state change is permanently recorded with a transaction id + timestamp; full per-invoice history is queryable. |
| R8 | Timestamps come from the transaction context (deterministic), never from local wall-clock inside contract logic. |
| R9 | On-chain stores proofs only: statuses, hashes (`docHash`, fingerprint), timestamps, actor names. Documents, bank details and CDD records live off-chain; the chain holds their hash. |
| R10 | **Lender anonymity (API layer, not ledger):** one lender never sees another lender's name. For a lender viewer, `financedBy` of a competitor and every foreign `declines` entry become `another financial institution` (decline reasons removed), including inside audit-trail history and error messages. Supplier and payer always see real lender names. The on-chain record stays complete — the chaincode never masks. |
| R11 | **Similar-invoice detection (API layer, read-time — flag, NEVER block):** R1 closed number reuse; the workaround is re-registering the same invoice under a NEW number, so reads compute a similarity pass across the full ledger. **Strong tier:** identical `docHash` on two+ invoices (excluding `no-document`/absent) → −25 risk points (floor 0) and a `⚠ Same document already registered as …` reason. **Soft tier:** same normalized supplier+payer+amount under different numbers → informational `ℹ Similar invoice(s) on ledger …` reason, zero score change — because different numbers with the same amount is legitimate everyday recurring billing. Flags live inside `risk.similar` (hidden from the payer with the rest of `risk`); matching spans all statuses and never blocks registration — detection in the system, decision with the institution. |

## State machine

```
REGISTERED ──approve──▶ APPROVED ──fund──▶ FINANCED ──settle──▶ SETTLED
     │                     │
     │                     └─decline─▶ (stays APPROVED; appended to declines[])
     └───dispute──▶ DISPUTED (terminal)
```

## Interface every backend implements (the swap seam)

```
submit(fn, ...args)    // writes:  RegisterInvoice, ApproveInvoice, DisputeInvoice, DeclineInvoice, FundInvoice, SettleInvoice
evaluate(fn, ...args)  // reads:   ReadInvoice, GetAllInvoices, GetInvoiceHistory
verifyChain()          // tamper-evidence proof (backend-appropriate)
```

Argument order:
- `RegisterInvoice(invoiceId, invoiceNumber, supplierName, supplierCRN, payerName, amount, requestedAmount, currency, invoiceDate, dueDate, docHashes)` — CR01 signature (11 positional args; `docHashes` is a JSON string, `{}` for none)
- `ApproveInvoice(invoiceId, approverName)` · `DisputeInvoice(invoiceId, approverName, reason)`
- `DeclineInvoice(invoiceId, lenderName, reason)`
- `FundInvoice(invoiceId, lenderName)` · `SettleInvoice(invoiceId)`
- `ReadInvoice(invoiceId)` · `GetAllInvoices()` · `GetInvoiceHistory(invoiceId)`

## Role / field visibility matrix (CR01 — API read-time masking)

Masking is a per-viewer, read-time concern in `api/masking.js`
(`maskForRole(invoice, supplierProfile, payerProfile, role, viewerName)`); the
chaincode never masks. "Funder" = the lender whose `displayName === financedBy`
on a `FINANCED` invoice.

| Field | Supplier (own) | Payer | Lender — not funder | Lender — funder |
|---|---|---|---|---|
| Invoice core (number, amount, status, dates) | ✅ | ✅ | ✅ | ✅ |
| `requestedAmount` | ✅ | ❌ removed | ✅ | ✅ |
| `risk` (score/grade/reasons, incl. `similar`) | ✅ | ❌ removed | ✅ | ✅ |
| `goodsDescription` + supporting-doc access | ✅ | ✅ | ✅ | ✅ |
| Supplier `bankAccount` | full | last-4 | last-4 | **full** (entitlement) |
| Supplier `sortCode` | full | masked | masked | **full** (entitlement) |
| Supplier `cddRecordRef` | full | `restricted` | masked | masked (always) |
| `payerProfile` (terms, rating, settlement) | ❌ null | ❌ null (knows own) | ✅ full | ✅ full |
| Competitor lender identity (`financedBy`, foreign `declines`) | real name | real name | `another financial institution` | `another financial institution` |

**Entitlement endpoint:** `GET /invoices/:id/payment-instructions` returns full
supplier bank details to the **funder only**; anyone else gets **403**, and the
403 body never names the funder ("another institution") so it can't be used as
an oracle to defeat lender anonymity (R10). The entitlement is evaluated on the
raw invoice **before** anonymity masking, so the funder passes their own check.

**Supporting documents:** `GET /invoices/:id/doc/:type` streams one of
`invoiceCopy | purchaseOrder | goodsReceived` (whitelisted `:type`, path-traversal
guarded) to supplier (own invoice), payer, or lender.
