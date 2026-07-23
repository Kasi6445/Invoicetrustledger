# RUNBOOK — 3 days to demo. Commands only.

Rule one: stuck >15 min → paste the command + FULL output into Claude.

> **Known cleanup item:** this file is duplicated at `RUNBOOK.md` (repo root) and
> `docs/RUNBOOK.md`, byte-for-byte. Both must be edited together or they drift. CLAUDE.md
> points at the `docs/` copy. Worth collapsing to one file (make the other a symlink, or
> delete the root copy and fix the references) — not urgent, but do it before the two
> versions diverge silently.

---

## DAY 1 — Working demo in mock mode (no Docker needed). ~2–3 h

Prereq: Node.js 20+ (`node -v`). Windows: do everything inside the Ubuntu (WSL) terminal.

```bash
# 1. Put the project in place (adjust if you cloned from GitHub instead)
cd ~ && unzip invoice-trust-ledger.zip && cd invoice-trust-ledger

# 2. API
cd api
cp .env.example .env          # defaults are fine: LEDGER_MODE=mock
npm install
node server.js                # leave running
```

New terminal:
```bash
cd ~/invoice-trust-ledger/api
bash test-flow.sh             # MUST print: RESULT: 22 passed, 0 failed
node seed.js                  # demo data: one FINANCED, one APPROVED invoice
```

New terminal:
```bash
cd ~/invoice-trust-ledger/portal
npm install
npm run dev                   # open http://localhost:5173
```

Click through the whole demo now (script in DEMO_SCRIPT.md):
supplier1 register → payer1 approve → lloyds fund → **otherbank fund → red DUPLICATE FINANCING BLOCKED banner** → audit trail → "verify ledger" pill in the header.

✅ Day 1 gate: test-flow.sh all green + you performed the kill shot in the browser.
**From this moment you always have a demo.** Everything after is upgrade, not risk.

Reset demo data anytime (mock mode): stop API → `rm -rf api/data` → start API → `node seed.js`.

---

## DAY 2 — Real blockchain + real AI. ~3–4 h

### 2a. Gemini key (10 min)
aistudio.google.com → Get API key → paste into `api/.env` as `GEMINI_API_KEY=` → restart `node server.js`.
Test: upload `docs/test-invoices/invoice-clean.html` (print it to PDF first: open in browser → Ctrl+P → Save as PDF) in SupplierView → fields fill from the real document.
No key / no internet? The API auto-falls back to built-in sample fields (labelled simulated) — demo never dies.

### 2b. Docker + Fabric
Install Docker per the build guide §4 (Windows: WSL2 first, then Docker Desktop with WSL integration ON). Gate: `docker run hello-world`.

```bash
# Download Fabric samples + binaries + images (one-time, use hotspot if office network blocks it)
cd ~ && mkdir -p fabric && cd fabric
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh -o install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker samples binary

# Start the network
cd ~/fabric/fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
docker ps --format 'table {{.Names}}\t{{.Status}}'   # peers + orderer + CAs all "Up"

# Deploy OUR chaincode
./network.sh deployCC -ccn invoicecc -ccp ~/invoice-trust-ledger/chaincode -ccl javascript
```

Smoke test (optional but 2 min — proves chaincode works before touching the API):
```bash
cd ~/fabric/fabric-samples/test-network
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=$PWD/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls \
  --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C mychannel -n invoicecc \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"RegisterInvoice","Args":["inv-cli-001","INV-CLI-001","Sri Lakshmi Textiles","VRN123456","BigRetail Ltd","500000","450000","INR","2026-07-05","2026-08-30","{}"]}'

sleep 2
peer chaincode query -C mychannel -n invoicecc -c '{"function":"ReadInvoice","Args":["inv-cli-001"]}'

# Duplicate check. Re-running the SAME invoke verbatim is NOT the right test: it
# trips Rule 0 ("Invoice id inv-cli-001 already exists"), which is checked before
# the number check and only proves the ledger key is taken. To exercise R1 you need
# a DIFFERENT invoiceId carrying the same invoiceNumber + supplierVRN (amount is
# irrelevant — the number itself is single-use per supplier):
peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls \
  --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C mychannel -n invoicecc \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"RegisterInvoice","Args":["inv-cli-002","INV-CLI-001","Sri Lakshmi Textiles","VRN123456","BigRetail Ltd","500000","450000","INR","2026-07-05","2026-08-30","{}"]}'
# → must FAIL with DUPLICATE INVOICE BLOCKED ✅
# (11 positional args now: … amount, requestedAmount, currency, invoiceDate, dueDate, docHashes;
#  pass {} for docHashes — nested JSON inside -c '{"Args":[…]}' is quote-hell in bash.)
# What this proves: the same real-world invoice cannot be put on the ledger twice
# even under a brand-new ledger key — the rule is enforced on the invoice NUMBER
# per supplier, not merely on the storage key. That is the registration-side
# counterpart to the DUPLICATE FINANCING BLOCKED kill shot.

# Optional, proves the tamper wording: same number+supplier, DIFFERENT amount →
# also REJECTED, and the message ends with "Possible tampered or fake invoice."
# Re-run the invoke above with Args inv-cli-003 / ... / "750000" and read the error.
```

