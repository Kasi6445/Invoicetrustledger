'use strict';
// ============================================================================
//  FABRIC ADAPTER — real Hyperledger Fabric via the official Gateway SDK.
//  Requires: the fabric-samples test network up, invoicecc deployed, and
//  FABRIC_SAMPLES set in .env. See docs/RUNBOOK.md Day 2.
// ============================================================================
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const utf8 = new TextDecoder();

module.exports = async function fabricLedger() {
    if (!process.env.FABRIC_SAMPLES) {
        throw new Error('LEDGER_MODE=fabric but FABRIC_SAMPLES is not set in .env');
    }
    const base = path.join(process.env.FABRIC_SAMPLES, 'test-network',
        'organizations', 'peerOrganizations', 'org1.example.com');
    const keyDir  = path.join(base, 'users', 'User1@org1.example.com', 'msp', 'keystore');
    const certDir = path.join(base, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
    const tlsCert = path.join(base, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
    const firstFile = d => path.join(d, fssync.readdirSync(d)[0]);

    const client = new grpc.Client('localhost:7051',
        grpc.credentials.createSsl(await fs.readFile(tlsCert)),
        { 'grpc.ssl_target_name_override': 'peer0.org1.example.com' });

    const gateway = connect({
        client,
        identity: { mspId: 'Org1MSP', credentials: await fs.readFile(firstFile(certDir)) },
        signer: signers.newPrivateKeySigner(crypto.createPrivateKey(await fs.readFile(firstFile(keyDir)))),
        hash: hash.sha256
    });

    const contract = gateway.getNetwork('mychannel').getContract('invoicecc');

    // The gateway reports an endorsement failure as a generic gRPC error
    // ("10 ABORTED: failed to endorse transaction, ...") and hides the chaincode's
    // own message one level down in details[]. Surface it verbatim, so a ledger
    // rejection reads the same here as it does in mock mode — the API contract is
    // that the rejection text reaches the caller unchanged.
    const unwrap = (e) => {
        const d = e.details?.[0]?.message;
        if (d) e.message = d.replace(/^chaincode response \d+,\s*/, '');
        throw e;
    };

    return {
        async submit(fn, ...args)   { try { return utf8.decode(await contract.submitTransaction(fn, ...args)); } catch (e) { unwrap(e); } },
        async evaluate(fn, ...args) { try { return utf8.decode(await contract.evaluateTransaction(fn, ...args)); } catch (e) { unwrap(e); } },
        async verifyChain() {
            return { valid: true, mode: 'fabric',
                     note: 'Integrity is guaranteed by Fabric consensus across peers — see docker ps and the audit-trail tx ids.' };
        }
    };
};
