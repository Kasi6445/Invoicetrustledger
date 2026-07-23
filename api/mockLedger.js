'use strict';
// ============================================================================
//  MOCK LEDGER — persistent, hash-chained, append-only (Plan B, already built).
//
//  Enforces EXACTLY the same invariants as chaincode/lib/invoiceContract.js
//  (see docs/RULES.md). Every write is appended to data/ledger.json as an
//  entry carrying prevHash = SHA-256 of the previous entry, so any edit to
//  history breaks the chain — verifyChain() proves it. State is rebuilt by
//  replaying the chain, so the chain is the single source of truth.
//
//  Pitch line if demoing in this mode: "The prototype implements the DLT
//  layer as a hash-chained append-only ledger — the same tamper-evidence
//  principle; here's verifyChain() proving no record was altered. Production
//  target is Hyperledger Fabric / GCUL behind the identical adapter."
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'data', 'ledger.json');

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const fingerprint = (num, vrn, amount) =>
    sha256(`${String(num).trim().toUpperCase()}|${String(vrn).trim().toUpperCase()}|${Number(amount)}`);
const numberKey = (num, vrn) =>
    sha256(`${String(num).trim().toUpperCase()}|${String(vrn).trim().toUpperCase()}`);

function loadChain() {
    if (!fs.existsSync(FILE)) return [];
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

function persist(chain) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(chain, null, 2));
}

function entryHash(prevHash, core) {
    return sha256(prevHash + '|' + JSON.stringify(core));
}

