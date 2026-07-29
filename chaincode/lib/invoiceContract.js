'use strict';
const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');

/**
 * Invoice Trust Ledger — smart contract.
 * The ledger invariants (see docs/RULES.md — the portable spec for the GCUL rewrite):
 *   R1. An invoice number may be registered ONCE per supplier — any reuse, same
 *       or different amount, is rejected outright (duplicate invoice blocked).
 *   R1b. Financing cap: requestedAmount must be > 0 and <= amount (face value).
 *       This bounds the size of the single financing event; it is NOT partial
 *       financing (there is still exactly one FundInvoice per invoice).
 *   R2. A lender may decline an APPROVED invoice; a decline is that lender's own
 *       credit decision and never blocks other lenders.
 *   R3. Only a REGISTERED invoice can be APPROVED or DISPUTED.
 *   R4. Only an APPROVED invoice can be FINANCED.
 *   R5. A FINANCED invoice can NEVER be financed again (duplicate financing blocked).
 *   R6. Only a FINANCED invoice can be SETTLED.
 *   R7. Every state change is permanently recorded with a tx id + timestamp.
 *   R12. A supplier may CANCEL their own pre-financing invoice: the record stays
 *       on-chain as CANCELLED and only the number index is released, freeing the
 *       number for re-registration. FINANCED/SETTLED can never be cancelled.
 */
class InvoiceContract extends Contract {

    // ---------- helpers ----------

