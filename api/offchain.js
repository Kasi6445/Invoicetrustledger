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
            supplierProfiles: {
                VRN123456: {
                    legalName: 'Sri Lakshmi Textiles Pvt Ltd',
                    bankName: 'HDFC Bank',
                    bankAccount: '004512349876',
                    ifsc: 'HDFC0001234',   // Indian bank routing code (was a UK sortCode)
                    businessContact: 'accounts@srilakshmitextiles.in',
                    kycDocRef: 'vault://kyc/VRN123456/directors-id.pdf'
                }
            },
            // Payer profiles key off payerName. The commercial terms and rating
            // here drive the lender's credit decision; the payer sees their own.
            payerProfiles: {
                'BigRetail Ltd': {
                    legalName: 'BigRetail India Pvt Ltd',
                    paymentTerms: 'Net 60',
                    payerRating: 'AA-',
                    programLimit: 50000000,                 // ₹5 crore anchor programme limit
                    settlementAccount: 'ICIC0004417 / 50200098761234'
                }
            },
            docs: {}   // invoiceId -> { invoiceCopy: {fileName, sha256}, purchaseOrder: {...}, goodsReceived: {...} }
        };
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(seed, null, 2));
    }
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }

module.exports = { load, save };
