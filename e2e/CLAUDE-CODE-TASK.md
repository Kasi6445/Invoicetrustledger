# TASK: Make this Playwright suite pass and produce video evidence

You are working inside `~/invoice-trust-ledger/e2e/`. This folder contains a
Playwright TypeScript suite for the Invoice Trust Ledger prototype. Your job is
to get it fully green and collect the evidence artefacts. Follow these steps
in order. Ask before doing anything destructive.

## 0. Context you must read first

- Read the top-of-file comments in ALL THREE specs:
  `tests/api-regression.spec.ts` (backend contract),
  `tests/invoice-lifecycle.spec.ts` (full flow, unique numbers = repeatable),
  `tests/real-documents.spec.ts` (the actual fixture PDFs AS-IS: duplicate
  registration blocked, tampered-PDF tamper flag, OCR across two layouts,
  and a cryptographic docHash === sha256(file) proof). The real-documents
  spec is STATE-TOLERANT: it inspects the ledger via API first and branches,
  so it passes on a fresh ledger AND on one already carrying INV-2026-007.
- Read `../portal/src/Login.jsx`, `SupplierView.jsx`, `PayerView.jsx`,
  `App.jsx`, `LenderView.jsx`, `AuditTrail.jsx`. The first four were
  AI-generated, so the spec's selectors marked `[ADAPT]` are best-effort
  guesses. **Reconcile every `[ADAPT]` selector against the real components
  before running.** LenderView and AuditTrail match the build guide verbatim —
  their selectors should already be correct.

## 1. Preconditions — verify, do not assume

All three must already be running (start them if not, each in its own terminal):

1. Fabric network up + `invoicecc` deployed
   (`docker ps` shows peers/orderer + two `dev-peer...invoicecc` containers)
2. API: `cd ~/invoice-trust-ledger/api && node server.js`
   — confirm it logs `Ledger mode: fabric` on first ledger call
3. Portal: `cd ~/invoice-trust-ledger/portal && npm run dev`

ALL THREE fixture PDFs must be in `fixtures/`:

    invoice-clean-INV-2026-007.pdf
    invoice-TAMPERED-INV-2026-007.pdf
    invoice-clean-INV-2026-014.pdf

Copy any missing ones from Windows Downloads (adjust the username):

    cp /mnt/c/Users/<WindowsName>/Downloads/invoice-*.pdf fixtures/

(The clean 007 also exists in `../api/data/docs/` from the morning's upload.)
If a file cannot be found, ask the user where they saved it.

Verify the Gemini key is live WITHOUT printing it:

    cd ../api && node -e "require('dotenv').config(); console.log('key length:', (process.env.GEMINI_API_KEY||'').length)" && cd ../e2e

Length ~40-55 = fine. 0 or 19 = placeholder; stop and ask the user to fix it.

## 2. Install

    npm install
    npx playwright install --with-deps chromium

(`--with-deps` needs sudo on WSL; if the user's sudo is unavailable, fall back
to `npx playwright install chromium` and install missing OS libs individually
as errors name them.)

## 3. Run order

1. `npm run test:api` first — it is selector-proof and validates the whole
   backend contract. If anything fails here, the problem is servers/chaincode,
   NOT the UI spec. Fix that first (check the API terminal's output).
2. `npx playwright test tests/invoice-lifecycle.spec.ts --project=ui-evidence --headed`
   — watch it drive the browser. On any selector failure: open the failing
   component in `../portal/src/`, fix the locator in the spec, re-run.
   Iterate until green. Do NOT weaken assertions to pass — the assertions
   ARE the evidence.
3. `npx playwright test tests/real-documents.spec.ts --project=ui-evidence --headed`
   — same drill. This spec uploads real PDFs 3-4 times (Gemini calls), so if
   iterating on selector fixes, wait ~60s between attempts.
4. Final clean run for the record, everything headless: `npm run test`.

## 4. Constraints — do not violate

- **Gemini quota:** a full UI run makes up to 5 /ai/extract calls
  (1 lifecycle + up to 4 real-documents). Free tier is 10 req/min, ~250/day.
  Wait ~60s between full UI runs; on a 429, wait 60s and rerun only the
  failing spec. The API suite makes ZERO Gemini calls and can be run freely.
- **Never** print, log, echo, or commit the contents of `../api/.env`.
- Do not modify chaincode, API, or portal source to make tests pass, with one
  exception: if a portal component has a genuine bug the test exposes, report
  it to the user with the proposed fix and ask before changing it.
- Do not run `network.sh down` — it wipes the ledger and regenerates certs.

## 5. Deliverables — collect and report

When green, produce the evidence package:

1. Write `evidence/INDEX.md`: one line per artifact explaining what it proves,
   grouped by scenario, quoting the docHash lines from `evidence/hash-proof.txt`.
2. Copy the main-flow video(s) from `test-results/**/video.webm` into
   `evidence/` with descriptive names (e.g. `full-lifecycle.webm`).
3. `cd .. && zip -r e2e/evidence-package.zip e2e/evidence e2e/playwright-report`
4. Tell the user the absolute paths of: `evidence/` (with INDEX.md),
   `evidence-package.zip`, and how to open the HTML report (`npm run report`).

Expected artifacts checklist:
- 01-08 PNGs (lifecycle: OCR, registered, approved, financed, KILL SHOT,
  audit trail, tamper flag) + R1-R4 PNGs (second layout OCR, duplicate
  registration blocked, tampered OCR, lender tamper flag)
- `otherbank-kill-shot.webm` + full-flow videos
- `hash-proof.txt` — sha256(file) vs on-chain docHash, matching

Finally, offer to commit the suite:
`git add e2e && git commit -m "e2e evidence suite" ` — confirm with the user
first, and verify `e2e/node_modules`, `e2e/test-results`,
`e2e/playwright-report` are gitignored before committing.

## 6. Known troubleshooting map

| Symptom | Cause | Fix |
|---|---|---|
| global-setup: API not reachable | server not running / crashed | restart `node server.js`, read its terminal |
| Gemini 429 with `limit: 0` and model 2.0-flash | server running old code | confirm `grep MODEL ../api/gemini.js` says 2.5-flash, restart the API |
| Gemini 429 on 2.5-flash | real rate limit | wait 60s, re-run UI test only |
| `14 UNAVAILABLE ... first certificate` in API logs | API started before last network up | restart the API server |
| OCR assertion times out but manual register works | extraction failing | check API terminal for the /ai/extract error and report it |
| Kill-shot step: OtherBank button already disabled | its page refreshed after Lloyds funded | re-run; the spec opens OtherBank BEFORE funding — check step order wasn't altered |
