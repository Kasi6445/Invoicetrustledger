# RULES.md — Ledger invariants (portable spec)

This is the single source of truth for the business rules. Every ledger backend
must enforce ALL of these identically: the Fabric chaincode (JavaScript), the
mock hash-chained ledger, and — when access is granted — the GCUL smart
contract (Python). `api/test-flow.sh` is the conformance test: any backend that
passes all 13 checks is a valid implementation.

## Identity

- **Fingerprint** = SHA-256 of `UPPER(TRIM(invoiceNumber)) | UPPER(TRIM(supplierVRN)) | Number(amount)`
- **NumberKey**   = SHA-256 of `UPPER(TRIM(invoiceNumber)) | UPPER(TRIM(supplierVRN))`

## Rules

| # | Rule |
|---|------|
| R0 | An `invoiceId` can be created only once. |
| R1 | **Unique invoice identity:** a fingerprint may be registered ONCE. Re-registering the same fingerprint fails with a message starting `DUPLICATE REGISTRATION BLOCKED`. |
| R2 | **Tamper flag:** same NumberKey with a *different* amount registers, but the record carries a permanent `tamperWarning` naming both amounts. |
| R3 | Only a `REGISTERED` invoice can become `APPROVED` or `DISPUTED` (payer action, actor recorded). |
| R4 | Only an `APPROVED` invoice can become `FINANCED` (lender action, actor recorded). |
| R5 | **The kill shot:** a `FINANCED` invoice can NEVER be financed again. The attempt fails with a message starting `DUPLICATE FINANCING BLOCKED` naming the original lender and time — regardless of who calls, at the ledger level. |
| R6 | Only a `FINANCED` invoice can become `SETTLED`. |
| R7 | **Immutable audit trail:** every state change is permanently recorded with a transaction id + timestamp; full per-invoice history is queryable. |
| R8 | Timestamps come from the transaction context (deterministic), never from local wall-clock inside contract logic. |
| R9 | On-chain stores proofs only: statuses, hashes (`docHash`, fingerprint), timestamps, actor names. Documents, bank details and KYC live off-chain; the chain holds their hash. |

## State machine

```
REGISTERED ──approve──▶ APPROVED ──fund──▶ FINANCED ──settle──▶ SETTLED
     │
     └───dispute──▶ DISPUTED (terminal)
```

## Interface every backend implements (the swap seam)

```
submit(fn, ...args)    // writes:  RegisterInvoice, ApproveInvoice, DisputeInvoice, FundInvoice, SettleInvoice
evaluate(fn, ...args)  // reads:   ReadInvoice, GetAllInvoices, GetInvoiceHistory
verifyChain()          // tamper-evidence proof (backend-appropriate)
```

Argument order:
- `RegisterInvoice(invoiceId, invoiceNumber, supplierName, supplierVRN, payerName, amount, currency, dueDate, docHash)`
- `ApproveInvoice(invoiceId, approverName)` · `DisputeInvoice(invoiceId, approverName, reason)`
- `FundInvoice(invoiceId, lenderName)` · `SettleInvoice(invoiceId)`
- `ReadInvoice(invoiceId)` · `GetAllInvoices()` · `GetInvoiceHistory(invoiceId)`
