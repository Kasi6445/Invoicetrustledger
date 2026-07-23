'use strict';
// Run: node seed.js   (server must be running)
// Against a hosted deploy: node seed.js https://your-app.onrender.com
//                      or: API_URL=https://your-app.onrender.com node seed.js
// Seeds: INV-2026-001 already FINANCED by Lloyds, INV-2026-002 APPROVED and ready to fund,
// plus two MegaMart Ltd invoices (one REGISTERED, one APPROVED) so the lender
// console's search box and tabs have a second payer to filter on.
const API = process.argv[2] || process.env.API_URL || 'http://localhost:3000';

async function post(p, body, token) {
    const r = await fetch(API + p, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body) });
    const d = await r.json(); if (!r.ok) console.log('  note:', d.error); return d;
}

(async () => {
    const s = (await post('/auth/login', { username: 'supplier1', password: 'demo123' })).token;
    const p = (await post('/auth/login', { username: 'payer1',    password: 'demo123' })).token;
    const l = (await post('/auth/login', { username: 'lloyds',    password: 'demo123' })).token;

    const a = await post('/invoices', { invoiceNumber: 'INV-2026-001', payerName: 'BigRetail Ltd',
        amount: 250000, currency: 'INR', dueDate: '2026-08-15' }, s);
    await post(`/invoices/${a.invoiceId}/approve`, {}, p);
    await post(`/invoices/${a.invoiceId}/fund`, {}, l);                 // one already-financed example

    const b = await post('/invoices', { invoiceNumber: 'INV-2026-002', payerName: 'BigRetail Ltd',
        amount: 400000, currency: 'INR', dueDate: '2026-09-01' }, s);
    await post(`/invoices/${b.invoiceId}/approve`, {}, p);              // one ready-to-fund example

    const c = await post('/invoices', { invoiceNumber: 'INV-2026-003', payerName: 'MegaMart Ltd',
        amount: 180000, currency: 'INR', dueDate: '2026-09-20' }, s);   // search-demo: REGISTERED
    const d = await post('/invoices', { invoiceNumber: 'INV-2026-004', payerName: 'MegaMart Ltd',
        amount: 620000, currency: 'INR', dueDate: '2026-10-05' }, s);
    await post(`/invoices/${d.invoiceId}/approve`, {}, p);              // search-demo: ready to fund

    console.log('Seeded:', a.invoiceId, b.invoiceId, c.invoiceId, d.invoiceId);
})();
