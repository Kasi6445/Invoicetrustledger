import { test, expect, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * ============================================================================
 * API REGRESSION — the business rules, proven at the contract level
 * ============================================================================
 * These tests hit http://localhost:3000 directly. No browser, no selectors —
 * they will keep passing even if the portal markup changes completely.
 * Every rule from slide 10 gets a direct assertion, including the two
 * rejections the whole project exists for:
 *
 *   - DUPLICATE INVOICE BLOCKED    (an invoice number is single-use per supplier)
 *   - DUPLICATE FINANCING BLOCKED  (the kill shot, from the chaincode — with the
 *                                   competitor's name masked for the losing lender)
 *
 * Repeatable: every run uses fresh unique invoice numbers.
 * Zero Gemini calls: registrations attach a tiny synthetic PDF (multipart, since
 * the invoice copy is mandatory) but never call /ai/extract.
 * ============================================================================
 */

const RUN = Date.now();
const INV_A = `INV-API-${RUN}-A`; // happy path + duplicates
const INV_B = `INV-API-${RUN}-B`; // fund-before-approval guard

type Tokens = { supplier: string; payer: string; lloyds: string; meridian: string };

async function login(request: APIRequestContext, username: string): Promise<string> {
  const r = await request.post('/auth/login', { data: { username, password: 'demo123' } });
  expect(r.status(), `login as ${username}`).toBe(200);
  return (await r.json()).token;
}

async function allTokens(request: APIRequestContext): Promise<Tokens> {
  return {
    supplier: await login(request, 'supplier1'),
    payer: await login(request, 'payer1'),
    lloyds: await login(request, 'lloyds'),
    meridian: await login(request, 'meridian'),
  };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const registerBody = (invoiceNumber: string, amount = 500000) => ({
  invoiceNumber,
  payerName: 'Northfield Retail Group plc',
  amount,
  requestedAmount: Math.round(amount * 0.9),   // CR01: advance <= 90% of face value
  currency: 'GBP',
  invoiceDate: '2026-07-01',
  dueDate: '2026-08-30',
});

// The invoice copy is mandatory, so every register goes as multipart with an
// attached document. Each file gets UNIQUE bytes (distinct docHash) so these
// tests never trip the read-time "similar invoice" flag. `docTag` must be unique.
const pdf = (docTag: string) => ({
  name: `${docTag}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`api-doc-${docTag}`),
});
async function register(
  request: APIRequestContext, token: string, body: Record<string, any>, docTag: string,
) {
  const multipart: Record<string, any> = { invoiceCopy: pdf(docTag) };
  for (const [k, v] of Object.entries(body)) multipart[k] = String(v);
  return request.post('/invoices', { headers: auth(token), multipart });
}

test.describe.configure({ mode: 'serial' });

test.describe('Invoice Trust Ledger — API business rules', () => {
  let t: Tokens;
  let invoiceId: string;

  test('authentication: bad credentials rejected, roles enforced', async ({ request }) => {
    t = await allTokens(request);

    const bad = await request.post('/auth/login', {
      data: { username: 'supplier1', password: 'wrong' },
    });
    expect(bad.status()).toBe(401);

    const noToken = await request.get('/invoices');
    expect(noToken.status()).toBe(401);
  });

  test('STEP 1 — supplier registers: REGISTERED, correct shape', async ({ request }) => {
    const r = await register(request, t.supplier, registerBody(INV_A), `${INV_A}-1`);
    expect(r.status()).toBe(200);
    const inv = await r.json();
    invoiceId = inv.invoiceId;

    expect(inv.status).toBe('REGISTERED');
    expect(inv.invoiceNumber).toBe(INV_A);
    expect(inv.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.registeredAt).toBeTruthy();
    expect(inv.financedBy).toBeNull();
  });

  test('RULE — re-using an invoice number is BLOCKED by the ledger', async ({ request }) => {
    const exact = await register(request, t.supplier, registerBody(INV_A), `${INV_A}-dup`); // identical resubmission
    expect(exact.status()).toBe(409);
    const exactErr = (await exact.json()).error;
    expect(exactErr).toMatch(/DUPLICATE INVOICE BLOCKED/i);
    expect(exactErr).not.toMatch(/tampered or fake/i); // same amount: no tamper note

    const altered = await register(request, t.supplier, registerBody(INV_A, 750000), `${INV_A}-tamper`); // same number, inflated amount
    expect(altered.status()).toBe(409);
    const alteredErr = (await altered.json()).error;
    expect(alteredErr).toMatch(/DUPLICATE INVOICE BLOCKED/i);
    expect(alteredErr).toMatch(/Possible tampered or fake invoice/i);
  });

  test('RULE — only the payer may approve; lender/supplier get 403', async ({ request }) => {
    for (const wrong of [t.supplier, t.lloyds]) {
      const r = await request.post(`/invoices/${invoiceId}/approve`, { headers: auth(wrong) });
      expect(r.status()).toBe(403);
    }
  });

  test('RULE — funding before approval is rejected', async ({ request }) => {
    const reg = await register(request, t.supplier, registerBody(INV_B, 400000), `${INV_B}-1`);
    const idB = (await reg.json()).invoiceId;

    const r = await request.post(`/invoices/${idB}/fund`, { headers: auth(t.lloyds) });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toMatch(/Only payer-APPROVED invoices/i);
  });

  test('RULE (CR01) — requestedAmount over the 90% cap is rejected by the ledger', async ({ request }) => {
    // 475000 is 95% of 500000 — allowed under the old 100% cap, rejected under 90%.
    const r = await register(request, t.supplier,
      { ...registerBody(`INV-API-${RUN}-CAP`, 500000), requestedAmount: 475000 }, `${RUN}-CAP`);
    expect(r.status()).toBe(409);
    const body = await r.json();
    expect(body.error).toMatch(/FINANCING REQUEST REJECTED/i);
    expect(body.error, 'message states the 90% cap').toMatch(/90%/);
  });

  test('RULE (hardening) — register with no invoice copy is rejected 400', async ({ request }) => {
    // JSON body => multer sees no multipart => no file => API fast-fail before the ledger.
    const r = await request.post('/invoices', {
      headers: auth(t.supplier),
      data: registerBody(`INV-API-${RUN}-NODOC`),
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body)).toMatch(/invoice copy/i);
  });

  test('RULE (integrity) — document verify matches the ledger anchor, and catches a tampered file', async ({ request }) => {
    // Fresh throwaway invoice (unique number) so corrupting its file affects nothing else.
    const INV_V = `INV-API-${RUN}-VERIFY`;
    const reg = await register(request, t.supplier, registerBody(INV_V), `${INV_V}-doc`);
    expect(reg.status()).toBe(200);
    const id = (await reg.json()).invoiceId;

    // 1) Clean file: the hash recomputed from disk equals the fingerprint on the ledger.
    const okr = await request.get(`/invoices/${id}/doc/invoiceCopy/verify`, { headers: auth(t.lloyds) });
    expect(okr.status()).toBe(200);
    const okv = await okr.json();
    expect(okv.algorithm).toBe('SHA-256');
    expect(okv.match).toBe(true);
    expect(okv.recomputedHash).toBe(okv.anchoredHash);

    // 2) Tamper the off-chain file on disk; the on-chain anchor cannot follow.
    //    Defaults to the standard api/data; override when the API-under-test
    //    writes elsewhere (e.g. an isolated instance): API_DATA_DIR=/path/to/data.
    const dataDir = process.env.API_DATA_DIR || path.resolve(process.cwd(), '..', 'api', 'data');
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'offchain.json'), 'utf8'));
    const fileName = db.docs[id].invoiceCopy.fileName;
    fs.appendFileSync(path.join(dataDir, 'docs', fileName), Buffer.from('TAMPERED-BYTES'));

    const badr = await request.get(`/invoices/${id}/doc/invoiceCopy/verify`, { headers: auth(t.lloyds) });
    expect(badr.status()).toBe(200);
    const badv = await badr.json();
    expect(badv.match).toBe(false);
    expect(badv.recomputedHash).not.toBe(badv.anchoredHash);
    expect(badv.anchoredHash).toBe(okv.anchoredHash);   // ledger anchor unchanged by the tamper
  });

  test('STEP 2 — payer approves: APPROVED; re-approval rejected', async ({ request }) => {
    const ok = await request.post(`/invoices/${invoiceId}/approve`, { headers: auth(t.payer) });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).status).toBe('APPROVED');

    const again = await request.post(`/invoices/${invoiceId}/approve`, { headers: auth(t.payer) });
    expect(again.status()).toBe(409); // only REGISTERED can be approved
  });

  test('RULE — a lender may decline; it never blocks other lenders', async ({ request }) => {
    const r = await request.post(`/invoices/${invoiceId}/decline`, {
      headers: auth(t.meridian),
      data: { reason: 'Outside risk appetite' },
    });
    expect(r.status()).toBe(200);
    const inv = await r.json();
    expect(inv.status, 'a decline does NOT change status').toBe('APPROVED');
    expect(inv.declines).toHaveLength(1);
    expect(inv.declines[0].by).toBe('Meridian Invoice Finance Ltd'); // own decline: unmasked
    expect(inv.declines[0].reason).toBe('Outside risk appetite');

    const again = await request.post(`/invoices/${invoiceId}/decline`, {
      headers: auth(t.meridian),
      data: { reason: 'twice' },
    });
    expect(again.status(), 'same lender cannot decline twice').toBe(409);
    expect((await again.json()).error).toMatch(/already declined/i);
  });

  test('STEP 5 — Lloyds funds: FINANCED with lender + timestamp', async ({ request }) => {
    const r = await request.post(`/invoices/${invoiceId}/fund`, { headers: auth(t.lloyds) });
    expect(r.status()).toBe(200);
    const inv = await r.json();
    expect(inv.status).toBe('FINANCED');
    expect(inv.financedBy).toBe('Lloyds Bank Commercial Banking');
    expect(inv.financedAt).toBeTruthy();
  });

  test('THE KILL SHOT — second lender is BLOCKED, competitor name masked', async ({ request }) => {
    const r = await request.post(`/invoices/${invoiceId}/fund`, { headers: auth(t.meridian) });
    expect(r.status()).toBe(409);
    const { error } = await r.json();
    expect(error).toMatch(/DUPLICATE FINANCING BLOCKED/i);
    expect(error).toMatch(/another financial institution/i);
    expect(error, 'losing lender must never learn WHO financed it').not.toMatch(/Lloyds/);
    // Idempotent: the rejection repeats forever, for anyone.
    const again = await request.post(`/invoices/${invoiceId}/fund`, { headers: auth(t.lloyds) });
    expect(again.status()).toBe(409);
  });

  test('LENDER ANONYMITY — reads and history never name a competitor', async ({ request }) => {
    const asOther = await (await request.get(`/invoices/${invoiceId}`, { headers: auth(t.meridian) })).json();
    expect(asOther.financedBy).toBe('another financial institution');

    const asLloyds = await (await request.get(`/invoices/${invoiceId}`, { headers: auth(t.lloyds) })).json();
    expect(asLloyds.financedBy).toBe('Lloyds Bank Commercial Banking');            // own name intact
    expect(asLloyds.declines[0].by).toBe('another financial institution');
    expect(asLloyds.declines[0].reason, 'foreign decline reasons stripped').toBeUndefined();

    const asPayer = await (await request.get(`/invoices/${invoiceId}`, { headers: auth(t.payer) })).json();
    expect(asPayer.financedBy, 'payer must know whom to settle with').toBe('Lloyds Bank Commercial Banking');

    const hist = await (await request.get(`/invoices/${invoiceId}/history`, { headers: auth(t.meridian) })).json();
    expect(JSON.stringify(hist), 'audit trail must not leak the competitor').not.toContain('Lloyds');
  });

  test('AUDIT TRAIL — immutable history: REGISTERED → APPROVED → FINANCED', async ({ request }) => {
    const r = await request.get(`/invoices/${invoiceId}/history`, { headers: auth(t.lloyds) });
    expect(r.status()).toBe(200);
    const history = await r.json();
    expect(history.length).toBeGreaterThanOrEqual(3);

    const statuses = history.map((h: any) => h.record?.status);
    expect(statuses).toContain('REGISTERED');
    expect(statuses).toContain('APPROVED');
    expect(statuses).toContain('FINANCED');
    for (const h of history) {
      expect(h.txId, 'every history entry carries a transaction id').toMatch(/^(tx-|mock-)?[0-9a-f]+$/i);
      expect(h.timestamp).toBeTruthy();
    }
  });

  test('RBAC MASKING — payer: last-4 bank only, no risk/requestedAmount', async ({ request }) => {
    const r = await request.get(`/invoices/${invoiceId}`, { headers: auth(t.payer) });
    const inv = await r.json();
    expect(inv.supplierProfile.bankAccount).toBe('••••5678');
    expect(inv.supplierProfile.sortCode, 'sort code masked for payer').toMatch(/•/);
    expect(inv.supplierProfile.ifsc, 'ifsc replaced by sortCode').toBeUndefined();
    expect(inv.risk).toBeUndefined();          // lender underwriting data — hidden from payer
    expect(inv.requestedAmount, 'financing economics hidden from payer').toBeUndefined();
    expect(inv.payerProfile, 'payer is not shown their own profile back').toBeNull();
    expect(JSON.stringify(inv)).not.toContain('12345678');
  });

  // INV_A is FINANCED BY LLOYDS, so the two lender viewers diverge: a competitor
  // stays masked; the funder unlocks the supplier's real bank details (CR01).
  test('RBAC MASKING — non-funding lender: masked bank + competitor anonymised', async ({ request }) => {
    const inv = await (await request.get(`/invoices/${invoiceId}`, { headers: auth(t.meridian) })).json();
    expect(inv.supplierProfile.bankAccount).toBe('••••5678');
    expect(inv.supplierProfile.sortCode).toMatch(/•/);
    expect(inv.financedBy).toBe('another financial institution');
    expect(inv.payerProfile?.paymentTerms, 'lender sees payer credit profile').toBeTruthy();
    expect(inv.risk?.grade).toMatch(/^[ABC]$/);
    expect(JSON.stringify(inv)).not.toContain('12345678');
  });

  test('RBAC MASKING — funding lender: entitlement unlock reveals full bank', async ({ request }) => {
    const inv = await (await request.get(`/invoices/${invoiceId}`, { headers: auth(t.lloyds) })).json();
    expect(inv.financedBy).toBe('Lloyds Bank Commercial Banking');                     // own name
    expect(inv.supplierProfile.bankAccount).toBe('12345678');   // full — funder entitlement
    expect(inv.supplierProfile.sortCode, 'funder sees real sort code').not.toMatch(/•/);
    expect(inv.risk?.grade).toMatch(/^[ABC]$/);
  });

  test('ENTITLEMENT — payment-instructions funder-only; 403 never names the funder', async ({ request }) => {
    const ok = await request.get(`/invoices/${invoiceId}/payment-instructions`, { headers: auth(t.lloyds) });
    expect(ok.status()).toBe(200);
    const pi = await ok.json();
    expect(pi.bankAccount).toBe('12345678');
    expect(pi.sortCode).toBeTruthy();

    const denied = await request.get(`/invoices/${invoiceId}/payment-instructions`, { headers: auth(t.meridian) });
    expect(denied.status()).toBe(403);
    const body = JSON.stringify(await denied.json());
    expect(body, 'the 403 must not leak the funder identity').not.toContain('Lloyds');
    expect(body).toMatch(/another institution/i);
  });

  test('RBAC MASKING — supplier sees their own record unmasked', async ({ request }) => {
    const r = await request.get(`/invoices/${invoiceId}`, { headers: auth(t.supplier) });
    const inv = await r.json();
    expect(inv.supplierProfile.bankAccount).toBe('12345678');
    expect(inv.supplierProfile.sortCode).not.toMatch(/•/);
  });
});
