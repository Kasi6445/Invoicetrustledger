# Invoice Trust Ledger — working demo, GCUL-ready

A shared, tamper-proof register for invoice financing: supplier registers, payer
approves, lender funds — and a second lender funding the same invoice is
**rejected by the ledger itself**, live on screen.

## Status: tested and working

`api/test-flow.sh` proves the full flow end-to-end — **13/13 checks pass** in mock
mode out of the box: all role logins, register → approve → fund lifecycle, the
duplicate-financing block (the kill shot), duplicate-registration block, the
tamper flag on altered resubmissions, payer/lender field masking, RBAC, the
audit trail, and hash-chain verification.

## Layout

```
chaincode/   Hyperledger Fabric smart contract (JavaScript) — deploy per docs/RUNBOOK.md Day 2
api/         Express + JWT + role masking + Gemini OCR + risk scoring
  ledger.js        ← THE SWAP SEAM: LEDGER_MODE = mock | fabric | gcul
  mockLedger.js    persistent hash-chained ledger (zero infra; also Plan B)
  fabricLedger.js  real Fabric via Gateway SDK
  gculLedger.js    GCUL adapter stub — implement when Google grants testnet access
portal/      React (Vite) — Supplier / Payer / Lender consoles + audit trail
docs/        RUNBOOK.md (the 3-day plan) · RULES.md (portable contract spec)
             DEMO_SCRIPT.md · JUDGE_QA.md · test-invoices/ (print to PDF)
```

## Quick start (60 seconds, no Docker)

```bash
cd api && cp .env.example .env && npm install && node server.js
# new terminal:
cd api && bash test-flow.sh && node seed.js
# new terminal:
cd portal && npm install && npm run dev     # http://localhost:5173
```

Demo logins (password `demo123`): `supplier1` · `payer1` · `lloyds` · `otherbank`.

## One-URL hosted demo (Render free tier)

The whole thing deploys as **one web service**: the Express API serves the built
portal from `api/public`, so a single URL is both the app and the API.

```bash
# build the portal into api/public, then serve everything on :3000
cd portal && npm install
cd ../api && npm run build:portal && node server.js   # http://localhost:3000 = full app
```

`render.yaml` at the repo root is a Render Blueprint that does the same build in
the cloud. Env vars: `LEDGER_MODE=mock`, `JWT_SECRET` (auto-generated),
`GEMINI_API_KEY` (optional — blank falls back to simulated OCR).

**Free-tier caveats (acceptable for a demo):** the service sleeps after ~15 min
idle (first request takes ~30 s to wake), and the filesystem is ephemeral — the
mock ledger in `data/ledger.json` **resets on every redeploy or restart**. Just
rerun the seed against the live URL:

```bash
API_URL=https://your-app.onrender.com node api/seed.js
```

Local dev is unchanged: the Vite dev server (`npm run dev`, port 5173) points at
`http://localhost:3000` via `portal/.env.development`; the hosted build uses
same-origin calls (empty `VITE_API_URL`).

## The GCUL story

GCUL (Google Cloud Universal Ledger) is in private testnet — no public access or
docs yet. This system is built so that migration is: (1) port `docs/RULES.md` to
a GCUL Python contract, (2) implement `api/gculLedger.js`, (3) set
`LEDGER_MODE=gcul`. `test-flow.sh` is the conformance suite — same 13 greens on
any backend. Nothing else changes.

Full plan: **docs/RUNBOOK.md**. When stuck >15 min: paste command + full output into Claude.