### 2c. Flip the API to the real chain
```bash
# api/.env:
#   LEDGER_MODE=fabric
#   FABRIC_SAMPLES=/home/<yourname>/fabric/fabric-samples     (run: whoami)
cd ~/invoice-trust-ledger/api
node server.js                # restart
bash test-flow.sh             # same 22 greens — now every write is a Fabric transaction
node seed.js
```
Open the portal → audit trail → the tx ids are now genuine Fabric transaction ids.

✅ Day 2 gate: test-flow.sh green in fabric mode.
❌ Docker impossible on every machine? **Plan B = stay in mock mode.** It's already a persistent, hash-chained, tamper-evident ledger with `verifyChain()` — see JUDGE_QA.md for the exact pitch line. Zero code changes.

---

## DAY 3 — Rehearse & harden. ~2–3 h

```bash
# The morning ritual (memorise; also needed after any reboot):
# 0. THE DEMO RUNS FROM THE `v3-similar-invoice-flag` BRANCH, *not* main.
#    main is the pre-v2 code and does NOT have single-use invoice numbers,
#    lender decline/anonymity, the similar-invoice flag, or any CR01 feature.
#    Check every morning before anything else:
cd ~/invoice-trust-ledger && git checkout v3-similar-invoice-flag && git status
# fabric mode:
cd ~/fabric/fabric-samples/test-network && ./network.sh down && ./network.sh up createChannel -c mychannel -ca && ./network.sh deployCC -ccn invoicecc -ccp ~/invoice-trust-ledger/chaincode -ccl javascript
# Start the API with restart.sh — it kills whatever holds :3000 by socket-owner
# PID (never a name match), refuses to start on a busy port, and prints the
# LEDGER_MODE it came up in. NEVER `node server.js &` by hand — a stale server
# on the port serves old code silently.
cd ~/invoice-trust-ledger/api && bash restart.sh    # <- confirm it prints LEDGER_MODE = fabric
node seed.js
cd ~/invoice-trust-ledger/portal && npm run dev
# mock mode: skip the fabric lines; set LEDGER_MODE=mock in api/.env, rm -rf api/data, then restart.sh.
# After editing api/*.js or the chaincode later, re-run `bash restart.sh` (not a bare node).
```

1. Print both files in `docs/test-invoices/` to PDF (clean ₹5,00,000 + tampered ₹7,50,000). Keep on desktop.
2. Run DEMO_SCRIPT.md end-to-end ×3, timed under 7 min. The tampered PDF at step 6 is rejected live: DUPLICATE INVOICE BLOCKED … Possible tampered or fake invoice.
3. Reset drill once: full down → up → deploy → seed → demo in under 10 min.
4. Screen-record one perfect run (backup video on phone + pen drive).
5. Read JUDGE_QA.md out loud once as a team. Freeze code — no changes after tonight.

Pre-walk-in checklist: network up (fabric mode) · API running · seeded · portal open · both PDFs on desktop · hotspot on (Gemini) · notifications off · browser zoom 125% · backup video reachable.

---

## Redeploying chaincode after a code change (e.g. CR01)

Any edit to `chaincode/lib/invoiceContract.js` must be pushed to the peers, and
the `mockLedger` in `api/mockLedger.js` must carry the identical rule change.

- **Clean-slate (what we do for the demo):** `./network.sh down` then `up createChannel`
  then `deployCC` — a fresh channel starts at version 1 / sequence 1, so no
  `-ccv/-ccs` needed. The ledger is wiped, so re-run `seed.js`.
- **In-place upgrade (no teardown):** increment BOTH the version and the sequence
  each time, e.g. `./network.sh deployCC -ccn invoicecc -ccp ~/invoice-trust-ledger/chaincode -ccl javascript -ccv 2 -ccs 2`
  (next time `-ccv 3 -ccs 3`). Check the committed sequence first with
  `peer lifecycle chaincode querycommitted -C mychannel -n invoicecc`.
- **ALWAYS restart the API after any network down/up** (`node server.js`): the
  Fabric crypto material (certs) is regenerated on a fresh network, so a gateway
  connection opened against the old certs fails — and it surfaces as a confusing
  "endorsement failure", not an obvious auth error.

CR01 note: `RegisterInvoice` now takes 11 positional args
(`… amount, requestedAmount, currency, invoiceDate, dueDate, docHashes`). For a
bash/CLI smoke test pass `{}` as the final `docHashes` arg — nested JSON inside
`-c '{"Args":[...]}'` is quote-hell in bash.

## LATER — The GCUL swap (when Google grants access)

1. Port the rules in `docs/RULES.md` to a GCUL Python smart contract (they are written language-neutrally for exactly this).
2. Implement `api/gculLedger.js` — the interface and per-function mapping are documented inside the file.
3. `api/.env` → `LEDGER_MODE=gcul` → restart → `bash test-flow.sh`. Same 22 tests must pass. Nothing else in the system changes.