    // The invoice "fingerprint": unique invoice identity.
    // Same invoice number + same supplier + same amount => same fingerprint, always.
    _fingerprint(invoiceNumber, supplierCRN, amount) {
        const raw = `${invoiceNumber.trim().toUpperCase()}|${supplierCRN.trim().toUpperCase()}|${Number(amount)}`;
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    // Hash of number+supplier ONLY — the uniqueness key: an invoice number
    // may be used once per supplier, regardless of amount.
    _numberKeyHash(invoiceNumber, supplierCRN) {
        const raw = `${invoiceNumber.trim().toUpperCase()}|${supplierCRN.trim().toUpperCase()}`;
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    // Chaincode must be deterministic: every peer must compute the identical
    // result. new Date() would differ per machine, so we use the transaction's
    // own timestamp, which is part of the transaction itself.
    _txTime(ctx) {
        const ts = ctx.stub.getTxTimestamp();
        const seconds = (ts.seconds && ts.seconds.low !== undefined) ? ts.seconds.low : Number(ts.seconds);
        return new Date(seconds * 1000).toISOString();
    }

    async _getInvoice(ctx, invoiceId) {
        const data = await ctx.stub.getState(`INV_${invoiceId}`);
        if (!data || data.length === 0) {
            throw new Error(`Invoice ${invoiceId} does not exist on the ledger`);
        }
        return JSON.parse(data.toString());
    }

    // ---------- STEP 1: REGISTER (supplier) ----------
    async RegisterInvoice(ctx, invoiceId, invoiceNumber, supplierName, supplierCRN,
        payerName, amount, requestedAmount, currency, invoiceDate, dueDate, docHashes) {

        // Rule 0: id not already used
        const existing = await ctx.stub.getState(`INV_${invoiceId}`);
        if (existing && existing.length > 0) {
            throw new Error(`Invoice id ${invoiceId} already exists`);
        }

        // R1 "one number, one registration": ANY prior invoice with the same
        // (invoiceNumber, supplierCRN) — same or different amount — is rejected.
        // Uniqueness is scoped per supplier on purpose: two different suppliers
        // may legitimately use the same invoice number.
        const fp = this._fingerprint(invoiceNumber, supplierCRN, amount);
        const numKey = `NUM_${this._numberKeyHash(invoiceNumber, supplierCRN)}`;
        const numState = await ctx.stub.getState(numKey);
        if (numState && numState.length > 0) {
            const prev = JSON.parse(numState.toString());
            let msg =
                `DUPLICATE INVOICE BLOCKED: invoice number ${invoiceNumber} has already been ` +
                `registered by supplier ${supplierCRN} (ledger record: ${prev.invoiceId}, ` +
                `amount ${prev.amount}, registered ${prev.registeredAt}). ` +
                `This submission has amount ${Number(amount)}. An invoice number cannot be reused.`;
            if (Number(amount) !== Number(prev.amount)) msg += ' Possible tampered or fake invoice.';
            throw new Error(msg);
        }

        // Financing cap: the requested advance can never exceed 90% of the invoice
        // face value (a haircut leaves the supplier with skin in the game). This is a
        // size bound on the single financing event — NOT partial financing; there is
        // still exactly one FundInvoice per invoice.
        const faceAmount = Number(amount);
        const reqAmount = Number(requestedAmount);
        const cap = 0.9 * faceAmount;
        if (!(faceAmount > 0) || !(reqAmount > 0) || reqAmount > cap) {
            throw new Error(
                `FINANCING REQUEST REJECTED: requested amount ${reqAmount} must be greater than 0 ` +
                `and no more than 90% of the invoice face value ${faceAmount} (max ${cap}).`
            );
        }

        // docHashes: a JSON string of { invoiceCopy, purchaseOrder, goodsReceived }
        // SHA-256s. Parsed defensively — this open slot lets the document schema
        // grow without ever redeploying chaincode again. "" and "{}" mean none.
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

        const now = this._txTime(ctx);
        // The invoice copy is MANDATORY: an invoice may never reach the ledger
        // without a real document hash anchoring it. (Purchase order / goods-received
        // note remain optional.) docHash === the invoice-copy hash so risk.js and
        // the demo script (which read docHash) keep working unchanged.
        if (!docs.invoiceCopy) {
            throw new Error(
                'INVOICE COPY REQUIRED: an invoice cannot be registered without its ' +
                'document hash. Attach the invoice copy and try again.'
            );
        }
        const docHash = docs.invoiceCopy;
        const invoice = {
            docType: 'invoice',
            invoiceId, invoiceNumber, supplierName, supplierCRN, payerName,
            amount: faceAmount, requestedAmount: reqAmount, currency,
            invoiceDate, dueDate,
            docHash,                    // == docs.invoiceCopy — the invoice-copy proof
            docs,                       // { invoiceCopy, purchaseOrder, goodsReceived } hashes
            status: 'REGISTERED',       // the state machine starts here
            registeredAt: now,
            approvedAt: null, approvedBy: null,
            financedAt: null, financedBy: null,
            settledAt: null,
            fingerprint: fp
        };

        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        await ctx.stub.putState(numKey,
            Buffer.from(JSON.stringify({ invoiceId, amount: faceAmount, registeredAt: now })));
        return JSON.stringify(invoice);
    }

    // ---------- STEP 2: APPROVE (payer) ----------
    async ApproveInvoice(ctx, invoiceId, approverName) {
        const invoice = await this._getInvoice(ctx, invoiceId);
        if (invoice.status !== 'REGISTERED') {
            throw new Error(
                `Cannot approve: invoice ${invoiceId} is in status ${invoice.status}, ` +
                `only REGISTERED invoices can be approved`
            );
        }
        invoice.status = 'APPROVED';
        invoice.approvedAt = this._txTime(ctx);
        invoice.approvedBy = approverName;
        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        return JSON.stringify(invoice);
    }

    async DisputeInvoice(ctx, invoiceId, approverName, reason) {
        const invoice = await this._getInvoice(ctx, invoiceId);
        if (invoice.status !== 'REGISTERED') {
            throw new Error(`Cannot dispute: invoice is in status ${invoice.status}`);
        }
        invoice.status = 'DISPUTED';
        invoice.approvedBy = approverName;
        invoice.disputeReason = reason;
        invoice.approvedAt = this._txTime(ctx);
        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        return JSON.stringify(invoice);
    }

    // ---------- STEP 2b: CANCEL (supplier) ----------
    // R12 "a mistake is withdrawable, never erasable": the supplier may cancel their
    // OWN invoice while it is still pre-financing. Nothing is deleted — the INV_
    // record stays on-chain as CANCELLED with its full history. Only the NUM_ index
    // key is released, which is what frees the invoice number for a corrected
    // re-registration. The financing lock lives on the INV_ record's status and is
    // untouched, so this can never reopen a financed invoice (R5).
    async CancelInvoice(ctx, invoiceId, supplierCRN, reason) {
        const inv = await this._getInvoice(ctx, invoiceId);
        const txTime = this._txTime(ctx);   // mock binds its own; the block below is shared

        // ==== shared rule block — byte-identical in api/mockLedger.js ====
        if (String(inv.supplierCRN).trim().toUpperCase() !== String(supplierCRN).trim().toUpperCase()) {
            throw new Error(
                `CANCEL BLOCKED: only the supplier that registered invoice ${invoiceId} may cancel it.`);
        }
        if (inv.status === 'FINANCED') {
            throw new Error(
                `CANCEL BLOCKED: invoice already financed — invoice ${invoiceId} was financed at ` +
                `${inv.financedAt} and can never be cancelled or re-registered.`);
        }
        if (inv.status === 'SETTLED') {
            throw new Error(`CANCEL BLOCKED: invoice ${invoiceId} is SETTLED and can no longer be cancelled.`);
        }
        if (inv.status === 'CANCELLED') {
            throw new Error(`CANCEL BLOCKED: invoice ${invoiceId} is already CANCELLED.`);
        }
        if (!['REGISTERED', 'APPROVED', 'DISPUTED'].includes(inv.status)) {
            throw new Error(`CANCEL BLOCKED: invoice ${invoiceId} is ${inv.status} and cannot be cancelled.`);
        }
        inv.status = 'CANCELLED';
        inv.cancelledAt = txTime;
        inv.cancelReason = reason;
        // ==== end shared rule block ====

        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(inv)));
        // Release the uniqueness index ONLY — this is the whole mechanism.
        await ctx.stub.deleteState(`NUM_${this._numberKeyHash(inv.invoiceNumber, inv.supplierCRN)}`);
        return JSON.stringify(inv);
    }

