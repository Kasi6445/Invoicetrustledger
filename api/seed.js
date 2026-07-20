'use strict';
// Run: node seed.js   (server must be running)
// Seeds: INV-2026-001 already FINANCED by Lloyds, INV-2026-002 APPROVED and ready to fund.
const API = 'http://localhost:3000';

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

    console.log('Seeded:', a.invoiceId, b.invoiceId);
})();
