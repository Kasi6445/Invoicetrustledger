'use strict';
require('dotenv').config();
const crypto = require('crypto');

// Uses Google's REST endpoint directly — no SDK needed.
// If Google has renamed the flash model by demo time, list models in
// aistudio.google.com and swap the name below.
const MODEL = 'gemini-2.5-flash';

// Offline / no-key fallback: return realistic fields so the demo flow still
// works on stage even if the hotspot dies. Clearly labelled as simulated.
//
// The invoice number is DERIVED FROM THE DOCUMENT'S OWN BYTES, not hardcoded.
// The portal's number field is system-filled and read-only, so this value is the
// one that reaches the ledger — it must be (a) deterministic, so the same file
// always yields the same number and tests are stable, and (b) distinct per file,
// or a second offline registration would collide with R1 and be rejected.
function simulatedExtraction(buffer) {
    const stamp = crypto.createHash('sha256')
        .update(buffer || Buffer.alloc(0)).digest('hex').slice(0, 6).toUpperCase();
    return {
        invoiceNumber: `INV-2026-${stamp}`,
        supplierName: 'Pennine Textiles Ltd',
        supplierCRN: '09876543',
        payerName: 'Northfield Retail Group plc',
        amount: 85000,
        currency: 'GBP',
        invoiceDate: '2026-07-01',
        dueDate: '2026-08-30',
        goodsDescription: '200 rolls worsted wool cloth, 40s count',
        poNumber: 'PO-NRG-2026-3391',
        simulated: true,
        note: 'GEMINI_API_KEY not set — returned built-in sample fields. Add a key to .env for real OCR.'
    };
}

async function extractInvoice(buffer, mimeType) {
    if (!process.env.GEMINI_API_KEY) return simulatedExtraction(buffer);

    const body = {
        contents: [{
            parts: [
                { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
                { text:
`You are validating an upload for an invoice-financing ledger. FIRST decide whether
this file is a genuine INVOICE — a commercial bill that carries an invoice number,
an amount and the party being billed. Return ONLY a JSON object, no markdown:
{"isInvoice":true, "invoiceNumber":"", "supplierName":"", "supplierCRN":"", "payerName":"",
 "amount":0, "currency":"", "invoiceDate":"", "dueDate":"",
 "goodsDescription":"", "poNumber":""}
Set "isInvoice" to false when the file is NOT an invoice (a photo, screenshot, letter,
receipt, statement, blank page, or any unrelated document). Use empty string or 0 for
anything not present. Dates as YYYY-MM-DD. goodsDescription: a short summary of the
goods/services billed. poNumber: the purchase-order reference if the invoice cites one.` }
            ]
        }]
    };

    // A dead network or bad key falls back to a labelled sample so the demo still runs.
    // But a document the model reads as NOT an invoice is a hard rejection ({notInvoice})
    // — we must never fabricate an invoice number for a file that isn't an invoice.
    try {
        const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (!resp.ok) {
            const errText = await resp.text();
            // 400 INVALID_ARGUMENT = the model could not process this input at all
            // (corrupt, unsupported, or simply not a readable document). That is a
            // rejection — NOT a reason to mint sample fields for a non-invoice file.
            if (resp.status === 400) return { notInvoice: true };
            // Other failures (network, 5xx, quota) are infrastructure problems, so the
            // labelled sample fallback keeps the demo alive.
            throw new Error(`Gemini API error ${resp.status}: ${errText}`);
        }
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const out = JSON.parse(text.replace(/```json|```/g, '').trim());

        // Reject anything that isn't an invoice: either the model flagged it, or it
        // read nothing invoice-like (no number AND no amount). No fake number is minted.
        const hasCore = String(out.invoiceNumber || '').trim() !== '' || Number(out.amount) > 0;
        if (out.isInvoice === false || !hasCore) return { notInvoice: true };

        // It IS an invoice but the number was illegible — derive a stable reference so
        // the read-only number field is never left empty.
        if (!out.invoiceNumber || !String(out.invoiceNumber).trim()) {
            out.invoiceNumber = simulatedExtraction(buffer).invoiceNumber;
            out.note = 'Invoice number not legible in the document — a reference derived from the document hash was used.';
        }
        return out;
    } catch (e) {
        const fb = simulatedExtraction(buffer);
        fb.note = `Live OCR unavailable (${e.message}) — returned built-in sample fields.`;
        return fb;
    }
}

module.exports = { extractInvoice };
