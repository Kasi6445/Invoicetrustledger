'use strict';
// Request-shape validation for write endpoints. This layer rejects malformed
// input early with field-level messages; the LEDGER remains the sole enforcer
// of business rules (duplicates, state machine, tamper flags — docs/RULES.md).
const { ApiError } = require('./errors');

function validateRegister(req, res, next) {
    const b = req.body || {};
    const fields = {};

    if (!b.invoiceNumber || !String(b.invoiceNumber).trim())
        fields.invoiceNumber = 'invoiceNumber is required';

    if (!b.payerName || !String(b.payerName).trim())
        fields.payerName = 'payerName is required';

    const amount = Number(b.amount);
    if (b.amount === undefined || b.amount === null || String(b.amount).trim() === ''
        || !Number.isFinite(amount) || amount <= 0)
        fields.amount = 'amount must be a number greater than 0';

    // currency defaults to INR server-side when omitted; if sent, it must be a 3-letter code
    if (b.currency !== undefined && b.currency !== null && String(b.currency).trim() !== ''
        && !/^[A-Za-z]{3}$/.test(String(b.currency).trim()))
        fields.currency = 'currency must be a 3-letter code (e.g. INR)';

    if (!b.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate).trim()))
        fields.dueDate = 'dueDate must be in YYYY-MM-DD format';

    if (Object.keys(fields).length)
        return next(new ApiError(400, 'VALIDATION_ERROR',
            'Validation failed: ' + Object.values(fields).join('; '), fields));
    next();
}

module.exports = { validateRegister };
