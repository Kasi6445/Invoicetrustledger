# DEMO_SCRIPT.md — 6 minutes, rehearse verbatim

Setup before walking in: ledger up · API running · `node seed.js` done · portal open · both PDFs on desktop · zoom 125%.

1. **[30s] Frame it.** "Invoice financing fraud works because lenders can't see each other's books. This is a shared, tamper-proof registry all three parties write to — running live on this laptop. Watch the full lifecycle."

2. **[75s] Register — with AI.** Sign in **Supplier**. Upload the clean invoice PDF → fields fill themselves ("that's the Gemini-powered document OCR"). Register → **REGISTERED**. "The document's SHA-256 hash is now anchored on the ledger — the PDF itself stays off-chain. Proofs on-chain, sensitive data off-chain."

3. **[45s] Approve.** Log out, sign in **Payer**. "The payer confirms commercial truth — and notice: the supplier's bank account is masked to last-4, sort code hidden, no lender risk data. Field-level access control." Approve → **APPROVED**.

4. **[60s] Verify & fund.** Sign in **Lloyds Bank**. Expand the risk grade → read two reasons aloud ("explainable, every point derived from the ledger"). Fund → **FINANCED**.

5. **[45s] 🎯 THE KILL SHOT.** Sign in **OtherBank NBFC**. "A fraudulent supplier just shopped the same invoice across town." Click Fund → red banner: **DUPLICATE FINANCING BLOCKED: already financed by Lloyds Bank at …** — "That rejection didn't come from our app. It came from the ledger's own rules. No participant can bypass it."

6. **[45s] Immutability.** Open **Audit trail** → walk the timeline: registered → approved → financed, each with a transaction id and timestamp. Click **verify ledger** in the header → "chain intact." Optional: as Supplier, register the tampered ₹7,50,000 PDF (same invoice number) → back as lender, the ⚠ **tamper flag** appears.

7. **[40s] Close.** "The ledger sits behind a thin adapter: today Hyperledger Fabric [or: a hash-chained ledger], tomorrow Google Cloud Universal Ledger — GCUL is in private testnet, and when Google opens access it drops in behind the same interface with zero changes to what you just saw. Questions?"
