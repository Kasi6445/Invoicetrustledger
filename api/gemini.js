'use strict';
require('dotenv').config();

// Uses Google's REST endpoint directly — no SDK needed.
// If Google has renamed the flash model by demo time, list models in
// aistudio.google.com and swap the name below.
const MODEL = 'gemini-2.5-flash';

// Offline / no-key fallback: return realistic fields so the demo flow still
// works on stage even if the hotspot dies. Clearly labelled as simulated.
function simulatedExtraction() {
    return {
        invoiceNumber: 'INV-2026-007',
        supplierName: 'Sri Lakshmi Textiles Pvt Ltd',
        supplierVRN: 'VRN123456',
        payerName: 'BigRetail Ltd',
        amount: 500000,
        currency: 'INR',
        invoiceDate: '2026-07-01',
        dueDate: '2026-08-30',
        goodsDescription: '200 bales cotton yarn, 40s count',
        poNumber: 'PO-BR-2026-3391',
        simulated: true,
        note: 'GEMINI_API_KEY not set — returned built-in sample fields. Add a key to .env for real OCR.'
    };
}

async function extractInvoice(buffer, mimeType) {
    if (!process.env.GEMINI_API_KEY) return simulatedExtraction();

    const body = {
        contents: [{
            parts: [
                { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
                { text:
`Read this invoice document. Return ONLY a JSON object, no markdown, no explanation:
{"invoiceNumber":"", "supplierName":"", "supplierVRN":"", "payerName":"",
 "amount":0, "currency":"", "invoiceDate":"", "dueDate":"",
 "goodsDescription":"", "poNumber":""}
Use empty string or 0 for anything not present. Dates as YYYY-MM-DD.
goodsDescription: a short summary of the goods/services billed. poNumber: the
purchase-order reference if the invoice cites one.` }
            ]
        }]
    };

    const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!resp.ok) throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
}

module.exports = { extractInvoice };
