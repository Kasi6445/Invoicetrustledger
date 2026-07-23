# RULES.md — Ledger invariants (portable spec)

This is the single source of truth for the business rules. Every ledger backend
must enforce ALL of these identically: the Fabric chaincode (JavaScript), the
mock hash-chained ledger, and — when access is granted — the GCUL smart
contract (Python). `api/test-flow.sh` is the conformance test: any backend that
passes all 22 checks is a valid implementation.

## Identity

- **Fingerprint** = SHA-256 of `UPPER(TRIM(invoiceNumber)) | UPPER(TRIM(supplierVRN)) | Number(amount)`
  (stored on the record as provenance; no longer used for duplicate detection)
- **NumberKey**   = SHA-256 of `UPPER(TRIM(invoiceNumber)) | UPPER(TRIM(supplierVRN))`
  (the uniqueness key)

## Rules

| # | Rule |
|---|------|
| R0 | An `invoiceId` can be created only once. |
| R1 | **One number, one registration:** an invoice number may be registered ONCE per supplier (per NumberKey), regardless of amount. Any reuse fails with a message starting `DUPLICATE INVOICE BLOCKED` naming the prior invoice, both amounts and the original registration time; when the amounts differ the message ends with `Possible tampered or fake invoice.` Uniqueness is scoped per supplier — two different suppliers may legitimately use the same invoice number. |
| R2 | **Lender decline:** a lender may decline an `APPROVED` invoice (recorded as `{by, reason, at}` in the `declines` array). The same lender cannot decline the same invoice twice. A decline does NOT change `status` — it is that institution's own credit decision, never a global block: other lenders can still fund. |
| R3 | Only a `REGISTERED` invoice can become `APPROVED` or `DISPUTED` (payer action, actor recorded). |
| R4 | Only an `APPROVED` invoice can become `FINANCED` (lender action, actor recorded). |
| R5 | **The kill shot:** a `FINANCED` invoice can NEVER be financed again. The attempt fails with a message starting `DUPLICATE FINANCING BLOCKED` naming the original lender and time — regardless of who calls, at the ledger level. (The API rewrites the lender's name to `another financial institution` before the message reaches a competing lender — a read-time masking concern, not a ledger rule.) |
| R6 | Only a `FINANCED` invoice can become `SETTLED`. |
| R7 | **Immutable audit trail:** every state change is permanently recorded with a transaction id + timestamp; full per-invoice history is queryable. |
| R8 | Timestamps come from the transaction context (deterministic), never from local wall-clock inside contract logic. |
| R9 | On-chain stores proofs only: statuses, hashes (`docHash`, fingerprint), timestamps, actor names. Documents, bank details and KYC live off-chain; the chain holds their hash. |
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
- `RegisterInvoice(invoiceId, invoiceNumber, supplierName, supplierVRN, payerName, amount, currency, dueDate, docHash)`
- `ApproveInvoice(invoiceId, approverName)` · `DisputeInvoice(invoiceId, approverName, reason)`
- `DeclineInvoice(invoiceId, lenderName, reason)`
- `FundInvoice(invoiceId, lenderName)` · `SettleInvoice(invoiceId)`
- `ReadInvoice(invoiceId)` · `GetAllInvoices()` · `GetInvoiceHistory(invoiceId)`
