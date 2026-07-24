# UK regulatory context — Q&A ammunition

Not code. This is the regulatory backing for the Invoice Trust Ledger, written for a Lloyds / UK
banking audience. One short paragraph per topic. **Honesty rule:** where a control is designed but
not built in the prototype, it says so — the demo labels its mocks, and so does this.

**Built today:** separation of duty (role-based field masking), document-hash anchoring +
integrity check against the ledger record, immutable per-invoice audit trail, the on-chain /
off-chain data split, and a Companies House register check for the supplier (a live call when an
API key is configured, degrading to a cached snapshot otherwise). **Designed and scoped, not
built:** maker-checker dual approval, exposure / trading-relationship limits, and the remaining
external provenance checks (HMRC VAT, Confirmation of Payee, Open Banking settlement history) —
see "What we'd add next".

---

**Data protection — the strongest architectural answer for a UK bank.** UK GDPR Article 16
(rectification) and Article 17 (erasure) sit awkwardly with an immutable ledger. Our on-chain /
off-chain split is the standard mitigation: personal and commercial data live off-chain (in
`api/offchain.js`); only hashes, statuses and timestamps go on-chain. Erasure is effected by
destroying the off-chain record, leaving an orphaned hash that reveals nothing. **Implementation
requirement (not yet built): salt every hash of a personal-data field with a per-record secret held
off-chain** — an unsalted hash of a low-entropy field is brute-forceable, and the ICO's position is
that it may still constitute personal data. Field masking (`api/masking.js`) implements Article
5(1)(c) data minimisation and Article 25 data protection by design and by default, all under the
Data Protection Act 2018.

**Financial crime.** Customer due diligence (CDD) and enhanced due diligence (EDD) under the Money
Laundering Regulations 2017, following JMLSG guidance, with suspicious activity reporting under the
Proceeds of Crime Act 2002 and systems-and-controls obligations under FCA Handbook SYSC 6 and the
FCA Financial Crime Guide. We verify Persons with Significant Control (PSC) rather than "UBO". The
ledger's permanent, attributable record of who approved and who financed each invoice is exactly
the kind of audit evidence a financial-crime function needs.

**Corporate criminal liability.** The failure-to-prevent-fraud offence under section 199 of the
Economic Crime and Corporate Transparency Act 2023 came into force on 1 September 2025 for large
organisations, with a defence of having reasonable fraud-prevention procedures in place. The
controls this system provides — separation of duty, an immutable audit trail and document
verification today; maker-checker approval and exposure limits by design — are exactly the kind of
documented, proportionate procedure that defence contemplates. Frame the system as a compliance
asset, not only a fraud tool.

**Companies House reliability.** Mandatory identity verification for new directors and PSCs came
into force on 18 November 2025, with existing directors and PSCs expected to be verified by autumn
2026 and enforcement activity from the end of 2026. This makes Companies House a materially stronger
know-your-business source than it was, and it is why we key every supplier on its Companies House
number (CRN) as the primary entity identifier. The prototype wires a register check against the
supplier's CRN — a live Companies House call when an API key is configured, degrading to a cached
register snapshot on a missing key, timeout, or error, so it never blocks the flow.

**Assignment of receivables.** A legal assignment of a debt requires express written notice to the
debtor under section 136 of the Law of Property Act 1925. Our payer-approval step is, in substance,
an immutably recorded notice of assignment — the debtor (payer) confirms the invoice on a permanent,
timestamped, attributable record. The Business Contract Terms (Assignment of Receivables)
Regulations 2018 nullify most anti-assignment clauses in B2B contracts specifically to support SME
invoice finance — the market this system serves.

**Electronic trade documents.** The Electronic Trade Documents Act 2023 gives legal effect to
electronic trade documents where the system provides exclusive control, divestibility and
reliability. Invoices are not themselves in the Act's listed categories, but the "reliable system"
gateway describes precisely what a permissioned ledger provides, and the direction of travel
favours this architecture.

**Regulatory perimeter — be accurate.** Invoice finance to corporate customers is largely outside
the FSMA regulated perimeter; the FCA regulates it only where a small sole trader or partnership
falls within a regulated credit agreement. Lloyds nonetheless subscribes to the Lending Standards
Board's Standards for Lending Practice for business customers, and UK Finance maintains the
standards framework for invoice finance and asset-based lending. **Do not claim the product is
FCA-regulated when it generally is not** — a Lloyds judge will know.

**Operational resilience and third parties.** Production deployment engages FCA PS21/3 and PRA
SS1/21 on operational resilience, and PRA SS2/21 on outsourcing and third-party risk. **Flag
honestly:** sending customer invoice documents to the Gemini API is a material third-party and
international-transfer question. In production this would be a UK-region or in-tenancy model,
covered by a DPIA, an SS2/21 third-party assessment, and an IDTA or the UK Addendum for any transfer
outside the UK. Say this before a judge asks. (The prototype already fails safe here: with no API
key or no network, OCR falls back to a clearly-labelled `simulated` response — `api/gemini.js`.)

**The e-invoicing horizon (why this exists at all).** UK mandatory e-invoicing arrives in April
2029 on a Peppol four-corner model, confirmed at Autumn Budget 2025 with Peppol named as the
interoperability network in June 2026. Structured invoices will flow between private access points;
HMRC will not receive invoice data in real time, and no participant will hold a shared record of
which invoices have already been financed. There is no central invoice registry and no government
attestation of individual invoices. That financing-visibility gap is precisely what this ledger
fills — and it is a gap that 2029 does not close.

---

## What we cannot detect (say it before a judge finds it)

A fully consistent fabricated invoice — from a long-established supplier with a genuine trading
history, approved by a colluding payer — will pass every control we have. It will be caught at
settlement, and the permanent, attributable ledger record makes both parties individually liable
afterwards. State this plainly rather than let a judge surface it.

## What we'd add next (design, not built)

- **Global document-hash index → invoice-mill detection.** Today the similar-invoice flag is a
  read-time comparison. A *global* index on `docHash` would catch a different, sharper fraud
  pattern: the **same PDF registered by two unrelated supplier entities** — which is what an
  invoice mill looks like. It is roughly ten lines plus a chaincode redeploy, and it is not a demo
  beat, but it is a genuine gap worth naming.
- **HMRC VAT verification** — the Companies House register check is wired today; the companion
  step is a real HMRC call confirming the supplier's VAT number resolves to the registered legal
  name, closing the gap between "a real company exists" and "this VAT-registered trader is them".
- **Confirmation of Payee (Pay.UK)** — the UK penny-drop equivalent; stops funds being advanced to
  an account unconnected to the registered supplier.
- **Open Banking settlement history (AISP)** — with the supplier's consent, confirm this payer has
  genuinely settled invoices to this supplier before. A colluding pair can fabricate a document and
  an approval; they cannot fabricate a history of real inbound payments. This is the UK's strongest
  answer to collusion and is stronger than anything a clearance-model jurisdiction offers.
- **Maker-checker dual approval and exposure / trading-relationship limits** — separation-of-duty
  and concentration controls that map directly onto the ECCTA reasonable-procedures defence.

See `docs/RULES.md` for the enforced ledger invariants and the role/field masking matrix.
