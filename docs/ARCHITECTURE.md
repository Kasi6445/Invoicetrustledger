# ARCHITECTURE.md — layers, request flow, and where the rules live

## Layers

```
┌────────────────────────────────────────────────────────────────────┐
│  React portal (Vite, :5173)                                        │
│  Login · SupplierView · PayerView · LenderView · AuditTrail        │
│  JWT kept in sessionStorage; axios interceptor drops any 401       │
│  back to the login screen; ErrorBoundary catches render crashes    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ REST + JWT (CORS locked to :5173)
┌──────────────────────────────▼─────────────────────────────────────┐
│  Express API (:3000) — api/server.js                               │
│  helmet · morgan · rate-limited /auth/login · multer (5MB,         │
│  pdf/png/jpg) · request validation (validate.js) · central error   │
│  shape { error, code } (errors.js)                                 │
│  Cross-cutting reads: masking.js (field-level RBAC per role),      │
│  risk.js (explainable rule-based score)                            │
│  AI: gemini.js OCR extraction (simulated fallback offline)         │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ submit(fn,…) / evaluate(fn,…) / verifyChain()
┌──────────────────────────────▼─────────────────────────────────────┐
│  Ledger adapter seam — api/ledger.js  (LEDGER_MODE)                │
│    mock    mockLedger.js   hash-chained append-only data/ledger.json│
│    fabric  fabricLedger.js Hyperledger Fabric Gateway → invoicecc  │
│    gcul    gculLedger.js   Google Cloud Universal Ledger (stub)    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
        on-chain: proofs only (status, hashes, timestamps, actors)
        off-chain: api/offchain.js (data/offchain.json) + data/docs/
                   bank details, CDD records, uploaded documents —
                   the chain holds only their SHA-256
```

## Request flow (example: lender funds an invoice)

```
LenderView "Fund invoice"
   │  POST /invoices/:id/fund   Authorization: Bearer <JWT>
   ▼
cors → helmet → morgan → auth('lender')        (401 no/bad token, 403 wrong role)
   ▼
route handler → getLedger()                     (the seam — mode chosen at startup)
   ▼
ledger.submit('FundInvoice', id, lenderName)
   ▼
BACKEND ENFORCES THE RULES (docs/RULES.md):
   status APPROVED?  → FINANCED, actor + tx time recorded
   status FINANCED?  → throw "DUPLICATE FINANCING BLOCKED: …"
   ▼
success: JSON record → portal badge flips to FINANCED
failure: error travels unchanged → 409 { error: "DUPLICATE FINANCING
         BLOCKED: …", code: "LEDGER_REJECTED" } → red banner in the UI
```

## Why the invariants live in the ledger, not the app

The fraud this system kills is **double financing** — the same invoice funded by
two lenders. If that check lived in the API, any API bug, compromised server, or
alternative client could bypass it. Instead every backend (mock chain, Fabric
chaincode, future GCUL contract) enforces the rules itself: a `FundInvoice` on a
`FINANCED` record is rejected *by the ledger*, whoever calls it, through
whatever client. The API's role checks (JWT + RBAC) and request validation are
convenience and hygiene layers on top — useful for UX and safety, but never the
last line of defence. This is also what makes the backends swappable: the rules
are specified once, language-neutrally, in `docs/RULES.md`, and
`api/test-flow.sh` / `api/regression.sh` prove any backend enforces them
identically.

## Trust boundaries

- **Portal → API**: untrusted input. Validated (`validate.js`), rate-limited,
  size/type-limited uploads, authenticated with JWT.
- **API → ledger**: trusted transport, untrusted *content* — the ledger
  re-checks every business rule regardless of what the API sends.
- **On-chain vs off-chain**: the chain stores proofs (hashes, statuses,
  timestamps, actor names). Documents and bank/CDD data stay off-chain; anyone
  can verify a document by recomputing its SHA-256 against the on-chain
  `docHash`.
