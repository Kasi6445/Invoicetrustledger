'use strict';
// The off-chain store (Data Layer, right half).
// Sensitive commercial data never touches the chain — it lives here; only its hash goes on-chain.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'data', 'offchain.json');

function load() {
    if (!fs.existsSync(FILE)) {
        // seed: the supplier's sensitive profile (never stored on-chain)
        const seed = {
            supplierProfiles: {
                VRN123456: {
                    legalName: 'Sri Lakshmi Textiles Pvt Ltd',
                    bankAccount: '004512349876',
                    sortCode: '30-96-26',
                    businessContact: 'accounts@srilakshmitextiles.in',
                    kycDocRef: 'vault://kyc/VRN123456/directors-id.pdf'
                }
            },
            docs: {}   // invoiceId -> { fileName, sha256 }
        };
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(seed, null, 2));
    }
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(db) { fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); }

module.exports = { load, save };
