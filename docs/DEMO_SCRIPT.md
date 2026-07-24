# DEMO_SCRIPT.md — 6 minutes, rehearse verbatim

Setup before walking in: ledger up · API running · `node seed.js` done · portal open · both PDFs on desktop · zoom 125%.

1. **[30s] Frame it.** "Invoice financing fraud works because lenders can't see each other's books. This is a shared, tamper-proof registry all three parties write to — running live on this laptop. Watch the full lifecycle."

2. **[75s] Register — with AI.** Sign in **Supplier**. Upload the clean invoice PDF → fields fill themselves ("that's the Gemini-powered document OCR"). Register → **REGISTERED**. "The document's SHA-256 hash is now anchored on the ledger — the PDF itself stays off-chain. Proofs on-chain, sensitive data off-chain."

3. **[45s] Approve.** Log out, sign in **Payer**. "The payer confirms commercial truth — and notice: the supplier's bank account is masked to last-4, sort code hidden, no lender risk data. Field-level access control." Approve → **APPROVED**.

4. **[80s] Verify & fund.** Sign in **Lloyds Bank**. First, **Verify document** on the invoice row → green **"Integrity confirmed — byte-identical to the document anchored on the ledger,"** with the anchored and recomputed SHA-256 shown one under the other, matching. "Before we advance a penny, we can prove the copy we're funding is exactly the one the payer approved. The PDF lives off-chain and could be swapped by an insider — but its fingerprint is on the ledger, so a swap turns this check red instantly." Then open **How the risk grade is calculated** (the legend) — "the whole model, rule-based, every point maps to a fact on the ledger, no black box" — and expand the grade to read two reasons aloud. Fund → **FINANCED**.

5. **[45s] 🎯 THE KILL SHOT.** Sign in **Meridian Invoice Finance Ltd**. "A fraudulent supplier just shopped the same invoice across town." The console opens on **Ready to fund** — switch to the **All** tab (or type the invoice number in the search box) to reach the financed invoice; its Fund button is still live. Click Fund → red banner: **DUPLICATE FINANCING BLOCKED: this invoice has already been financed by another financial institution at …** — "That rejection didn't come from our app. It came from the ledger's own rules. And notice: Meridian is never told WHO financed it — one lender never sees another lender's book."

6. **[45s] Immutability + fake invoice.** Open **Audit trail** → walk the timeline: registered → approved → financed, each with a transaction id and timestamp. Click **verify ledger** in the header → "chain intact." Then as Supplier, register the altered £127,500 PDF (same invoice number) → red banner, live, at registration: **DUPLICATE INVOICE BLOCKED … Possible tampered or fake invoice.** — "An invoice number is single-use per supplier. The tampered resubmission never even gets onto the ledger."

   *Optional 10s beat:* as **Meridian**, Decline an APPROVED invoice ("Outside risk appetite") → as **Lloyds**, expand its risk grade: **⚠ Declined by 1 institution(s)** — the decline is shared as a signal, but the decliner's name is masked and the invoice stays fundable.

   *Optional 15s beat — real-world provenance:* as **Lloyds**, click **Companies House** on the supplier's row → green **"Active company on the register,"** with the company number and incorporation date. "We key every supplier on its Companies House number and check it's a real, active company — a live call to the register when we're online, a cached snapshot when we're not, so it never stalls."

   *Optional 15s beat — the number-change workaround:* as **Supplier**, re-upload the original £85,000 PDF but type a NEW invoice number → it registers ("changing the number gets past the front door…") → as **Lloyds**, the row carries an amber **⚠ similar** chip and the expanded grade reads **⚠ Same document already registered as … (−25)** with a degraded grade → Lloyds clicks **Decline** citing it: "…but the identical document is flagged on sight — detection in the system, decision with the institution."

7. **[40s] Close.** "The ledger sits behind a thin adapter: today Hyperledger Fabric [or: a hash-chained ledger], tomorrow Google Cloud Universal Ledger — GCUL is in private testnet, and when Google opens access it drops in behind the same interface with zero changes to what you just saw. Questions?"
