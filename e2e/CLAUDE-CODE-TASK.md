# TASK: Make this Playwright suite pass and produce video evidence

You are working inside `~/invoice-trust-ledger/e2e/`. This folder contains a
Playwright TypeScript suite for the Invoice Trust Ledger prototype. Your job is
to get it fully green and collect the evidence artefacts. Follow these steps
in order. Ask before doing anything destructive.

## 0. Context you must read first

- Read `tests/invoice-lifecycle.spec.ts` and `tests/api-regression.spec.ts`
  top-of-file comments — they explain the flow and the repeatability design
  (unique invoice numbers per run, because the chaincode permanently blocks
  duplicate fingerprints).
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

Copy the PDF fixture (adjust the Windows username):

    cp /mnt/c/Users/<WindowsName>/Downloads/invoice-clean-INV-2026-007.pdf fixtures/

If the file cannot be found, ask the user where they saved it.

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
2. `npm run test:ui:headed` — watch it drive the browser. On any selector
   failure: open the failing component in `../portal/src/`, fix the locator in
   the spec, re-run. Iterate until green. Do NOT weaken assertions to pass —
   the assertions ARE the evidence.
3. Final clean run for the record: `npm run test:ui` (headless).

## 4. Constraints — do not violate

- **Gemini quota:** the UI test makes exactly ONE Gemini call per run
  (the PDF upload). Free tier is 10 req/min. Never loop the UI test rapidly;
  wait ~60s between UI runs if a 429 appears. The API suite makes ZERO
  Gemini calls and can be run freely.
- **Never** print, log, echo, or commit the contents of `../api/.env`.
- Do not modify chaincode, API, or portal source to make tests pass, with one
  exception: if a portal component has a genuine bug the test exposes, report
  it to the user with the proposed fix and ask before changing it.
- Do not run `network.sh down` — it wipes the ledger and regenerates certs.

## 5. Deliverables — collect and report

When green, tell the user exactly where these are:

- `evidence/*.png` — numbered screenshots of every key moment
  (OCR autofill, registered, approved, financed, KILL SHOT banner,
  audit trail, tamper flag)
- `evidence/otherbank-kill-shot.webm` — the second lender's screen recording
  showing the red DUPLICATE FINANCING BLOCKED banner
- Main flow video: `test-results/**/video.webm` (also embedded in the HTML
  report)
- `npm run report` — the shareable HTML report with trace + videos

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
