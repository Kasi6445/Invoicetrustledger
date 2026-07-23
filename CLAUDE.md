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
e2e/         Playwright suite — API-contract regression + UI video/screenshot evidence
  fixtures/        the real demo PDFs (clean + tampered twins) the tests upload
  evidence/        captured proof from the last clean run; INDEX.md explains each file
docs/        RULES.md (portable contract spec) · ARCHITECTURE.md (layers + request flow)
             DEMO_SCRIPT.md · JUDGE_QA.md · test-invoices/
```

`RUNBOOK.md` exists byte-identical at the repo root AND in `docs/` — edit both or neither
(known cleanup item, noted at the top of the file itself).

## Common commands

```bash
# API (from api/)
cp .env.example .env && npm install   # then set a real JWT_SECRET in .env (see comment there)
node server.js                 # start on :3000, leave running
bash test-flow.sh               # conformance suite — must print "22 passed, 0 failed"
bash regression.sh              # test-flow PLUS hardening checks (401/400/403, upload limits)
node seed.js                    # demo data: one FINANCED invoice, one APPROVED-and-ready invoice
rm -rf data                     # reset mock-mode ledger state (stop server first)

# Portal (from portal/)
npm install
npm run dev                     # http://localhost:5173
npm run build

# Chaincode (from chaincode/) — only relevant once the Fabric test network is deployed
# see docs/RUNBOOK.md Day 2 for network.sh / deployCC commands

# E2E (from e2e/) — needs API on :3000 AND portal on :5173 already running;
# global-setup.ts checks both (plus PDF fixtures) and fails fast with instructions.
export LD_LIBRARY_PATH=~/.local/chrome-deps/extracted/usr/lib/x86_64-linux-gnu
                                # ^ REQUIRED on this machine before EVERY Playwright run
                                #   (rootless Chromium deps — no sudo on this box)
npm test                        # all 19 tests (14 API + 1 UI lifecycle + 4 real-document)
npm run test:api                # API-contract project only — no browser, no Gemini calls
npm run test:ui                 # UI evidence projects — records video, calls Gemini
npm run report                  # open the HTML report from the last run
```

## Morning ritual — fabric mode from cold

Every command below has been run end-to-end on this machine. Order matters; the three
prerequisites are the ones that actually bite.

```bash
# 0. PREREQS — check these first, they fail silently otherwise.
#    a) Docker Desktop has AutoStart OFF, so after any reboot it must be started by hand.
#       WSL sees the engine only once /var/run/docker.sock exists — wait for it:
docker ps >/dev/null 2>&1 || echo "start Docker Desktop, then re-check"
#       If docker was working and then stops with "Input/output error" on /usr/bin/docker,
#       Docker Desktop died and left a stale cli-tools mount. Restart it from Windows:
#       "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe" desktop restart
#    b) jq MUST be on PATH — network.sh uses it to set anchor peers, and WITHOUT it the
#       network still comes "up" but anchor peers are never set, which breaks the Gateway
#       SDK's service discovery later. Installed here (no sudo needed):
which jq || curl -sSL -o ~/.local/bin/jq \
  https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64 && chmod +x ~/.local/bin/jq
#    c) Node 20 lives in ~/.local/node20 — confirm `node -v` is v20.x.

# 1. Network + chaincode (from ~/fabric/fabric-samples/test-network)
cd ~/fabric/fabric-samples/test-network
./network.sh down                      # ONLY when resetting; skip on a clean boot
./network.sh up createChannel -c mychannel -ca
./network.sh deployCC -ccn invoicecc -ccp ~/invoice-trust-ledger/chaincode -ccl javascript
docker ps --format 'table {{.Names}}\t{{.Status}}'
# expect 8 containers: 2 peers + orderer + 3 CAs + 2 dev-peer chaincode containers

# 2. API
cd ~/invoice-trust-ledger/api        # .env: LEDGER_MODE=fabric, FABRIC_SAMPLES=/home/sandh/fabric/fabric-samples
node server.js &
sleep 2 && node seed.js

