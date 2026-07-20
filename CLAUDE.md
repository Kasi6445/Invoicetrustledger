# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Invoice Trust Ledger — a demo of a shared, tamper-proof register for invoice financing. Three
roles (supplier, payer, lender) act on an invoice through a state machine; the ledger itself
rejects a second lender from financing an already-financed invoice ("the kill shot"), regardless
of the app layer. Built to be GCUL-ready: the ledger backend is swappable behind one interface.

## Layout

```
chaincode/   Hyperledger Fabric smart contract (JavaScript)
api/         Express + JWT + role masking + Gemini OCR + risk scoring
  ledger.js        the swap seam — reads LEDGER_MODE (mock | fabric | gcul)
  mockLedger.js    persistent hash-chained ledger in data/ledger.json (zero infra; also Plan B)
  fabricLedger.js  real Fabric via the Gateway SDK
  gculLedger.js    GCUL adapter stub — implement when Google grants testnet access
portal/      React (Vite) — Supplier / Payer / Lender consoles + audit trail
docs/        RULES.md (portable contract spec) · DEMO_SCRIPT.md · JUDGE_QA.md · test-invoices/
```

## Common commands

```bash
# API (from api/)
cp .env.example .env && npm install
node server.js                 # start on :3000, leave running
bash test-flow.sh               # conformance suite — must print "13 passed, 0 failed"
node seed.js                    # demo data: one FINANCED invoice, one APPROVED-and-ready invoice
rm -rf data                     # reset mock-mode ledger state (stop server first)

# Portal (from portal/)
npm install
npm run dev                     # http://localhost:5173
npm run build

# Chaincode (from chaincode/) — only relevant once the Fabric test network is deployed
# see docs/RUNBOOK.md Day 2 for network.sh / deployCC commands
```

There is no separate unit test framework — `api/test-flow.sh` (curl against a running server) is
the conformance test for the whole system, and it must pass identically against every ledger
backend. There's no single-test-runner concept; it's one linear script of 13 checks against a
live server instance. Run it after any change to `api/*.js` or `chaincode/lib/invoiceContract.js`.

## Architecture: the swap seam

`api/ledger.js` picks a backend at startup from `LEDGER_MODE` (`.env`, defaults to `mock`) and
memoizes it. Every route in `api/server.js` talks only to the interface returned by
`getLedger()` — never to a backend module directly:

```
submit(fn, ...args)    // writes: RegisterInvoice, ApproveInvoice, DisputeInvoice, FundInvoice, SettleInvoice
evaluate(fn, ...args)  // reads:  ReadInvoice, GetAllInvoices, GetInvoiceHistory
verifyChain()          // tamper-evidence proof (backend-appropriate)
```

`mockLedger.js` and `chaincode/lib/invoiceContract.js` are two independent implementations of the
exact same rules — **when changing a business rule, update both**, and re-run `test-flow.sh`
against whichever mode you can (mock is free; fabric requires the Day 2 network setup in
`docs/RUNBOOK.md`). `docs/RULES.md` is the single source of truth for those rules — read it before
changing invariants, and update it alongside the code. `gculLedger.js` is a documented stub (not
yet implementable — GCUL has no public access); it exists to show the migration is scoped to one
file.

Key invariants enforced identically by both real backends (see `docs/RULES.md` for full detail):
- **Fingerprint** (SHA-256 of invoiceNumber+supplierVRN+amount) can register only once — exact
  duplicates are rejected (`DUPLICATE REGISTRATION BLOCKED`).
- Same invoiceNumber+supplierVRN with a *different* amount is allowed to register but is
  permanently stamped with a `tamperWarning`.
- State machine: `REGISTERED → APPROVED → FINANCED → SETTLED`, with a `DISPUTED` terminal branch
  off `REGISTERED`. Transitions are guarded by current status, not by caller identity.
- A `FINANCED` invoice can never be financed again (`DUPLICATE FINANCING BLOCKED`) — this holds
  at the ledger level even if the API's role checks were bypassed.
- Timestamps inside contract/ledger logic come from the transaction context, never wall-clock, so
  behavior is deterministic across Fabric peers.
- On-chain/on-ledger data is proofs only (status, hashes, timestamps, actor names); documents and
  bank/KYC details live off-chain in `api/offchain.js` (`data/offchain.json`), referenced only by
  hash (`docHash`).

`mockLedger.js` additionally hash-chains every write into `data/ledger.json` (`prevHash` links),
rebuilding in-memory state by replaying the whole chain on startup — `verifyChain()` recomputes
every link to prove nothing was altered. This mode requires no Docker/Fabric and is the fallback
demo path ("Plan B") if the Fabric network can't be stood up.

## Other layers worth knowing about

- `api/masking.js` — field-level RBAC applied to every read response: payer never sees `risk` or
  `tamperWarning` or full bank details; lender sees risk/funding data but KYC/bank stay masked to
  last-4; supplier sees their own record unmasked. Route handlers always pipe reads through
  `maskForRole(riskScore(inv), profile, req.user.role)` — do the same for any new read endpoint.
- `api/risk.js` — deliberately rule-based (not ML) risk scoring so every point is explainable from
  ledger state (payer approval, tamper flag, anchored doc hash, due-date window, amount band).
- `api/gemini.js` — OCR extraction for invoice uploads via Gemini REST API. Falls back to a
  labelled `simulated: true` response when `GEMINI_API_KEY` is unset or the API fails, so the demo
  never hard-fails on a missing key or dead network.
- `api/users.js` — hardcoded demo accounts (all password `demo123`): `supplier1`, `payer1`,
  `lloyds` and `otherbank` (two lenders on purpose — `otherbank` is the second-financing kill
  shot). Auth is plain JWT, explicitly not OIDC, for demo purposes.
- Frontend (`portal/src/`) is one view per role (`SupplierView.jsx`, `PayerView.jsx`,
  `LenderView.jsx`) plus `AuditTrail.jsx` and `Login.jsx`, composed in `App.jsx` by `me.role`.
  `portal/src/api.js` is the only place that talks to the API (base URL hardcoded to
  `http://localhost:3000`) and holds the JWT in a module-level variable (lost on page refresh).
