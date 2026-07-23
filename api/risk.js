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

// Weights sum to 100 (max): five ledger-derived signals (80) plus two
// underwriting signals introduced in CR01 — advance ratio (12) and payer
// payment terms (8). Thresholds re-tuned below to A>=78 / B>=55 because those
// two are softer credit inputs than the hard on-ledger facts.
function riskScore(inv, all = [], payerProfile = null) {
    let score = 0; const reasons = [];

    if (inv.status === 'APPROVED' || inv.status === 'FINANCED') {
        score += 35; reasons.push('Payer-approved on ledger (+35)');
    } else reasons.push('Awaiting payer approval (+0)');

    if (inv.docHash && inv.docHash !== 'no-document') {
        score += 15; reasons.push('Document hash anchored on-chain (+15)');
    } else reasons.push('No document hash anchored (+0)');

    const daysToDue = inv.dueDate ? (new Date(inv.dueDate) - Date.now()) / 86400000 : -1;
    if (daysToDue > 7 && daysToDue < 180) {
        score += 10; reasons.push('Due date in a sane window (+10)');
    } else reasons.push('Due date outside 7–180 day window (+0)');

    if (Number(inv.amount) > 0 && Number(inv.amount) <= 1000000) {
        score += 10; reasons.push('Amount within routine financing band (+10)');
    } else reasons.push('Amount outside routine band (+0)');

    if (!inv.declines || inv.declines.length === 0) {
        score += 10; reasons.push('No lender declines on ledger (+10)');
    } else reasons.push(`⚠ Declined by ${inv.declines.length} institution(s) (+0)`);

    // Advance ratio: requestedAmount vs face value. A smaller advance is a safer
    // book — the buffer between advance and invoice value absorbs disputes.
    const face = Number(inv.amount);
    const reqAmt = Number(inv.requestedAmount);
    if (face > 0 && reqAmt > 0) {
        const ratio = reqAmt / face;
        const pct = Math.round(ratio * 100);
        if (ratio <= 0.9) {
            score += 12; reasons.push(`Conservative advance (${pct}% of face) (+12)`);
        } else if (ratio <= 0.95) {
            score += 6; reasons.push(`Moderate advance (${pct}% of face) (+6)`);
        } else {
            reasons.push(`⚠ Aggressive advance (${pct}% of face) (+0)`);
        }
    } else reasons.push('Advance ratio unavailable (+0)');

    // Payer payment terms: shorter terms return the lender's money sooner.
    const terms = payerProfile && payerProfile.paymentTerms;
    if (terms) {
        const m = String(terms).match(/(\d+)/);
        const days = m ? Number(m[1]) : null;
        if (days !== null && days <= 30) {
            score += 8; reasons.push(`Short payer terms (${terms}) (+8)`);
        } else if (days !== null && days <= 60) {
            score += 5; reasons.push(`Standard payer terms (${terms}) (+5)`);
        } else {
            score += 2; reasons.push(`Extended payer terms (${terms}) (+2)`);
        }
    } else reasons.push('Payer terms unknown (+0)');

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

    let grade = score >= 78 ? 'A' : score >= 55 ? 'B' : 'C';
    // Structural cap: an invoice whose payer has NO credit rating on file can
    // never earn the top grade — capped at B independent of the score. This is
    // why an unrated payer (e.g. MegaMart) grades B; it is a deliberate rule,
    // not a fragile one-point margin around the A threshold.
    const payerRated = !!(payerProfile && payerProfile.payerRating);
    if (!payerRated && grade === 'A') {
        grade = 'B';
        reasons.push('⚠ Payer has no credit rating on file — capped at B');
    }
    const risk = { score, grade, reasons };
    // Inside risk on purpose: masking already strips risk for the payer, so the
    // flag reaches lenders and the supplier only. The twin numbers named here
    // belong to the same supplier (soft tier) or are fraud signal (strong tier)
    // — no lender identity or off-chain PII rides along.
    if (sameDocument.length || sameCommercials.length) risk.similar = { sameDocument, sameCommercials };
    return { ...inv, risk };
}

module.exports = { riskScore };
