'use strict';
// Field-level RBAC rules:
// - Payer sees commercial truth; NOT full bank details, NOT KYC refs,
//   NOT lender risk data.
// - Lender sees funding & risk data; KYC/PII masked by default,
//   bank account last-4 only.
// - Supplier sees their own record in full.

const last4 = v => (v ? '••••' + String(v).slice(-4) : null);

function maskForRole(invoice, profile, role) {
    const out = { ...invoice };
    const p = profile ? { ...profile } : null;

    if (role === 'payer') {
        if (p) {
            p.bankAccount = last4(p.bankAccount);
            p.sortCode = '••-••-••';
            p.kycDocRef = 'restricted';
        }
        delete out.risk;            // lender underwriting data — restricted for payer
        delete out.tamperWarning;   // risk signal, lender-facing
    }

    if (role === 'lender') {
        if (p) {
            p.bankAccount = last4(p.bankAccount);
            p.kycDocRef = 'vault://masked (entitlement required)';
        }
    }

    // supplier: no masking on their own data
    out.supplierProfile = p;
    return out;
}

module.exports = { maskForRole };