    // ---------- STEP 3b: DECLINE (lender) ----------
    // A decline does NOT change status. The invoice remains APPROVED and any
    // other lender can still fund it — one institution declining is its own
    // credit decision, not a global block.
    async DeclineInvoice(ctx, invoiceId, lenderName, reason) {
        const invoice = await this._getInvoice(ctx, invoiceId);
        if (invoice.status !== 'APPROVED') {
            throw new Error(
                `Cannot decline: invoice ${invoiceId} is ${invoice.status}; ` +
                `only APPROVED invoices can be declined`
            );
        }
        if ((invoice.declines || []).some(d => d.by === lenderName)) {
            throw new Error(
                `Cannot decline: ${lenderName} has already declined invoice ${invoiceId}`
            );
        }
        if (!invoice.declines) invoice.declines = [];
        invoice.declines.push({ by: lenderName, reason, at: this._txTime(ctx) });
        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        return JSON.stringify(invoice);
    }

    // ---------- STEP 4/5: VERIFY + FUND (lender) — the kill shot ----------
    async FundInvoice(ctx, invoiceId, lenderName) {
        const invoice = await this._getInvoice(ctx, invoiceId);

        // THE rule this whole project exists for (R5):
        if (invoice.status === 'FINANCED') {
            throw new Error(
                `DUPLICATE FINANCING BLOCKED: invoice ${invoiceId} was already financed by ` +
                `${invoice.financedBy} at ${invoice.financedAt}. The ledger rejects this transaction.`
            );
        }
        if (invoice.status !== 'APPROVED') {
            throw new Error(
                `Cannot fund: invoice ${invoiceId} is ${invoice.status}. ` +
                `Only payer-APPROVED invoices can be financed.`
            );
        }
        invoice.status = 'FINANCED';
        invoice.financedAt = this._txTime(ctx);
        invoice.financedBy = lenderName;
        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        return JSON.stringify(invoice);
    }

    async SettleInvoice(ctx, invoiceId) {
        const invoice = await this._getInvoice(ctx, invoiceId);
        if (invoice.status !== 'FINANCED') {
            throw new Error(`Cannot settle: invoice is ${invoice.status}`);
        }
        invoice.status = 'SETTLED';
        invoice.settledAt = this._txTime(ctx);
        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        return JSON.stringify(invoice);
    }

    // ---------- READS ----------
    async ReadInvoice(ctx, invoiceId) {
        return JSON.stringify(await this._getInvoice(ctx, invoiceId));
    }

    async GetAllInvoices(ctx) {
        const results = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let res = await iterator.next();
        while (!res.done) {
            const str = res.value.value.toString('utf8');
            try {
                const record = JSON.parse(str);
                if (record.docType === 'invoice') results.push(record);
            } catch (e) { /* skip non-JSON index keys */ }
            res = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(results);
    }

    // R7 "immutable audit trail": Fabric keeps every historical version
    // of a key on the chain. This returns that full history.
    async GetInvoiceHistory(ctx, invoiceId) {
        const iterator = await ctx.stub.getHistoryForKey(`INV_${invoiceId}`);
        const history = [];
        let res = await iterator.next();
        while (!res.done) {
            const v = res.value;
            let seconds = 0;
            if (v.timestamp && v.timestamp.seconds) {
                seconds = (v.timestamp.seconds.low !== undefined) ? v.timestamp.seconds.low : Number(v.timestamp.seconds);
            }
            history.push({
                txId: v.txId,                                        // the blockchain transaction id
                timestamp: new Date(seconds * 1000).toISOString(),
                record: (v.value && v.value.length > 0) ? JSON.parse(v.value.toString('utf8')) : null
            });
            res = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(history);
    }
}

module.exports = InvoiceContract;
