'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const users = require('./users');
const { getLedger } = require('./ledger');          // <— the swap seam (mock | fabric | gcul)
const { maskForRole, maskHistoryForRole } = require('./masking');
const offchain = require('./offchain');
const { riskScore } = require('./risk');
const { extractInvoice } = require('./gemini');
const { ApiError, errorHandler } = require('./errors');
const { validateRegister } = require('./validate');

const app = express();
// Hosted deploys (Render, etc.) sit behind a reverse proxy — trust the first hop
// so express-rate-limit sees the real client IP instead of the proxy's.
app.set('trust proxy', 1);
app.use(helmet());
// Same-origin requests (the hosted portal served from api/public below) never
// need CORS headers; the allowlist only matters for the Vite dev server.
app.use(cors({ origin: ['http://localhost:5173'] }));
app.use(morgan('dev'));
app.use(express.json());

// Uploads: 5 MB cap, invoice documents only (pdf / png / jpg).
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
        cb(new ApiError(415, 'UPLOAD_TYPE',
            `Unsupported file type ${file.mimetype} — only PDF, PNG or JPG invoices are accepted`));
    }
});
// The three supporting documents a registration may carry. Whitelist — used both
// to accept uploads and to validate the :type on the download route.
const REGISTER_DOCS = ['invoiceCopy', 'purchaseOrder', 'goodsReceived'];
const registerUpload = upload.fields(REGISTER_DOCS.map(name => ({ name, maxCount: 1 })));

/* ---- auth ---- */
const loginLimiter = rateLimit({
    windowMs: 60 * 1000, max: 20,
    standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
        error: 'Too many login attempts — try again in a minute', code: 'RATE_LIMITED' })
});

app.post('/auth/login', loginLimiter, (req, res, next) => {
    const { username, password } = req.body || {};
    const u = users.find(x => x.username === username && x.password === password);
    if (!u) return next(new ApiError(401, 'AUTH_INVALID', 'Invalid credentials'));
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
        } catch { return next(new ApiError(401, 'AUTH_REQUIRED', 'Login required')); }
        if (roles.length && !roles.includes(req.user.role))
            return next(new ApiError(403, 'FORBIDDEN', `Role ${req.user.role} may not do this`));
        next();
    };
}

/* ---- STEP 1: supplier registers (all documents optional) ---- */
app.post('/invoices', auth('supplier'), registerUpload, validateRegister, async (req, res, next) => {
    try {
        const b = req.body;
        const invoiceId = 'inv-' + Date.now();
        const files = req.files || {};

        // Hash every attached document up front — the hashes go ON-CHAIN (as a
        // JSON string). We keep the buffers and only WRITE them off-chain AFTER
        // the ledger accepts the registration, so a rejection leaves no orphans.
        const docHashes = {};
        const pending = [];   // { type, fileName, sha256, buffer }
        for (const type of REGISTER_DOCS) {
            const f = files[type] && files[type][0];
            if (!f) continue;
            const sha256 = crypto.createHash('sha256').update(f.buffer).digest('hex');
            const fileName = `${invoiceId}-${type}-${f.originalname}`;
            docHashes[type] = sha256;
            pending.push({ type, fileName, sha256, buffer: f.buffer });
        }

        const ledger = await getLedger();
        const result = await ledger.submit('RegisterInvoice',
            invoiceId, b.invoiceNumber, req.user.displayName, req.user.vrn,
            b.payerName, String(b.amount), String(b.requestedAmount),
            b.currency || 'INR', b.invoiceDate || '', b.dueDate,
            JSON.stringify(docHashes));

        // Ledger accepted — now persist the off-chain artefacts.
        const db = offchain.load();
        if (pending.length) {
            fs.mkdirSync(path.join(__dirname, 'data', 'docs'), { recursive: true });
            const docRecord = {};
            for (const p of pending) {
                fs.writeFileSync(path.join(__dirname, 'data', 'docs', p.fileName), p.buffer);
                docRecord[p.type] = { fileName: p.fileName, sha256: p.sha256 };
            }
            db.docs[invoiceId] = docRecord;
        }
        // Goods description is commercial narrative — off-chain only, never on-chain.
        if (b.goodsDescription && String(b.goodsDescription).trim()) {
            db.goodsDescriptions = db.goodsDescriptions || {};
            db.goodsDescriptions[invoiceId] = String(b.goodsDescription);
        }
        offchain.save(db);

        res.json(JSON.parse(result));
    } catch (e) { next(new ApiError(409, 'LEDGER_REJECTED', e.message)); }
});

/* ---- STEP 2: payer approves / disputes ---- */
app.post('/invoices/:id/approve', auth('payer'), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.submit('ApproveInvoice', req.params.id, req.user.displayName)));
    } catch (e) { next(new ApiError(409, 'LEDGER_REJECTED', e.message)); }
});

