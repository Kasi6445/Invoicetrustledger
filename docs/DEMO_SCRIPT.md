# DEMO_SCRIPT.md — 6 minutes, rehearse verbatim

Setup before walking in: ledger up · API running · `node seed.js` done · portal open · both PDFs on desktop · zoom 125%.

1. **[30s] Frame it.** "Invoice financing fraud works because lenders can't see each other's books. This is a shared, tamper-proof registry all three parties write to — running live on this laptop. Watch the full lifecycle."

2. **[75s] Register — with AI.** Sign in **Supplier**. Upload the clean invoice PDF → fields fill themselves ("that's the Gemini-powered document OCR"). Register → **REGISTERED**. "The document's SHA-256 hash is now anchored on the ledger — the PDF itself stays off-chain. Proofs on-chain, sensitive data off-chain."

3. **[45s] Approve.** Log out, sign in **Payer**. "The payer confirms commercial truth — and notice: the supplier's bank account is masked to last-4, sort code hidden, no lender risk data. Field-level access control." Approve → **APPROVED**.

4. **[60s] Verify & fund.** Sign in **Lloyds Bank**. Expand the risk grade → read two reasons aloud ("explainable, every point derived from the ledger"). Fund → **FINANCED**.

5. **[45s] 🎯 THE KILL SHOT.** Sign in **OtherBank NBFC**. "A fraudulent supplier just shopped the same invoice across town." The console opens on **Ready to fund** — switch to the **All** tab (or type the invoice number in the search box) to reach the financed invoice; its Fund button is still live. Click Fund → red banner: **DUPLICATE FINANCING BLOCKED: this invoice has already been financed by another financial institution at …** — "That rejection didn't come from our app. It came from the ledger's own rules. And notice: OtherBank is never told WHO financed it — one lender never sees another lender's book."

6. **[45s] Immutability + fake invoice.** Open **Audit trail** → walk the timeline: registered → approved → financed, each with a transaction id and timestamp. Click **verify ledger** in the header → "chain intact." Then as Supplier, register the altered ₹7,50,000 PDF (same invoice number) → red banner, live, at registration: **DUPLICATE INVOICE BLOCKED … Possible tampered or fake invoice.** — "An invoice number is single-use per supplier. The tampered resubmission never even gets onto the ledger."

   *Optional 10s beat:* as **OtherBank**, Decline an APPROVED invoice ("Outside risk appetite") → as **Lloyds**, expand its risk grade: **⚠ Declined by 1 institution(s)** — the decline is shared as a signal, but the decliner's name is masked and the invoice stays fundable.

   *Optional 15s beat — the number-change workaround:* as **Supplier**, re-upload the original ₹5,00,000 PDF but type a NEW invoice number → it registers ("changing the number gets past the front door…") → as **Lloyds**, the row carries an amber **⚠ similar** chip and the expanded grade reads **⚠ Same document already registered as … (−25)** with a degraded grade → Lloyds clicks **Decline** citing it: "…but the identical document is flagged on sight — detection in the system, decision with the institution."

7. **[40s] Close.** "The ledger sits behind a thin adapter: today Hyperledger Fabric [or: a hash-chained ledger], tomorrow Google Cloud Universal Ledger — GCUL is in private testnet, and when Google opens access it drops in behind the same interface with zero changes to what you just saw. Questions?"
