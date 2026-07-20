'use strict';
const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');

/**
 * Invoice Trust Ledger — smart contract.
 * The ledger invariants (see docs/RULES.md — the portable spec for the GCUL rewrite):
 *   R1. An invoice fingerprint (number+supplier+amount) may be registered ONCE.
 *   R2. Same number+supplier with a DIFFERENT amount registers, but carries a permanent tamper flag.
 *   R3. Only a REGISTERED invoice can be APPROVED or DISPUTED.
 *   R4. Only an APPROVED invoice can be FINANCED.
 *   R5. A FINANCED invoice can NEVER be financed again (duplicate financing blocked).
 *   R6. Only a FINANCED invoice can be SETTLED.
 *   R7. Every state change is permanently recorded with a tx id + timestamp.
 */
class InvoiceContract extends Contract {

    // ---------- helpers ----------

    // The invoice "fingerprint": unique invoice identity.
    // Same invoice number + same supplier + same amount => same fingerprint, always.
    _fingerprint(invoiceNumber, supplierVRN, amount) {
        const raw = `${invoiceNumber.trim().toUpperCase()}|${supplierVRN.trim().toUpperCase()}|${Number(amount)}`;
        return crypto.createHash('sha256').update(raw).digest('hex');
    }

    // A second hash of number+supplier ONLY — used to catch "same invoice,
    // different amount" = a possible tampered resubmission.
    _numberKeyHash(invoiceNumber, supplierVRN) {
        const raw = `${invoiceNumber.trim().toUpperCase()}|${supplierVRN.trim().toUpperCase()}`;
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
    async RegisterInvoice(ctx, invoiceId, invoiceNumber, supplierName, supplierVRN,
        payerName, amount, currency, dueDate, docHash) {

        // Rule 0: id not already used
        const existing = await ctx.stub.getState(`INV_${invoiceId}`);
        if (existing && existing.length > 0) {
            throw new Error(`Invoice id ${invoiceId} already exists`);
        }

        // R1 "unique invoice identity":
        // exact duplicate (same number+supplier+amount) is REJECTED outright.
        const fp = this._fingerprint(invoiceNumber, supplierVRN, amount);
        const fpState = await ctx.stub.getState(`FP_${fp}`);
        if (fpState && fpState.length > 0) {
            const prior = JSON.parse(fpState.toString());
            throw new Error(
                `DUPLICATE REGISTRATION BLOCKED: invoice ${invoiceNumber} from supplier ` +
                `${supplierVRN} is already on the ledger as ${prior.invoiceId} ` +
                `(registered ${prior.registeredAt})`
            );
        }

        // R2 "fraud detection", simplified:
        // same number+supplier but DIFFERENT amount => allow, but stamp a
        // permanent tamper warning on the record for the lender to see.
        let tamperWarning = null;
        const numKey = `NUM_${this._numberKeyHash(invoiceNumber, supplierVRN)}`;
        const numState = await ctx.stub.getState(numKey);
        if (numState && numState.length > 0) {
            const prev = JSON.parse(numState.toString());
            tamperWarning =
                `Invoice number ${invoiceNumber} from this supplier was previously registered ` +
                `with amount ${prev.amount}. This submission has amount ${Number(amount)}. ` +
                `Possible altered/resubmitted invoice.`;
        }

        const now = this._txTime(ctx);
        const invoice = {
            docType: 'invoice',
            invoiceId, invoiceNumber, supplierName, supplierVRN, payerName,
            amount: Number(amount), currency, dueDate,
            docHash,                    // hash of the uploaded PDF (proof, not the file)
            status: 'REGISTERED',       // the state machine starts here
            registeredAt: now,
            approvedAt: null, approvedBy: null,
            financedAt: null, financedBy: null,
            settledAt: null,
            fingerprint: fp,
            tamperWarning
        };

        await ctx.stub.putState(`INV_${invoiceId}`, Buffer.from(JSON.stringify(invoice)));
        await ctx.stub.putState(`FP_${fp}`, Buffer.from(JSON.stringify({ invoiceId, registeredAt: now })));
        if (!numState || numState.length === 0) {
            await ctx.stub.putState(numKey,
                Buffer.from(JSON.stringify({ invoiceId, amount: Number(amount) })));
        }
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