app.post('/invoices/:id/dispute', auth('payer'), async (req, res, next) => {
    try {
        const reason = (req.body && req.body.reason) || 'Disputed by payer';
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.submit('DisputeInvoice', req.params.id, req.user.displayName, reason)));
    } catch (e) { next(new ApiError(409, 'LEDGER_REJECTED', e.message)); }
});

/* ---- STEP 3b: lender declines (their own credit decision — never blocks others) ---- */
app.post('/invoices/:id/decline', auth('lender'), async (req, res, next) => {
    try {
        const reason = (req.body && req.body.reason) || 'Not specified';
        const ledger = await getLedger();
        const inv = JSON.parse(await ledger.submit('DeclineInvoice', req.params.id, req.user.displayName, reason));
        const all = JSON.parse(await ledger.evaluate('GetAllInvoices'));
        const db = offchain.load();
        res.json(maskForRole(riskScore(inv, all, db.payerProfiles[inv.payerName]), db.supplierProfiles[inv.supplierVRN], db.payerProfiles[inv.payerName], req.user.role, req.user.displayName));
    } catch (e) { next(new ApiError(409, 'LEDGER_REJECTED', e.message)); }
});

/* ---- STEP 4+5: lender funds — THE endpoint that gets blocked in the demo ---- */
app.post('/invoices/:id/fund', auth('lender'), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        res.json(JSON.parse(await ledger.submit('FundInvoice', req.params.id, req.user.displayName)));
    } catch (e) {
        // The chaincode's rejection travels to the UI — but its message names
        // the financing lender, which must never reach a competing lender.
        let msg = e.message;
        if (msg.includes('DUPLICATE FINANCING BLOCKED')) {
            try {
                const ledger = await getLedger();
                const inv = JSON.parse(await ledger.evaluate('ReadInvoice', req.params.id));
                if (inv.financedBy && inv.financedBy !== req.user.displayName) {
                    msg = `DUPLICATE FINANCING BLOCKED: this invoice has already been financed ` +
                          `by another financial institution at ${inv.financedAt}. ` +
                          `The ledger rejects this transaction.`;
                }
            } catch {
                // read failed — strip the name from the original message instead
                msg = msg.replace(/financed by .+? at /, 'financed by another financial institution at ');
            }
        }
        next(new ApiError(409, 'LEDGER_REJECTED', msg));
    }
});

/* ---- reads, masked per role ---- */
app.get('/invoices', auth(), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        const all = JSON.parse(await ledger.evaluate('GetAllInvoices'));
        const db = offchain.load();
        res.json(all.map(inv =>
            maskForRole(riskScore(inv, all, db.payerProfiles[inv.payerName]), db.supplierProfiles[inv.supplierVRN], db.payerProfiles[inv.payerName], req.user.role, req.user.displayName)));
    } catch (e) { next(e); }
});

app.get('/invoices/:id', auth(), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        const inv = JSON.parse(await ledger.evaluate('ReadInvoice', req.params.id));
        // Similarity flags need the whole list — fine at prototype scale.
        const all = JSON.parse(await ledger.evaluate('GetAllInvoices'));
        const db = offchain.load();
        res.json(maskForRole(riskScore(inv, all, db.payerProfiles[inv.payerName]), db.supplierProfiles[inv.supplierVRN], db.payerProfiles[inv.payerName], req.user.role, req.user.displayName));
    } catch (e) { next(new ApiError(404, 'NOT_FOUND', e.message)); }
});

/* ---- the immutable audit trail ---- */
app.get('/invoices/:id/history', auth(), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        const history = JSON.parse(await ledger.evaluate('GetInvoiceHistory', req.params.id));
        // Chain history carries full record snapshots — mask competitor lender
        // names for lender viewers, same rule as single-invoice reads.
        res.json(maskHistoryForRole(history, req.user.role, req.user.displayName));
    } catch (e) { next(e); }
});

/* ---- supporting documents: stream one attached file ----
   Roles: supplier (own invoice only), payer, lender. This closes a real gap —
   the payer is asked to approve an invoice they otherwise cannot open. ---- */
app.get('/invoices/:id/doc/:type', auth('supplier', 'payer', 'lender'), async (req, res, next) => {
    try {
        const { id, type } = req.params;
        // Whitelist the type — never interpolate a caller-supplied name into a path.
        if (!REGISTER_DOCS.includes(type))
            return next(new ApiError(400, 'VALIDATION_ERROR', `Unknown document type ${type}`));

        const ledger = await getLedger();
        const inv = JSON.parse(await ledger.evaluate('ReadInvoice', id));
        if (req.user.role === 'supplier' && inv.supplierVRN !== req.user.vrn)
            return next(new ApiError(403, 'FORBIDDEN', 'Not your invoice'));

        const db = offchain.load();
        const rec = db.docs[id] && db.docs[id][type];
        if (!rec) return next(new ApiError(404, 'NOT_FOUND', `No ${type} on file for ${id}`));

        // The stored fileName came from our own writer, but confirm it still
        // resolves inside data/docs before streaming (defence in depth).
        const docsDir = path.join(__dirname, 'data', 'docs');
        const resolved = path.resolve(docsDir, rec.fileName);
        if (!resolved.startsWith(docsDir + path.sep) || !fs.existsSync(resolved))
            return next(new ApiError(404, 'NOT_FOUND', 'Document file missing'));
        res.sendFile(resolved);
    } catch (e) { next(new ApiError(404, 'NOT_FOUND', e.message)); }
});

