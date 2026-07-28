# RESUME — pick-up state for a fresh session

_Last updated: 2026-07-23._

## Where the code is

- **Branch:** `main`
- **Commit (HEAD):** `f16b12c` — _Exclude local settings from repository_
- **Remote:** `origin` → https://github.com/Kasi6445/Invoicetrustledger.git — `main` is pushed and up to date.

> ⚠️ **Branch note:** the old `v3-similar-invoice-flag` branch no longer exists (not locally,
> not on the remote). All of the v2, v3 and CR01 work is now linear on `main`. **The demo runs
> from `main`.** The morning-ritual sections in `docs/RUNBOOK.md`, root `RUNBOOK.md` and
> `CLAUDE.md` were corrected to `git checkout main` (hardening Task 1).

## What's done

- **CR01 Tasks A–E** — all landed on `main`:
  - A–D (backend, commit `59dabee`): financing cap (`requestedAmount` may not exceed `amount`,
    else `FINANCING REQUEST REJECTED`), multi-document hashes on register, payer credit profiles,
    5-arg `maskForRole`, funder **entitlement unlock** (the lender who funded sees the supplier's
    full bank details; evaluated on the raw invoice _before_ anonymity masking).
  - E (portal + docs, commit `e3fa23c`): multi-doc register form, payer payment-terms column,
    supporting-document viewer, funder-only payment-instructions modal. The red
    `LEDGER REJECTED` banner logic in `LenderView` was deliberately left untouched.
  - e2e + evidence (commit `d3269e5`): Gemini stubbed suite-wide, entitlement/masking coverage,
    structural risk cap (an unrated payer can never grade A — capped at B), docs updated.
- **Pre-demo hardening pass** — landed on `main` (this session):
  - **Task 1:** morning ritual repointed to `main` (dead-branch fix).
  - **Task 2:** status-aware lender buttons (REGISTERED disabled "Awaiting payer approval";
    FINANCED stays clickable but amber "Attempt funding" + "Prior assignment recorded on ledger",
    funder never named).
  - **Task 3:** the invoice copy is **MANDATORY** — no invoice registers without a real document
    hash (enforced at the ledger, verified by a direct `peer chaincode invoke` returning
    `INVOICE COPY REQUIRED`; the API also fast-fails 400). seed.js/autoSeed attach documents.
  - **Task 4:** financing cap **tightened to 90%** of face value (dual-updated in both engines +
    RULES.md R1b; boundary verified: 90.00% registers, 90.02% rejects).
- **v4 UK/Lloyds localisation (Part 0)** landed + verified on fabric: `supplierVRN → supplierCRN`
  (on-chain key change), GBP/£, UK identities (Pennine Textiles / Northfield / Lloyds Commercial
  Banking / Meridian), CDD/sort-code terminology. Chaincode redeployed as **`invoicecc` v3.0 /
  sequence 1** (fresh channel → sequence is always 1; the `_fingerprint` now hashes the CRN, so
  old ledger records are incompatible — down/up/deploy/seed is the only path).
  **DR-drill finding:** the fabric reset must now also `rm -rf api/data` (off-chain profiles carry
  demo identities; a stale `offchain.json` silently degrades grades to B and drops bank details).
  Reset drill timed at **2m13s** (well under the 10-min target).
- **e2e suite green:** last clean run **24/24** (18 API-contract + 1 full UI lifecycle + 4
  real-document + 1 targeted OCR), against the **live Fabric** network on a fresh ledger. See
  `e2e/evidence/INDEX.md`.
- **Evidence regenerated (this session):** 16 screenshots + `hash-proof.txt` + two videos under
  `e2e/evidence/`.
- **`api/restart.sh`** is committed (`2f9fbf0`) and was exercised this session (came up
  `LEDGER_MODE = fabric`) — the only sanctioned way to (re)start the API.
- Backend conformance green: `test-flow.sh` **26/26** and `regression.sh` **+7/7** hardening
  checks, in **both** mock and fabric mode.

