'use strict';
// Transparent, explainable risk scoring.
// Judges respect a rule-based score you can explain more than a black box you can't.
// Each rule maps to something on the ledger.

function riskScore(inv) {
    let score = 0; const reasons = [];

    if (inv.status === 'APPROVED' || inv.status === 'FINANCED') {
        score += 40; reasons.push('Payer-approved on ledger (+40)');
    } else reasons.push('Awaiting payer approval (+0)');

    if (!inv.tamperWarning) {
        score += 25; reasons.push('No altered-resubmission flag (+25)');
    } else reasons.push('⚠ Tamper flag on ledger (+0)');

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

    const grade = score >= 80 ? 'A' : score >= 55 ? 'B' : 'C';
    return { ...inv, risk: { score, grade, reasons } };
}

module.exports = { riskScore };
