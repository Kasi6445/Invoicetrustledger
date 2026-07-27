'use strict';
// Run: node seed.js   (server must be running)
// Against a hosted deploy: node seed.js https://your-app.onrender.com
//                      or: API_URL=https://your-app.onrender.com node seed.js
// One cast throughout: supplier "Pennine Textiles Ltd" (from the supplier1 login — the
// server takes supplierName off the JWT, never off the request body) and payer
// "Northfield Retail Group plc", byte-identical to that account's displayName in users.js
// so the payer console's samePayer match holds.
// Seeds: INV-2026-001 already FINANCED by Lloyds (the duplicate-financing target),
// INV-2026-002 APPROVED and ready to fund, INV-2026-003 left REGISTERED (the payer's
// pending-approval target) and INV-2026-004 APPROVED, giving the lender console's search
// box and tabs several rows to filter across.
//
// The invoice copy is now MANDATORY (server rejects a register with no file), so each
// invoice is registered as multipart with a document attached. Document assignment is
// deliberate — see docs/RESUME.md / the hardening plan:
//   001 -> the real invoice-clean-INV-2026-014.pdf fixture (a hash NOT used in the live
//          demo, so it never collides with what the presenter uploads on stage).
//   002/003/004 -> unique synthetic PDFs (distinct bytes => distinct docHash), so no
//          seed ever trips the read-time "similar invoice" flag, and the two live-demo
//          fixtures (clean-007, tampered-007) stay reserved for the stage.
const fs = require('fs');
const path = require('path');
const API = process.argv[2] || process.env.API_URL || 'http://localhost:3000';

const CLEAN_014 = path.join(__dirname, '..', 'e2e', 'fixtures', 'invoice-clean-INV-2026-014.pdf');

async function post(p, body, token) {
    const r = await fetch(API + p, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body) });
    const d = await r.json(); if (!r.ok) console.log('  note:', d.error); return d;
}

// Register with an attached invoice copy (multipart). `doc` is { buffer, fileName }.
async function register(fieldsObj, doc, token) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fieldsObj)) form.append(k, String(v));
    form.append('invoiceCopy', new Blob([doc.buffer], { type: 'application/pdf' }), doc.fileName);
    const r = await fetch(API + '/invoices', { method: 'POST',
        headers: { ...(token && { Authorization: `Bearer ${token}` }) }, body: form });
    const d = await r.json(); if (!r.ok) console.log('  note:', d.error); return d;
}

// Lender-directed visibility: a lender's queue only holds invoices applied to them, so the
// seed must apply as well as register or both consoles come up empty. displayNames from users.js.
const LLOYDS = 'Lloyds Bank Commercial Banking';
const MERIDIAN = 'Meridian Invoice Finance Ltd';
const apply = (id, lender, token) => post(`/invoices/${id}/apply`, { lender }, token);

const realDoc = () => ({ buffer: fs.readFileSync(CLEAN_014), fileName: 'invoice-clean-INV-2026-014.pdf' });
const synthDoc = number => ({ buffer: Buffer.from(`seed-doc-${number}`), fileName: `${number}.pdf` });

(async () => {
    const s = (await post('/auth/login', { username: 'supplier1', password: 'demo123' })).token;
    const p = (await post('/auth/login', { username: 'payer1',    password: 'demo123' })).token;
    const l = (await post('/auth/login', { username: 'lloyds',    password: 'demo123' })).token;

    const a = await register({ invoiceNumber: 'INV-2026-001', payerName: 'Northfield Retail Group plc',
        amount: 250000, requestedAmount: 225000, currency: 'GBP',
        invoiceDate: '2026-07-05', dueDate: '2026-08-15' }, realDoc(), s);
    await apply(a.invoiceId, LLOYDS, s); await apply(a.invoiceId, MERIDIAN, s);  // both — the kill shot needs
    await post(`/invoices/${a.invoiceId}/approve`, {}, p);                       // Meridian to SEE this row
    await post(`/invoices/${a.invoiceId}/fund`, {}, l);                 // one already-financed example

    const b = await register({ invoiceNumber: 'INV-2026-002', payerName: 'Northfield Retail Group plc',
        amount: 400000, requestedAmount: 360000, currency: 'GBP',
        invoiceDate: '2026-07-20', dueDate: '2026-09-01' }, synthDoc('INV-2026-002'), s);
    await apply(b.invoiceId, LLOYDS, s); await apply(b.invoiceId, MERIDIAN, s);
    await post(`/invoices/${b.invoiceId}/approve`, {}, p);              // one ready-to-fund example

    const c = await register({ invoiceNumber: 'INV-2026-003', payerName: 'Northfield Retail Group plc',
        amount: 180000, requestedAmount: 150000, currency: 'GBP',
        invoiceDate: '2026-08-01', dueDate: '2026-09-20' }, synthDoc('INV-2026-003'), s);  // search-demo: REGISTERED
    const d = await register({ invoiceNumber: 'INV-2026-004', payerName: 'Northfield Retail Group plc',
        amount: 620000, requestedAmount: 550000, currency: 'GBP',
        invoiceDate: '2026-08-10', dueDate: '2026-10-05' }, synthDoc('INV-2026-004'), s);
    await apply(d.invoiceId, LLOYDS, s);                                // Lloyds only — proves the
    await post(`/invoices/${d.invoiceId}/approve`, {}, p);              // lender queue really is filtered

    console.log('Seeded:', a.invoiceId, b.invoiceId, c.invoiceId, d.invoiceId);
})();
