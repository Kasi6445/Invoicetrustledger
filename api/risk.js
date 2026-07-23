'use strict';
// Transparent, explainable risk scoring.
// Judges respect a rule-based score you can explain more than a black box you can't.
// Each rule maps to something on the ledger.

// Similarity key for the soft flag: same supplier + payer + amount under
// different invoice numbers is a legitimate everyday pattern (recurring
// monthly billing), so it can only ever FLAG, never block or score alone.
const commercialKey = inv =>
    `${String(inv.supplierVRN || '').trim().toUpperCase()}|` +
    `${String(inv.payerName || '').trim().toLowerCase()}|${Number(inv.amount)}`;

function riskScore(inv, all = []) {
    let score = 0; const reasons = [];

    if (inv.status === 'APPROVED' || inv.status === 'FINANCED') {
        score += 40; reasons.push('Payer-approved on ledger (+40)');
    } else reasons.push('Awaiting payer approval (+0)');

    if (inv.docHash && inv.docHash !== 'no-document') {
        score += 20; reasons.push('Document hash anchored on-chain (+20)');
    } else reasons.push('No document hash anchored (+0)');

    const daysToDue = inv.dueDate ? (new Date(inv.dueDate) - Date.now()) / 86400000 : -1;
    if (daysToDue > 7 && daysToDue < 180) {
        score += 15; reasons.push('Due date in a sane window (+15)');
    } else reasons.push('Due date outside 7–180 day window (+0)');

    if (Number(inv.amount) > 0 && Number(inv.amount) <= 1000000) {
        score += 15; reasons.push('Amount within routine financing band (+15)');
    } else reasons.push('Amount outside routine band (+0)');

    if (!inv.declines || inv.declines.length === 0) {
        score += 10; reasons.push('No lender declines on ledger (+10)');
    } else reasons.push(`⚠ Declined by ${inv.declines.length} institution(s) (+0)`);

    // Similarity pass (API-layer detection, RULES.md R11): number-uniqueness
    // closed the front door; the workaround is re-registering the same invoice
    // under a NEW number. Detect it at read time — flag, never block.
    const sameDocument = [];      // strong: identical uploaded document
    const sameCommercials = [];   // soft: same supplier+payer+amount
    const hasDoc = inv.docHash && inv.docHash !== 'no-document';
    for (const other of all) {
        if (!other || other.invoiceId === inv.invoiceId) continue;
        if (hasDoc && other.docHash === inv.docHash) { sameDocument.push(other.invoiceNumber); continue; }
        if (commercialKey(other) === commercialKey(inv)) sameCommercials.push(other.invoiceNumber);
    }
    if (sameDocument.length) {
        score = Math.max(0, score - 25);
        reasons.push(`⚠ Same document already registered as ${sameDocument.join(', ')} — possible re-numbered resubmission (−25)`);
    }
    if (sameCommercials.length) {
        reasons.push(`ℹ Similar invoice(s) on ledger (same supplier, payer, amount): ${sameCommercials.join(', ')} — verify not a re-numbered resubmission`);
    }

    const grade = score >= 80 ? 'A' : score >= 55 ? 'B' : 'C';
    const risk = { score, grade, reasons };
    // Inside risk on purpose: masking already strips risk for the payer, so the
    // flag reaches lenders and the supplier only. The twin numbers named here
    // belong to the same supplier (soft tier) or are fraud signal (strong tier)
    // — no lender identity or off-chain PII rides along.
    if (sameDocument.length || sameCommercials.length) risk.similar = { sameDocument, sameCommercials };
    return { ...inv, risk };
}

module.exports = { riskScore };
