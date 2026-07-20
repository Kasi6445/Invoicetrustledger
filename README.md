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

## The GCUL story

GCUL (Google Cloud Universal Ledger) is in private testnet — no public access or
docs yet. This system is built so that migration is: (1) port `docs/RULES.md` to
a GCUL Python contract, (2) implement `api/gculLedger.js`, (3) set
`LEDGER_MODE=gcul`. `test-flow.sh` is the conformance suite — same 13 greens on
any backend. Nothing else changes.

Full plan: **docs/RUNBOOK.md**. When stuck >15 min: paste command + full output into Claude.
