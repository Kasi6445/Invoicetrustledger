# RESUME — pick-up state for a fresh session

_Last updated: 2026-07-23._

## Where the code is

- **Branch:** `main`
- **Commit (HEAD):** `f16b12c` — _Exclude local settings from repository_
- **Remote:** `origin` → https://github.com/Kasi6445/Invoicetrustledger.git — `main` is pushed and up to date.

> ⚠️ **Branch note (changed):** earlier drafts of the runbook told you to check out
> `v3-similar-invoice-flag`. **That branch no longer exists** (not locally, not on the remote).
> All of the v2, v3 and CR01 work is now linear on `main`. **The demo runs from `main`.**
> `docs/RUNBOOK.md`, the root `RUNBOOK.md`, and `CLAUDE.md` still say "checkout
> `v3-similar-invoice-flag`" in their morning-ritual sections — that instruction is stale and is
> listed as an open item below. Ignore it; use `main`.

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
- **e2e suite green:** last clean run **23/23** (17 API-contract + 1 full UI lifecycle + 4
  real-document + 1 targeted OCR), against the **live Fabric** network on a fresh ledger. See
  `e2e/evidence/INDEX.md`.
- **Evidence regenerated:** screenshots + `hash-proof.txt` + two videos under `e2e/evidence/`.
- **`api/restart.sh`** exists and is committed (`2f9fbf0`) — the only sanctioned way to (re)start
  the API. Kills the PID owning `:3000` by socket ownership (never a name match), refuses to
  start on a busy port, prints the `LEDGER_MODE` it came up in.
- Backend conformance last known green: `test-flow.sh` **26/26** and `regression.sh` **+7/7**
  hardening checks, in both mock and fabric mode.

## Still open

1. **Verify `api/restart.sh` end-to-end on a cold laptop.** It was reported verified three ways in
   a prior session (server running / nothing running / orphaned non-server process on :3000), but
   that verification predates the current machine state — re-run it as part of the next cold boot
   and confirm it prints `LEDGER_MODE = fabric`.
2. **Copy the `.webm` demo videos off the laptop.** Canonical copies live at
   `e2e/evidence/full-lifecycle.webm` and `e2e/evidence/otherbank-kill-shot.webm`. Backups exist at
   `~/itl-demo-backup/`, `~/demo-backup/`, and `/mnt/c/Users/sandh/itl-demo-backup/`. "Off the
   laptop" (a real cloud/USB copy the judges can reach if the machine dies) is still worth doing.
3. **Fix the morning-ritual + branch note in the runbook.** `docs/RUNBOOK.md`, root `RUNBOOK.md`,
   and `CLAUDE.md` still instruct `git checkout v3-similar-invoice-flag`. That branch is gone;
   update all three to `main` (they are otherwise correct, including the `restart.sh` step). The
   two RUNBOOK copies must stay byte-identical.

## Current runtime state (as of this file)

The demo is **fully cold**: Fabric network is **down** (0 containers), nothing on `:3000` or
`:5173`, and the (last-seeded) ledger is wiped because Fabric state does not survive
`network.sh down`. Bring it up with the sequence below.

## Morning ritual — cold start to running demo (fabric mode)

```bash
# 0. Branch. (Use main — v3-similar-invoice-flag no longer exists.)
cd ~/invoice-trust-ledger && git checkout main && git status

# 1. Fabric network + chaincode (state is wiped by 'down', so this is a fresh ledger)
cd ~/fabric/fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
./network.sh deployCC -ccn invoicecc -ccp ~/invoice-trust-ledger/chaincode -ccl javascript
docker ps --format 'table {{.Names}}\t{{.Status}}'   # expect 8 containers

# 2. API — ALWAYS via restart.sh (never `node server.js &`). Confirm it prints LEDGER_MODE = fabric.
cd ~/invoice-trust-ledger/api
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
kill shot":** after Lloyds has financed an invoice, a second lender (OtherBank) clicks its own
still-enabled Fund button, and the **ledger itself** rejects the transaction with a red
`DUPLICATE FINANCING BLOCKED` banner — proving the guarantee holds at the ledger layer even if the
app's role checks were bypassed, and that no lender can see who the other lender was. The whole
backend sits behind one swappable interface (`api/ledger.js`) so the same rules can later run on
Google's GCUL ledger by implementing a single file.