## Still open

1. **Copy the `.webm` demo videos to durable off-laptop storage.** Canonical copies are
   `e2e/evidence/full-lifecycle.webm` and `e2e/evidence/otherbank-kill-shot.webm`; both were
   copied to `~/demo-backup/` (and older copies exist under `~/itl-demo-backup/` and
   `/mnt/c/Users/<username>/itl-demo-backup/`). A real cloud/USB copy the judges could reach if the
   laptop dies is still worth doing.

_Resolved this session: `api/restart.sh` exercised end-to-end (came up `LEDGER_MODE = fabric`);
the runbook/CLAUDE morning-ritual branch note corrected to `main` (Task 1)._

## Current runtime state (as of this file)

The demo is **UP** after the hardening pass: Fabric network running (8 containers, chaincode
`invoicecc` v2.0/seq1), API on `:3000` in `LEDGER_MODE=fabric`, portal dev server on `:5173`,
ledger seeded. If you are resuming from a cold laptop instead, Fabric state does **not** survive
`network.sh down` — bring everything up with the sequence below.

## Morning ritual — cold start to running demo (fabric mode)

```bash
# 0. Branch. (Use main — v3-similar-invoice-flag no longer exists.)
cd ~/invoice-trust-ledger && git checkout main && git status

# 1. Fabric network + chaincode (state is wiped by 'down', so this is a fresh ledger)
cd ~/fabric/fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
./network.sh deployCC -ccn invoicecc -ccp ~/invoice-trust-ledger/chaincode -ccl javascript -ccv 3.0 -ccs 1
docker ps --format 'table {{.Names}}\t{{.Status}}'   # expect 8 containers

# 2. API — ALWAYS via restart.sh (never `node server.js &`). Confirm it prints LEDGER_MODE = fabric.
cd ~/invoice-trust-ledger/api
rm -rf data                  # MUST clear off-chain data too: profiles carry demo identities
                             # now (UK localisation) — a stale data/offchain.json silently breaks
                             # risk grades (unrated-payer cap) and bank masking.
bash restart.sh
node seed.js                 # re-seed every time — fabric state does not persist across 'down'

# 3. Portal
cd ~/invoice-trust-ledger/portal && npm run dev   # http://localhost:5173
```

Prereqs that bite (see CLAUDE.md "Morning ritual" for detail): Docker Desktop must be started by
hand after a reboot (AutoStart is off); `jq` must be on PATH before `network.sh` or anchor peers
silently never get set; `node -v` must be v20.x (`~/.local/node20`). For **mock mode** instead:
skip step 1, set `LEDGER_MODE=mock` in `api/.env`, `rm -rf api/data`, then `bash restart.sh`.

For Playwright/e2e you must first:
`export LD_LIBRARY_PATH=~/.local/chrome-deps/extracted/usr/lib/x86_64-linux-gnu`.

## What this project is (zero-context version)

Invoice Trust Ledger is a demo of a shared, tamper-proof register for **invoice financing** —
the business where a supplier who is owed money on an invoice sells that invoice to a lender for
cash today. The fraud it kills: the same invoice being financed twice (by two different lenders
who can't see each other's books). Three roles — supplier, payer, lender — move one invoice
through a state machine (`REGISTERED → APPROVED → FINANCED → SETTLED`) on a Hyperledger Fabric
ledger, with an Express/JWT API doing role-based field masking on top. **The demo's climax — "the
kill shot":** after Lloyds has financed an invoice, a second lender (Meridian) clicks its own
still-enabled Fund button, and the **ledger itself** rejects the transaction with a red
`DUPLICATE FINANCING BLOCKED` banner — proving the guarantee holds at the ledger layer even if the
app's role checks were bypassed, and that no lender can see who the other lender was. The whole
backend sits behind one swappable interface (`api/ledger.js`) so the same rules can later run on
Google's GCUL ledger by implementing a single file.