# 3. Portal
cd ~/invoice-trust-ledger/portal && npm run dev
```

Mock mode instead: skip step 1 entirely, set `LEDGER_MODE=mock`, and `rm -rf api/data` first.

Fabric state does NOT persist across `network.sh down` — the ledger is wiped, so re-run
`seed.js` every time. Mock mode persists in `api/data/ledger.json` until you delete it.

## Testing

There is no unit test framework. Two layers exist, both run against a live server:

1. `api/test-flow.sh` (curl) is the conformance test for the whole system, and it must pass
   identically against every ledger backend. It's one linear script of 22 checks. `api/regression.sh`
   wraps it and adds API-hardening checks (wrong password → 401, missing fields → 400 with field
   messages, garbage token → 401, wrong role → 403, oversized/wrong-type uploads rejected). Run
   regression.sh after any change to `api/*.js` or `chaincode/lib/invoiceContract.js`.
2. `e2e/` is a Playwright suite (see Common commands for the LD_LIBRARY_PATH prerequisite) with
   two projects: `api-regression` asserts every business rule at the HTTP contract level with
   fresh per-run invoice numbers (no browser, no Gemini), and `ui-evidence`
   (`invoice-lifecycle.spec.ts` + `real-documents.spec.ts`) drives the portal to capture
   video/screenshot proof of the full flow including the kill shot. Works in mock or fabric mode.
   Things to preserve when touching it:
   - **Gemini free-tier quota is 10 req/min** — the UI specs make up to ~5 `/ai/extract` calls
     per run; never loop them rapidly. The API project deliberately makes zero.
   - The real-document specs are **state-tolerant**: they check ledger state via API first and
     branch, so they stay green whether the ledger is fresh or already contains the demo
     invoices. Keep that property.
   - `retries: 0` and serial workers are intentional (evidence runs must not silently retry);
     the UI specs override the fixture PDFs' invoice numbers with unique per-run values before
     registering, because the chaincode permanently blocks fingerprint reuse.

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
`docs/RUNBOOK.md`). Note that the fabric error-surfacing fix (rejection messages were arriving as
a generic gRPC envelope; `fabricLedger.js` now unwraps `details[0].message`) was a change to the
*adapter* only — it touched no rule logic, so it needed no dual update. Those two files remain the
only two rule implementations; the dual-update rule applies to business rules, not to adapters. `docs/RULES.md` is the single source of truth for those rules — read it before
changing invariants, and update it alongside the code. `gculLedger.js` is a documented stub (not
yet implementable — GCUL has no public access); it exists to show the migration is scoped to one
file.

Key invariants enforced identically by both real backends (see `docs/RULES.md` for full detail):
- **One number, one registration**: an invoice number can register only once per
  supplier (the `NUM_` key of invoiceNumber+supplierVRN), regardless of amount — any reuse is
  rejected (`DUPLICATE INVOICE BLOCKED`), with `Possible tampered or fake invoice.` appended when
  the amounts differ. The `fingerprint` field (number+supplier+amount) is still stored as
  provenance but no longer drives duplicate detection.
- State machine: `REGISTERED → APPROVED → FINANCED → SETTLED`, with a `DISPUTED` terminal branch
  off `REGISTERED`. Transitions are guarded by current status, not by caller identity.
- A lender can `DeclineInvoice` an APPROVED invoice (recorded in the `declines` array, once per
  lender); a decline never changes `status` and never blocks other lenders from funding.
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
  full bank details; lender sees risk/funding data but KYC/bank stay masked to last-4; supplier
  sees their own record unmasked. One lender never sees another lender's name: for a lender
  viewer, a competitor's `financedBy` and foreign `declines` entries become
  `another financial institution` (reasons stripped) — including inside `GET /invoices/:id/history`
  (via `maskHistoryForRole`) and the fund route's 409 message. Route handlers always pipe reads
  through `maskForRole(riskScore(inv), profile, req.user.role, req.user.displayName)` — do the
  same for any new read endpoint. The chaincode never masks; the on-chain record stays complete.
- `api/risk.js` — deliberately rule-based (not ML) risk scoring so every point is explainable from
  ledger state (payer approval +40, anchored doc hash +20, due-date window +15, amount band +15,
  no lender declines +10).
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
