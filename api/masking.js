'use strict';
// Field-level RBAC rules (read-time, per-viewer; the chain keeps the full truth):
// - Payer sees commercial truth (including the requested advance); NOT full bank
//   details, NOT CDD records, NOT lender risk data; and not their own profile
//   echoed back to them.
// - Lender sees funding & risk data + the payer's credit profile. Supplier bank
//   details stay masked UNLESS this lender funded this invoice (entitlement
//   unlock). One lender NEVER sees another lender's name — competitor identities
//   become 'another financial institution'.
// - Supplier sees their own record in full (but not the payer's credit profile).

const last4 = v => (v ? '••••' + String(v).slice(-4) : null);
// Keep a short prefix but mask the rest of the routing field (behaviour preserved
// from the pre-localisation routing-code masking; sort codes are public, so tightening this
// is a later UX refinement, not part of the mechanical sweep).
const maskSortCode = v => (v ? String(v).slice(0, 4) + '•••••••' : null);
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

function maskForRole(invoice, supplierProfile, payerProfile, role, viewerName) {
    let out = { ...invoice };
    const sp = supplierProfile ? { ...supplierProfile } : null;
    const pp = payerProfile ? { ...payerProfile } : null;

    if (role === 'payer') {
        if (sp) {
            sp.bankAccount = last4(sp.bankAccount);
            sp.sortCode = maskSortCode(sp.sortCode);
            sp.cddRecordRef = 'restricted';
        }
        delete out.risk;             // lender underwriting data — restricted for payer
        // requestedAmount IS shown to the payer (CR02): the advance sought against an
        // invoice they are being asked to confirm is part of the commercial record they
        // approve. Lender risk data stays restricted.
        out.supplierProfile = sp;
        out.payerProfile = null;     // the payer already knows their own terms
        return out;
    }

    if (role === 'lender') {
        // Entitlement unlock: evaluate against the RAW invoice, BEFORE anonymity
        // masking rewrites the output. If anonymity ran first, the funder's own
        // financedBy would already be masked and they'd fail their own check.
        const funderIsViewer =
            invoice.status === 'FINANCED' && invoice.financedBy === viewerName;
        if (sp) {
            if (!funderIsViewer) {
                sp.bankAccount = last4(sp.bankAccount);
                sp.sortCode = maskSortCode(sp.sortCode);
            }
            sp.cddRecordRef = 'vault://masked (entitlement required)';  // always masked
        }
        out = maskLenderIdentities(out, viewerName);   // anonymity, after entitlement read
        out.supplierProfile = sp;
        out.payerProfile = pp;        // full payer credit profile drives underwriting
        return out;
    }

    // supplier: own record unmasked; not shown the payer's confidential profile
    out.supplierProfile = sp;
    out.payerProfile = null;
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
