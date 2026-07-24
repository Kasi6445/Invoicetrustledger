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
Banks need permissioned membership, data privacy, and predictable costs with no gas token — which is exactly the permissioned model Fabric was built for and, notably, the model GCUL itself uses (CDD-verified participants, fees invoiced, not gas).

**"How does the lender know the PDF wasn't swapped after registration?"**
There's a **Verify document** button in the lender console — it recomputes the stored file's SHA-256 and compares it with the fingerprint anchored on the ledger, showing both hashes; a swap of the off-chain file turns it red. You saw the green "integrity confirmed" before we funded. The document lives off-chain; only its fingerprint is on the ledger, and the ledger's copy can't be altered.

**"What if the supplier edits the amount and resubmits?"**
It never gets on the ledger: an invoice number is single-use per supplier, so the resubmission is rejected at registration with DUPLICATE INVOICE BLOCKED naming both amounts — and, because the amounts differ, flagged as a possible tampered or fake invoice. You saw the red banner live.

**"You block number reuse; what stops a fraudster from just changing the number?"**
Document-hash matching flags the identical PDF instantly; supplier+payer+amount similarity flags re-keyed copies; the flag degrades the risk grade and the lender declines with a reason recorded on-chain — detection in the system, decision with the institution.

**"Is the risk score AI?"**
Deliberately not a black box: it's rule-based and every point is derived from the ledger (payer approval, anchored document, due-date window, amount band, lender declines) — expand any grade and read the reasons. The AI in the system is the Gemini document extraction.

**"What's mocked?"**
Honestly scoped: cloud deployment (runs locally in Docker — cloud-deployable), ERP/core-banking/payments/CDD integrations (stubbed), and OAuth2/OIDC (simple JWT logins — OIDC-ready). The ledger, the contract rules, the role masking and the AI extraction are real.

**"Can this scale / go multi-currency?"**
The ledger stores small proofs, so volume is cheap; currency is already a field. Scale-out is an org-per-party Fabric network or GCUL, which is built as a managed, planet-scale service — our adapter design is what makes that a swap rather than a rewrite.
