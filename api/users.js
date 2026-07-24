'use strict';
// Hardcoded demo users. Production = OAuth2/OIDC; prototype = this, honestly labelled.
// UK / Lloyds framing: supplier keyed by Companies House CRN (primary) + VAT number
// (secondary); the second lender is a non-bank invoice finance provider (the kill shot).
module.exports = [
    { username: 'supplier1', password: 'demo123', role: 'supplier',
      displayName: 'Pennine Textiles Ltd',
      supplierCRN: '09876543', supplierVatNumber: 'GB402317654' },

    // payer1 / payer2 are two logins for the same buyer (Northfield). The brief's
    // maker-checker split (Accounts Payable vs Finance Controller) needs the
    // dual-approval flow, which is not built yet — so both carry the company
    // displayName today, because PayerView matches invoices on payerName === displayName.
    { username: 'payer1', password: 'demo123', role: 'payer',
      displayName: 'Northfield Retail Group plc', payerId: 'PAYER-NORTHFIELD' },

    { username: 'payer2', password: 'demo123', role: 'payer',
      displayName: 'Northfield Retail Group plc', payerId: 'PAYER-NORTHFIELD' },

    { username: 'lloyds', password: 'demo123', role: 'lender',
      displayName: 'Lloyds Bank Commercial Banking' },

    // the second lender = our demo kill shot: an independent, non-bank invoice
    // finance provider (a specialist funder, not a deposit-taking bank).
    { username: 'meridian', password: 'demo123', role: 'lender',
      displayName: 'Meridian Invoice Finance Ltd' }
];
