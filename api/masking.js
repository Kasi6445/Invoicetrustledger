'use strict';
// Field-level RBAC rules:
// - Payer sees commercial truth; NOT full bank details, NOT KYC refs,
//   NOT lender risk data.
// - Lender sees funding & risk data; KYC/PII masked by default,
//   bank account last-4 only. One lender NEVER sees another lender's name —
//   competitor identities become 'another financial institution'.
// - Supplier sees their own record in full.
// The chain keeps the truth; masking is a read-time, per-viewer concern here.

const last4 = v => (v ? '••••' + String(v).slice(-4) : null);
const OTHER_INSTITUTION = 'another financial institution';

// Strip competitor identities from a single invoice record for a lender viewer.
// Supplier and payer keep real lender names (the supplier was paid by that
// lender; the payer must settle with them).
function maskLenderIdentities(record, viewerName) {
    const out = { ...record };
    if (out.financedBy && out.financedBy !== viewerName) out.financedBy = OTHER_INSTITUTION;
    if (Array.isArray(out.declines)) {
        out.declines = out.declines.map(d =>
            d.by === viewerName ? d : { by: OTHER_INSTITUTION, at: d.at });
    }
    return out;
}

function maskForRole(invoice, profile, role, viewerName) {
    let out = { ...invoice };
    const p = profile ? { ...profile } : null;

    if (role === 'payer') {
        if (p) {
            p.bankAccount = last4(p.bankAccount);
            p.sortCode = '••-••-••';
            p.kycDocRef = 'restricted';
        }
        delete out.risk;            // lender underwriting data — restricted for payer
    }

    if (role === 'lender') {
        if (p) {
            p.bankAccount = last4(p.bankAccount);
            p.kycDocRef = 'vault://masked (entitlement required)';
        }
        out = maskLenderIdentities(out, viewerName);
    }

    // supplier: no masking on their own data
    out.supplierProfile = p;
    return out;
}

// History entries carry full invoice snapshots in .record — mask each one for
// lender viewers so the audit trail cannot leak a competitor's name.
function maskHistoryForRole(history, role, viewerName) {
    if (role !== 'lender') return history;
    return history.map(h =>
        h && h.record ? { ...h, record: maskLenderIdentities(h.record, viewerName) } : h);
}

module.exports = { maskForRole, maskHistoryForRole };
