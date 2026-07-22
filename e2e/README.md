# Invoice Trust Ledger — E2E Evidence & Regression Suite

Playwright suite that records **video evidence** of the full invoice lifecycle
(Gemini OCR autofill → register → approve → fund → **DUPLICATE FINANCING
BLOCKED** → audit trail → tamper flag) plus a selector-proof **API regression
layer** for every business rule.

## Quick start (manual)

    # Servers must already be running: Fabric + chaincode, API :3000, portal :5173
    cp <path-to>/invoice-clean-INV-2026-007.pdf fixtures/
    npm install
    npx playwright install --with-deps chromium
    npm run test:api          # backend contract, fast, zero Gemini calls
    npm run test:ui:headed    # full flow, watch it live, records video
    npm run report            # HTML report with videos + traces

## With Claude Code (recommended)

    cd ~/invoice-trust-ledger/e2e
    claude
    # then: "Read CLAUDE-CODE-TASK.md and complete the task it describes."

## Evidence lands in

- `evidence/*.png` — numbered screenshots of each milestone
- `evidence/otherbank-kill-shot.webm` — the rejection banner recording
- `test-results/**/video.webm` — the full-flow video
- `playwright-report/` — shareable HTML report

## Design notes

- Repeatable: unique invoice number per run (chaincode blocks duplicate
  fingerprints forever, by design).
- One Gemini call per UI run; API suite makes none. Free tier: 10/min.
- The kill shot uses a two-browser race: OtherBank's console opens while the
  invoice is still APPROVED, Lloyds funds it, then OtherBank's stale Fund
  click is rejected by the chaincode — the honest fraud scenario.
