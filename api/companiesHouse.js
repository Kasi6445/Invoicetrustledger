'use strict';
require('dotenv').config();

// Companies House register check for a supplier CRN.
//
// DEMO-SAFE BY DESIGN: this module NEVER throws and never blocks the flow on a
// slow or dead network. A real lookup runs only when CH_API_KEY is set, behind
// a short timeout; on a missing key, a timeout, or any error we fall back to a
// built-in register snapshot for the demo entities. Every result is labelled
// with `source` ('live' | 'cached') so the UI can be honest about which it is.
// (Mirrors the gemini.js simulated-fallback approach.)

// Built-in snapshots so the check works offline / with no key. Real lookups
// (CH_API_KEY set) override these; any failure falls back to them.
const SNAPSHOT = {
    '09876543': { companyName: 'Pennine Textiles Ltd',        status: 'active', type: 'ltd', incorporatedOn: '2015-11-03' },
    '04567890': { companyName: 'Northfield Retail Group plc', status: 'active', type: 'plc', incorporatedOn: '2003-02-18' },
};

const TIMEOUT_MS = 2500;
const BASE = 'https://api.company-information.service.gov.uk';

function fromSnapshot(crn, note) {
    const s = SNAPSHOT[crn];
    if (!s) return {
        crn, found: false, source: 'cached', status: 'unknown',
        note: note || 'Not in the built-in register snapshot; set CH_API_KEY for a live lookup.'
    };
    return {
        crn, found: true, source: 'cached',
        companyName: s.companyName, status: s.status, type: s.type, incorporatedOn: s.incorporatedOn,
        note: note || 'Built-in register snapshot (no live call).'
    };
}

// Always resolves — never rejects. Returns a plain object the route can pass
// straight through to the client.
async function lookupCompany(crn) {
    crn = String(crn || '').trim();
    if (!crn) return { crn, found: false, source: 'cached', status: 'unknown', note: 'No CRN supplied.' };
    if (!process.env.CH_API_KEY) return fromSnapshot(crn);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        // Companies House uses HTTP Basic auth: API key as username, blank password.
        const authHeader = 'Basic ' + Buffer.from(process.env.CH_API_KEY + ':').toString('base64');
        const resp = await fetch(`${BASE}/company/${encodeURIComponent(crn)}`,
            { headers: { Authorization: authHeader }, signal: ctrl.signal });

        if (resp.status === 404) return {
            crn, found: false, source: 'live', status: 'not-found',
            note: 'Companies House has no company registered with this number.'
        };
        if (!resp.ok) return fromSnapshot(crn, `Live lookup failed (HTTP ${resp.status}) — showing cached snapshot.`);

        const d = await resp.json();
        return {
            crn, found: true, source: 'live',
            companyName: d.company_name || null,
            status: d.company_status || 'unknown',   // 'active' | 'dissolved' | 'liquidation' | ...
            type: d.type || null,
            incorporatedOn: d.date_of_creation || null,
            note: 'Live from Companies House.'
        };
    } catch (e) {
        const why = e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error';
        return fromSnapshot(crn, `Live lookup unavailable (${why}) — showing cached snapshot.`);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { lookupCompany };
