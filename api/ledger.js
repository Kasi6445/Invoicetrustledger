'use strict';
require('dotenv').config();

// ============================================================================
//  THE SWAP SEAM.
//  Every ledger backend implements the same two-method interface:
//      submit(fn, ...args)   -> string (JSON of the written record)  [writes]
//      evaluate(fn, ...args) -> string (JSON)                        [reads]
//  plus optional verifyChain() for tamper-evidence demos.
//
//  server.js only ever talks to this interface. Swapping backends is a
//  one-line .env change (LEDGER_MODE) — the portal, masking, risk scoring,
//  AI layer and demo script never change.
//
//      LEDGER_MODE=mock    data/ledger.json — persistent, hash-chained,
//                          append-only. Works with zero infrastructure.
//                          (This is also Plan B, already built.)
//      LEDGER_MODE=fabric  Hyperledger Fabric test network via Gateway SDK.
//      LEDGER_MODE=gcul    Google Cloud Universal Ledger — stub until
//                          Google grants testnet access. See gculLedger.js.
// ============================================================================

let ledgerPromise = null;

function getLedger() {
    if (!ledgerPromise) {
        const mode = process.env.LEDGER_MODE || 'mock';
        if (mode === 'fabric') {
            ledgerPromise = require('./fabricLedger')();
        } else if (mode === 'gcul') {
            ledgerPromise = require('./gculLedger')();
        } else {
            ledgerPromise = Promise.resolve(require('./mockLedger')());
        }
        console.log(`Ledger mode: ${mode}`);
    }
    return ledgerPromise;
}

module.exports = { getLedger };
