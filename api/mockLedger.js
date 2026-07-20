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
    const fps = new Map();                // fingerprint -> invoiceId
    const nums = new Map();               // numberKey -> { invoiceId, amount }
    const history = new Map();            // invoiceId -> [{txId, timestamp, record}]

    const pushHistory = (id, rec, txId, timestamp) => {
        if (!history.has(id)) history.set(id, []);
        history.get(id).push({ txId, timestamp, record: { ...rec } });
    };

    // ----- the rules (identical to chaincode) applied to in-memory state -----
    function applyWrite(fn, args, txId, timestamp) {
        if (fn === 'RegisterInvoice') {
            const [invoiceId, invoiceNumber, supplierName, supplierVRN,
                   payerName, amount, currency, dueDate, docHash] = args;

            if (store.has(invoiceId)) throw new Error(`Invoice id ${invoiceId} already exists`);

            const fp = fingerprint(invoiceNumber, supplierVRN, amount);
            if (fps.has(fp)) {
                const priorId = fps.get(fp);
                const prior = store.get(priorId);
                throw new Error(
                    `DUPLICATE REGISTRATION BLOCKED: invoice ${invoiceNumber} from supplier ` +
                    `${supplierVRN} is already on the ledger as ${priorId} ` +
                    `(registered ${prior ? prior.registeredAt : 'earlier'})`);
            }

            let tamperWarning = null;
            const nk = numberKey(invoiceNumber, supplierVRN);
            if (nums.has(nk)) {
                const prev = nums.get(nk);
                tamperWarning =
                    `Invoice number ${invoiceNumber} from this supplier was previously registered ` +
                    `with amount ${prev.amount}. This submission has amount ${Number(amount)}. ` +
                    `Possible altered/resubmitted invoice.`;
            }

            const inv = {
                docType: 'invoice',
                invoiceId, invoiceNumber, supplierName, supplierVRN, payerName,
                amount: Number(amount), currency, dueDate, docHash,
                status: 'REGISTERED', registeredAt: timestamp,
                approvedAt: null, approvedBy: null,
                financedAt: null, financedBy: null, settledAt: null,
                fingerprint: fp, tamperWarning
            };
            store.set(invoiceId, inv);
            fps.set(fp, invoiceId);
            if (!nums.has(nk)) nums.set(nk, { invoiceId, amount: Number(amount) });
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
