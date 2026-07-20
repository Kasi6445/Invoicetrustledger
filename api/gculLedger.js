'use strict';
// ============================================================================
//  GCUL ADAPTER — Google Cloud Universal Ledger (STUB).
//
//  Status (mid-2026): GCUL is in private testnet (CME Group pilot); no public
//  developer access or technical documentation yet. GCUL is delivered as a
//  managed service accessed through a single API, with Python-based smart
//  contracts — which is why this project keeps the ledger interface narrow
//  and the rules documented language-neutrally in docs/RULES.md.
//
//  WHEN ACCESS IS GRANTED, implement the same two methods below:
//
//    submit(fn, ...args)
//      RegisterInvoice  -> call the GCUL contract method that creates the
//                          invoice asset/record (rules R0–R2 in RULES.md,
//                          ported to a Python contract)
//      ApproveInvoice   -> state transition REGISTERED -> APPROVED   (R3)
//      DisputeInvoice   -> state transition REGISTERED -> DISPUTED   (R3)
//      FundInvoice      -> state transition APPROVED   -> FINANCED   (R4, R5)
//      SettleInvoice    -> state transition FINANCED   -> SETTLED    (R6)
//
//    evaluate(fn, ...args)
//      ReadInvoice, GetAllInvoices -> query current record state
//      GetInvoiceHistory           -> query the record's transaction history (R7)
//
//  Auth note: GCUL participants are KYC-verified accounts on a permissioned
//  network — map our demo identities to GCUL accounts inside this adapter
//  only. Nothing outside this file should know which ledger is underneath.
// ============================================================================

module.exports = async function gculLedger() {
    const notYet = () => {
        throw new Error(
            'GCUL adapter not enabled: Google Cloud Universal Ledger is in private testnet ' +
            'and public access/docs are pending. Set LEDGER_MODE=mock or LEDGER_MODE=fabric. ' +
            'When Google grants access, implement submit/evaluate in api/gculLedger.js — ' +
            'the contract rules to port are specified in docs/RULES.md.'
        );
    };
    return {
        async submit()      { notYet(); },
        async evaluate()    { notYet(); },
        async verifyChain() { notYet(); }
    };
};
