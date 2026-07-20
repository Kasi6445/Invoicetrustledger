'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const users = require('./users');
const { getLedger } = require('./ledger');          // <— the swap seam (mock | fabric | gcul)
const { maskForRole } = require('./masking');
const offchain = require('./offchain');
const { riskScore } = require('./risk');
const { extractInvoice } = require('./gemini');

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

/* ---- auth ---- */
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const u = users.find(x => x.username === username && x.password === password);
    if (!u) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
        { username: u.username, role: u.role, displayName: u.displayName, vrn: u.vrn || null },
        process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, role: u.role, displayName: u.displayName, vrn: u.vrn || null });
});

function auth(...roles) {
    return (req, res, next) => {
        try {
            const token = (req.headers.authorization || '').replace('Bearer ', '');
            req.user = jwt.verify(token, process.env.JWT_SECRET);
            if (roles.length && !roles.includes(req.user.role))
                return res.status(403).json({ error: `Role ${req.user.role} may not do this` });
            next();
        } catch { res.status(401).json({ error: 'Login required' }); }
    };
}

/* ---- STEP 1: supplier registers (file optional) ---- */
app.post('/invoices', auth('supplier'), upload.single('doc'), async (req, res) => {
    try {
        const b = req.body;
        const invoiceId = 'inv-' + Date.now();
        let docHash = 'no-document';
        if (req.file) {
            docHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
            const fileName = invoiceId + '-' + req.file.originalname;
            fs.mkdirSync(path.join(__dirname, 'data', 'docs'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, 'data', 'docs', fileName), req.file.buffer); // off-chain
            const db = offchain.load(); db.docs[invoiceId] = { fileName, sha256: docHash }; offchain.save(db);
        }
        const ledger = await getLedger();
        const result = await ledger.submit('RegisterInvoice',
            invoiceId, b.invoiceNumber, req.user.displayName, req.user.vrn,
            b.payerName, String(b.amount), b.currency || 'INR', b.dueDate, docHash);
        res.json(JSON.parse(result));
    } catch (e) { res.status(409).json({ error: e.message }); }
});

/* ---- STEP 2: payer approves / disputes ---- */
app.post('/invoices/:id/approve', auth('payer'), async (req, res) => {
    try {
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.submit('ApproveInvoice', req.params.id, req.user.displayName)));
    } catch (e) { res.status(409).json({ error: e.message }); }
});

app.post('/invoices/:id/dispute', auth('payer'), async (req, res) => {
    try {
        const reason = (req.body && req.body.reason) || 'Disputed by payer';
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.submit('DisputeInvoice', req.params.id, req.user.displayName, reason)));
    } catch (e) { res.status(409).json({ error: e.message }); }
});

/* ---- STEP 4+5: lender funds — THE endpoint that gets blocked in the demo ---- */
app.post('/invoices/:id/fund', auth('lender'), async (req, res) => {
    try {
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.submit('FundInvoice', req.params.id, req.user.displayName)));
    } catch (e) { res.status(409).json({ error: e.message }); }   // the chaincode's rejection travels to the UI
});

/* ---- reads, masked per role ---- */
app.get('/invoices', auth(), async (req, res) => {
    try {
        const ledger = await getLedger();
        const all = JSON.parse(await ledger.evaluate('GetAllInvoices'));
        const db = offchain.load();
        res.json(all.map(inv =>
            maskForRole(riskScore(inv), db.supplierProfiles[inv.supplierVRN], req.user.role)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/invoices/:id', auth(), async (req, res) => {
    try {
        const ledger = await getLedger();
        const inv = JSON.parse(await ledger.evaluate('ReadInvoice', req.params.id));
        const db = offchain.load();
        res.json(maskForRole(riskScore(inv), db.supplierProfiles[inv.supplierVRN], req.user.role));
    } catch (e) { res.status(404).json({ error: e.message }); }
});

/* ---- the immutable audit trail ---- */
app.get('/invoices/:id/history', auth(), async (req, res) => {
    try {
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.evaluate('GetInvoiceHistory', req.params.id)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- tamper-evidence proof (mock mode: recomputes the hash chain) ---- */
app.get('/ledger/verify', auth(), async (req, res) => {
    try {
        const ledger = await getLedger();
        res.json(await ledger.verifyChain());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- AI: OCR extraction ---- */
app.post('/ai/extract', auth('supplier'), upload.single('doc'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Attach an invoice file' });
        res.json(await extractInvoice(req.file.buffer, req.file.mimetype));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (req, res) =>
    res.json({ ok: true, ledgerMode: process.env.LEDGER_MODE || 'mock' }));

app.listen(process.env.PORT || 3000, () =>
    console.log(`Invoice Trust Ledger API on http://localhost:${process.env.PORT || 3000}`));
