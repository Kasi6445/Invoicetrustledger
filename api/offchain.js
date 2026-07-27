'use strict';
// The off-chain store (Data Layer, right half).
// Sensitive commercial data never touches the chain — it lives here; only its hash goes on-chain.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'data', 'offchain.json');

function load() {
    if (!fs.existsSync(FILE)) {
        // seed: sensitive party data (never stored on-chain — only hashes go on-chain)
        const seed = {
            // Supplier profiles key off the Companies House CRN (primary entity key).
            supplierProfiles: {
                '09876543': {
                    legalName: 'Pennine Textiles Ltd',
                    vatNumber: 'GB402317654',
                    registeredOffice: 'Unit 4, Pennine Business Park, Huddersfield HD1 3AL',
                    bankName: 'NatWest',
                    bankAccount: '12345678',        // 8-digit UK account number
                    sortCode: '30-96-26',           // 6-digit UK sort code
                    businessContact: 'accounts@penninetextiles.co.uk',
                    cddRecordRef: 'vault://cdd/09876543/psc-verification.pdf'
                }
            },
            // Payer profiles key off payerName. The commercial terms and rating
            // here drive the lender's credit decision; the payer sees their own.
            payerProfiles: {
                'Northfield Retail Group plc': {
                    legalName: 'Northfield Retail Group plc',
                    crn: '04567890',
                    vatNumber: 'GB987654321',
                    paymentTerms: 'Net 60',
                    payerRating: 'AA-',
                    programLimit: 5000000,                  // £5m anchor programme limit
                    settlementAccount: '30-96-27 / 87654321'
                }
            },
            docs: {},  // invoiceId -> { invoiceCopy: {fileName, sha256}, purchaseOrder: {...}, goodsReceived: {...} }
            // Financing applications (app layer, NOT a ledger fact): which lenders the
            // supplier has offered this invoice to. invoiceId -> [ { lender, status, appliedAt } ].
            // `lender` is the lender's displayName so it compares directly with financedBy.
            applications: {}
        };
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(seed, null, 2));
    }
    const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // Backward compat: stores written before applications existed must still load.
    if (!db.applications) db.applications = {};
    return db;
}

function save(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }

module.exports = { load, save };