module.exports = function mockLedger() {
    const chain = loadChain();            // [{seq, prevHash, hash, txId, timestamp, fn, args}]
    const store = new Map();              // invoiceId -> current invoice record
    const nums = new Map();               // numberKey -> { invoiceId, amount, registeredAt }
    const history = new Map();            // invoiceId -> [{txId, timestamp, record}]

    const pushHistory = (id, rec, txId, timestamp) => {
        if (!history.has(id)) history.set(id, []);
        // Deep copy: Fabric snapshots each version at write time, so nested
        // fields (declines) must not stay live references into current state.
        history.get(id).push({ txId, timestamp, record: JSON.parse(JSON.stringify(rec)) });
    };

    // ----- the rules (identical to chaincode) applied to in-memory state -----
    function applyWrite(fn, args, txId, timestamp) {
        if (fn === 'RegisterInvoice') {
            const [invoiceId, invoiceNumber, supplierName, supplierVRN,
                   payerName, amount, requestedAmount, currency, invoiceDate, dueDate, docHashes] = args;

            if (store.has(invoiceId)) throw new Error(`Invoice id ${invoiceId} already exists`);

            // R1 "one number, one registration": ANY prior invoice with the same
            // (invoiceNumber, supplierVRN) — same or different amount — is rejected.
            // Uniqueness is scoped per supplier on purpose: two different suppliers
            // may legitimately use the same invoice number.
            const fp = fingerprint(invoiceNumber, supplierVRN, amount);
            const nk = numberKey(invoiceNumber, supplierVRN);
            if (nums.has(nk)) {
                const prev = nums.get(nk);
                let msg =
                    `DUPLICATE INVOICE BLOCKED: invoice number ${invoiceNumber} has already been ` +
                    `registered by supplier ${supplierVRN} (ledger record: ${prev.invoiceId}, ` +
                    `amount ${prev.amount}, registered ${prev.registeredAt}). ` +
                    `This submission has amount ${Number(amount)}. An invoice number cannot be reused.`;
                if (Number(amount) !== Number(prev.amount)) msg += ' Possible tampered or fake invoice.';
                throw new Error(msg);
            }

            // Financing cap: the requested advance can never exceed the invoice face
            // value. Size bound on the single financing event — NOT partial financing.
            const faceAmount = Number(amount);
            const reqAmount = Number(requestedAmount);
            if (!(faceAmount > 0) || !(reqAmount > 0) || reqAmount > faceAmount) {
                throw new Error(
                    `FINANCING REQUEST REJECTED: requested amount ${reqAmount} must be greater than 0 ` +
                    `and no more than the invoice face value ${faceAmount}.`);
            }

            // docHashes: JSON string of { invoiceCopy, purchaseOrder, goodsReceived }
            // SHA-256s. Parsed defensively; "" and "{}" mean none.
            let docs = {};
            const rawDocs = (docHashes === undefined || docHashes === null) ? '' : String(docHashes).trim();
            if (rawDocs && rawDocs !== '{}') {
                try {
                    docs = JSON.parse(rawDocs);
                } catch (e) {
                    throw new Error(`Malformed docHashes JSON: ${e.message}`);
                }
                if (!docs || typeof docs !== 'object' || Array.isArray(docs)) {
                    throw new Error('docHashes must be a JSON object of { name: sha256 } entries');
                }
            }

            // docHash === the invoice-copy hash so risk.js/demo read it unchanged.
            const docHash = docs.invoiceCopy || 'no-document';
            const inv = {
                docType: 'invoice',
                invoiceId, invoiceNumber, supplierName, supplierVRN, payerName,
                amount: faceAmount, requestedAmount: reqAmount, currency,
                invoiceDate, dueDate, docHash, docs,
                status: 'REGISTERED', registeredAt: timestamp,
                approvedAt: null, approvedBy: null,
                financedAt: null, financedBy: null, settledAt: null,
                fingerprint: fp
            };
            store.set(invoiceId, inv);
            nums.set(nk, { invoiceId, amount: faceAmount, registeredAt: timestamp });
            pushHistory(invoiceId, inv, txId, timestamp);
            return inv;
        }

        const inv = store.get(args[0]);
        if (!inv) throw new Error(`Invoice ${args[0]} does not exist on the ledger`);

        if (fn === 'ApproveInvoice') {
            if (inv.status !== 'REGISTERED')
                throw new Error(`Cannot approve: invoice ${args[0]} is in status ${inv.status}, only REGISTERED invoices can be approved`);
            inv.status = 'APPROVED'; inv.approvedAt = timestamp; inv.approvedBy = args[1];

        } else if (fn === 'DisputeInvoice') {
            if (inv.status !== 'REGISTERED')
                throw new Error(`Cannot dispute: invoice is in status ${inv.status}`);
            inv.status = 'DISPUTED'; inv.approvedBy = args[1];
            inv.disputeReason = args[2]; inv.approvedAt = timestamp;

        } else if (fn === 'DeclineInvoice') {
            // A decline does NOT change status. The invoice remains APPROVED and any
            // other lender can still fund it — one institution declining is its own
            // credit decision, not a global block.
            if (inv.status !== 'APPROVED')
                throw new Error(`Cannot decline: invoice ${args[0]} is ${inv.status}; only APPROVED invoices can be declined`);
            if ((inv.declines || []).some(d => d.by === args[1]))
                throw new Error(`Cannot decline: ${args[1]} has already declined invoice ${args[0]}`);
            if (!inv.declines) inv.declines = [];
            inv.declines.push({ by: args[1], reason: args[2], at: timestamp });

        } else if (fn === 'FundInvoice') {
            if (inv.status === 'FINANCED')
                throw new Error(
                    `DUPLICATE FINANCING BLOCKED: invoice ${args[0]} was already financed by ` +
                    `${inv.financedBy} at ${inv.financedAt}. The ledger rejects this transaction.`);
            if (inv.status !== 'APPROVED')
                throw new Error(`Cannot fund: invoice ${args[0]} is ${inv.status}. Only payer-APPROVED invoices can be financed.`);
            inv.status = 'FINANCED'; inv.financedAt = timestamp; inv.financedBy = args[1];

        } else if (fn === 'SettleInvoice') {
            if (inv.status !== 'FINANCED')
                throw new Error(`Cannot settle: invoice is ${inv.status}`);
            inv.status = 'SETTLED'; inv.settledAt = timestamp;

        } else {
            throw new Error('unknown function ' + fn);
        }
        pushHistory(args[0], inv, txId, timestamp);
        return inv;
    }

    // ----- rebuild state by replaying the persisted chain -----
    for (const e of chain) {
        try { applyWrite(e.fn, e.args, e.txId, e.timestamp); }
        catch (err) { /* an invalid persisted entry can't corrupt state; skip */ }
    }
    if (chain.length) console.log(`Mock ledger: replayed ${chain.length} chained entries from data/ledger.json`);

    return {
        async submit(fn, ...args) {
            const txId = 'tx-' + crypto.randomBytes(12).toString('hex');
            const timestamp = new Date().toISOString();
            const record = applyWrite(fn, args, txId, timestamp);   // throws on rule violation — nothing is appended
            const prevHash = chain.length ? chain[chain.length - 1].hash : 'GENESIS';
            const core = { seq: chain.length, txId, timestamp, fn, args };
            chain.push({ ...core, prevHash, hash: entryHash(prevHash, core) });
            persist(chain);
            return JSON.stringify(record);
        },

        async evaluate(fn, ...args) {
            if (fn === 'GetAllInvoices') return JSON.stringify([...store.values()]);
            if (fn === 'ReadInvoice') {
                const inv = store.get(args[0]);
                if (!inv) throw new Error(`Invoice ${args[0]} does not exist on the ledger`);
                return JSON.stringify(inv);
            }
            if (fn === 'GetInvoiceHistory') return JSON.stringify(history.get(args[0]) || []);
            throw new Error('unknown function ' + fn);
        },

        // Tamper-evidence proof: recompute every hash link.
        async verifyChain() {
            let prev = 'GENESIS';
            for (let i = 0; i < chain.length; i++) {
                const e = chain[i];
                const expected = entryHash(prev, { seq: e.seq, txId: e.txId, timestamp: e.timestamp, fn: e.fn, args: e.args });
                if (e.prevHash !== prev || e.hash !== expected) {
                    return { valid: false, brokenAt: i, entries: chain.length,
                             detail: `Entry ${i} (${e.fn}) fails hash verification — history was altered.` };
                }
                prev = e.hash;
            }
            return { valid: true, entries: chain.length, headHash: prev };
        }
    };
};
