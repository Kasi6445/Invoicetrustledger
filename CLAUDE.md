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
  errors.js        ApiError + central error middleware — every error is { error, code }
  validate.js      request-shape validation for writes (400 + field messages)
portal/      React (Vite) — Supplier / Payer / Lender consoles + audit trail
docs/        RULES.md (portable contract spec) · ARCHITECTURE.md (layers + request flow)
             DEMO_SCRIPT.md · JUDGE_QA.md · test-invoices/
```

## Common commands

```bash
# API (from api/)
cp .env.example .env && npm install   # then set a real JWT_SECRET in .env (see comment there)
node server.js                 # start on :3000, leave running
bash test-flow.sh               # conformance suite — must print "13 passed, 0 failed"
bash regression.sh              # test-flow PLUS hardening checks (401/400/403, upload limits)
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
live server instance. `api/regression.sh` wraps it and adds API-hardening checks (wrong password
→ 401, missing fields → 400 with field messages, garbage token → 401, wrong role → 403,
oversized/wrong-type uploads rejected). Run regression.sh after any change to `api/*.js` or
`chaincode/lib/invoiceContract.js`.

## Deployment (Render, single service)

`render.yaml` at the repo root deploys everything as ONE Node web service: buildCommand installs
both package trees and runs `api/build-portal.js` (vite build → copy `portal/dist` into
`api/public`, which `server.js` serves same-origin AFTER all API routes, with an index.html
fallback for client paths). startCommand is `node api/server.js`. `AUTO_SEED=true` makes the
server seed the two demo invoices in-process at boot whenever the ledger is empty — needed
because the free tier wipes the disk on every restart; the seeding goes through the normal
`ledger.submit()` calls, so no business rules are duplicated. In production the portal calls the
API same-origin; local dev points it at :3000 via `portal/.env.development` (`VITE_API_URL`).
`api/seed.js` also takes a target URL (`node seed.js https://host` or `API_URL=` env).

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

- API middleware stack (`api/server.js`): helmet, CORS locked to `http://localhost:5173`, morgan
  request logging, rate-limited `/auth/login` (20/min), multer capped at 5 MB and pdf/png/jpg
  only. Every error response has the shape `{ error, code }` via `api/errors.js` — ledger
  rejections pass through verbatim in `error` with code `LEDGER_REJECTED` (tests grep those
  messages, don't rewrite them). Request validation for registers lives in `api/validate.js` —
  it's a shape check only; business rules stay in the ledger.
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
  `LenderView.jsx`) plus `AuditTrail.jsx`, `Login.jsx` and `ErrorBoundary.jsx`, composed in
  `App.jsx` by `me.role`. `portal/src/api.js` is the only place that talks to the API (base URL
  hardcoded to `http://localhost:3000`); it keeps the JWT in `sessionStorage` (survives refresh
  via `restoreSession()`) and an axios interceptor clears the session and returns to login on any
  401. Login: role cards only pre-fill the username — authentication happens on form submit.