/* ---- payment instructions: full supplier bank details, funder-only ----
   Only the institution that actually financed this invoice may see where the
   money goes. The 403 must NEVER name the funder — otherwise this endpoint
   becomes an oracle leaking what lender-anonymity hides. ---- */
app.get('/invoices/:id/payment-instructions', auth('lender'), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        const inv = JSON.parse(await ledger.evaluate('ReadInvoice', req.params.id));
        // Entitlement evaluated on the RAW invoice — financedBy is never masked here.
        const funded = inv.status === 'FINANCED' && inv.financedBy === req.user.displayName;
        if (!funded) {
            const suffix = inv.status === 'FINANCED'
                ? ' — this invoice was financed by another institution.'
                : ' — this invoice is not financed by you.';
            return next(new ApiError(403, 'FORBIDDEN',
                'Payment instructions are released only to the institution that financed this invoice' + suffix));
        }
        const db = offchain.load();
        const sp = db.supplierProfiles[inv.supplierVRN] || {};
        res.json({
            invoiceId: inv.invoiceId,
            invoiceNumber: inv.invoiceNumber,
            beneficiary: sp.legalName || inv.supplierName,
            bankName: sp.bankName || null,
            bankAccount: sp.bankAccount || null,   // full, unmasked — funder entitlement
            ifsc: sp.ifsc || null,
            amount: inv.requestedAmount,
            currency: inv.currency
        });
    } catch (e) { next(new ApiError(404, 'NOT_FOUND', e.message)); }
});

/* ---- tamper-evidence proof (mock mode: recomputes the hash chain) ---- */
app.get('/ledger/verify', auth(), async (req, res, next) => {
    try {
        const ledger = await getLedger();
        res.json(await ledger.verifyChain());
    } catch (e) { next(e); }
});

/* ---- AI: OCR extraction ---- */
app.post('/ai/extract', auth('supplier'), upload.single('doc'), async (req, res, next) => {
    try {
        if (!req.file) return next(new ApiError(400, 'VALIDATION_ERROR', 'Attach an invoice file'));
        res.json(await extractInvoice(req.file.buffer, req.file.mimetype));
    } catch (e) { next(e); }
});

app.get('/health', (req, res) =>
    res.json({ ok: true, ledgerMode: process.env.LEDGER_MODE || 'mock' }));

/* ---- hosted portal: serve the built frontend (populated by build-portal.js) ---- */
// Must stay AFTER every API route so API paths are never shadowed by files.
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_PREFIXES = ['/auth', '/invoices', '/ledger', '/ai', '/health'];
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
    // Unknown API paths keep their JSON 404s; everything else is a client route.
    if (API_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(index)) return next();   // local dev without a portal build
    res.sendFile(index);
});

app.use(errorHandler);

/* ---- AUTO_SEED: hosted free tiers wipe the disk on every restart, so when
   AUTO_SEED=true and the ledger is empty at boot, replay the standard demo
   seed through the normal ledger interface — the exact same submit() calls
   (and therefore the exact same rules) as any API write. ---- */
async function autoSeed() {
    if (String(process.env.AUTO_SEED).toLowerCase() !== 'true') return;
    try {
        const ledger = await getLedger();
        if (JSON.parse(await ledger.evaluate('GetAllInvoices')).length > 0) return;
        const supplier = users.find(u => u.username === 'supplier1');
        const payer    = users.find(u => u.username === 'payer1');
        const lender   = users.find(u => u.username === 'lloyds');
        const reg = (id, number, amount, requestedAmount, invoiceDate, dueDate) =>
            ledger.submit('RegisterInvoice',
                id, number, supplier.displayName, supplier.vrn,
                payer.displayName, amount, requestedAmount, 'INR', invoiceDate, dueDate, '{}');
        const a = 'inv-' + Date.now(), b = 'inv-' + (Date.now() + 1);
        await reg(a, 'INV-2026-001', '250000', '225000', '2026-07-05', '2026-08-15');
        await ledger.submit('ApproveInvoice', a, payer.displayName);
        await ledger.submit('FundInvoice', a, lender.displayName);
        await reg(b, 'INV-2026-002', '400000', '380000', '2026-07-20', '2026-09-01');
        await ledger.submit('ApproveInvoice', b, payer.displayName);
        console.log('AUTO_SEED: empty ledger seeded — INV-2026-001 FINANCED, INV-2026-002 APPROVED');
    } catch (e) { console.error('AUTO_SEED failed:', e.message); }
}

app.listen(process.env.PORT || 3000, () => {
    console.log(`Invoice Trust Ledger API on http://localhost:${process.env.PORT || 3000}`);
    autoSeed();
});
