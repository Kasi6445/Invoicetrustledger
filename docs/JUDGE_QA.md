# JUDGE_QA.md — anticipated questions, 2-sentence answers

**"Why isn't this on GCUL if that's your target?"**
GCUL is in private testnet (CME Group pilot) with no public developer access or published technical docs yet. So we run identical ledger invariants behind a swappable adapter — `LEDGER_MODE=gcul` and one adapter file is the entire migration; the rules are already specified language-neutrally in RULES.md for GCUL's Python contracts.

**"Is this really a blockchain or just a database?"**
(fabric mode) Real Hyperledger Fabric — `docker ps` shows peers and orderer live, and every audit-trail tx id is a Fabric transaction. (mock/Plan B mode) It's a hash-chained append-only ledger: each entry stores the SHA-256 of the previous one, and `verifyChain()` recomputes the whole chain on demand — same tamper-evidence principle, production target is Fabric/GCUL behind the identical adapter.

**"What stops a lender bypassing your app and financing twice?"**
The rule lives in the ledger, not the app: the contract itself rejects any FundInvoice on a FINANCED record, regardless of caller. The API layer adds role checks on top, but the invariant holds even if the API had a bug.

**"Why only two Fabric orgs / where's the third party?"**
That's the standard test-network topology; production adds one org per party with its own peer, and the chaincode is unchanged. Today business roles are enforced in the app layer (JWT) plus invariants in chaincode; production uses Fabric's attribute-based access control tied to certificates.

**"Why Fabric over Ethereum?"**
Banks need permissioned membership, data privacy, and predictable costs with no gas token — which is exactly the permissioned model Fabric was built for and, notably, the model GCUL itself uses (KYC-verified participants, fees invoiced, not gas).

**"How does the lender know the PDF wasn't swapped after registration?"**
Recompute the file's SHA-256 and compare it with the on-chain `docHash` — a one-line check. The document lives off-chain; only its fingerprint is on the ledger.

**"What if the supplier edits the amount and resubmits?"**
Same invoice number + supplier with a different amount registers but is stamped with a permanent tamper flag naming both amounts — you saw it appear live, and it drags the risk grade down.

**"Is the risk score AI?"**
Deliberately not a black box: it's rule-based and every point is derived from the ledger (payer approval, tamper flag, anchored document, due-date window, amount band) — expand any grade and read the reasons. The AI in the system is the Gemini document extraction.

**"What's mocked?"**
Honestly scoped: cloud deployment (runs locally in Docker — cloud-deployable), ERP/core-banking/UPI/KYC integrations (stubbed), and OAuth2/OIDC (simple JWT logins — OIDC-ready). The ledger, the contract rules, the role masking and the AI extraction are real.

**"Can this scale / go multi-currency?"**
The ledger stores small proofs, so volume is cheap; currency is already a field. Scale-out is an org-per-party Fabric network or GCUL, which is built as a managed, planet-scale service — our adapter design is what makes that a swap rather than a rewrite.
