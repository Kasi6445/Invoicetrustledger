import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * ============================================================================
 * API REGRESSION — the business rules, proven at the contract level
 * ============================================================================
 * These tests hit http://localhost:3000 directly. No browser, no selectors —
 * they will keep passing even if the portal markup changes completely.
 * Every rule from slide 10 gets a direct assertion, including the two
 * rejections the whole project exists for:
 *
 *   - DUPLICATE REGISTRATION BLOCKED   (same fingerprint twice)
 *   - DUPLICATE FINANCING BLOCKED      (the kill shot, from the chaincode)
 *
 * Repeatable: every run uses fresh unique invoice numbers.
 * Zero Gemini calls: registrations here are JSON-only (no /ai/extract).
 * ============================================================================
 */

const RUN = Date.now();
const INV_A = `INV-API-${RUN}-A`; // happy path + duplicates
const INV_B = `INV-API-${RUN}-B`; // fund-before-approval guard

type Tokens = { supplier: string; payer: string; lloyds: string; otherbank: string };

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
    otherbank: await login(request, 'otherbank'),
  };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const registerBody = (invoiceNumber: string, amount = 500000) => ({
  invoiceNumber,
  payerName: 'BigRetail Ltd',
  amount,
  currency: 'INR',
  dueDate: '2026-08-30',
});

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
    const r = await request.post('/invoices', {
      headers: auth(t.supplier),
      data: registerBody(INV_A),
    });
    expect(r.status()).toBe(200);
    const inv = await r.json();
    invoiceId = inv.invoiceId;

    expect(inv.status).toBe('REGISTERED');
    expect(inv.invoiceNumber).toBe(INV_A);
    expect(inv.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.registeredAt).toBeTruthy();
    expect(inv.financedBy).toBeNull();
  });

  test('RULE — duplicate registration is BLOCKED by the ledger', async ({ request }) => {
    const r = await request.post('/invoices', {
      headers: auth(t.supplier),
      data: registerBody(INV_A), // identical fingerprint
    });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toMatch(/DUPLICATE REGISTRATION BLOCKED/i);
  });

  test('RULE — only the payer may approve; lender/supplier get 403', async ({ request }) => {
    for (const wrong of [t.supplier, t.lloyds]) {
      const r = await request.post(`/invoices/${invoiceId}/approve`, { headers: auth(wrong) });
      expect(r.status()).toBe(403);
    }
  });

  test('RULE — funding before approval is rejected', async ({ request }) => {
    const reg = await request.post('/invoices', {
      headers: auth(t.supplier),
      data: registerBody(INV_B, 400000),
    });
    const idB = (await reg.json()).invoiceId;

    const r = await request.post(`/invoices/${idB}/fund`, { headers: auth(t.lloyds) });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toMatch(/Only payer-APPROVED invoices/i);
  });

  test('STEP 2 — payer approves: APPROVED; re-approval rejected', async ({ request }) => {
    const ok = await request.post(`/invoices/${invoiceId}/approve`, { headers: auth(t.payer) });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).status).toBe('APPROVED');

    const again = await request.post(`/invoices/${invoiceId}/approve`, { headers: auth(t.payer) });
    expect(again.status()).toBe(409); // only REGISTERED can be approved
  });

  test('STEP 5 — Lloyds funds: FINANCED with lender + timestamp', async ({ request }) => {
    const r = await request.post(`/invoices/${invoiceId}/fund`, { headers: auth(t.lloyds) });
    expect(r.status()).toBe(200);
    const inv = await r.json();
    expect(inv.status).toBe('FINANCED');
    expect(inv.financedBy).toBe('Lloyds Bank');
    expect(inv.financedAt).toBeTruthy();
  });

  test('THE KILL SHOT — second lender is BLOCKED by the chaincode', async ({ request }) => {
    const r = await request.post(`/invoices/${invoiceId}/fund`, { headers: auth(t.otherbank) });
    expect(r.status()).toBe(409);
    const { error } = await r.json();
    expect(error).toMatch(/DUPLICATE FINANCING BLOCKED/i);
    expect(error).toMatch(/already financed by Lloyds Bank/i);
    // Idempotent: the rejection repeats forever, for anyone.
    const again = await request.post(`/invoices/${invoiceId}/fund`, { headers: auth(t.lloyds) });
    expect(again.status()).toBe(409);
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
      expect(h.txId, 'every history entry carries a transaction id').toMatch(/^(mock-)?[0-9a-f]+$/i);
      expect(h.timestamp).toBeTruthy();
    }
  });

  test('RBAC MASKING — payer: last-4 bank only, no risk/tamper fields', async ({ request }) => {
    const r = await request.get(`/invoices/${invoiceId}`, { headers: auth(t.payer) });
    const inv = await r.json();
    expect(inv.supplierProfile.bankAccount).toBe('••••9876');
    expect(inv.supplierProfile.sortCode).toBe('••-••-••');
    expect(inv.risk).toBeUndefined();          // lender underwriting data — hidden from payer
    expect(inv.tamperWarning).toBeUndefined(); // lender-facing signal — hidden from payer
    expect(JSON.stringify(inv)).not.toContain('004512349876');
  });

  test('RBAC MASKING — lender: last-4 bank, risk grade present', async ({ request }) => {
    const r = await request.get(`/invoices/${invoiceId}`, { headers: auth(t.lloyds) });
    const inv = await r.json();
    expect(inv.supplierProfile.bankAccount).toBe('••••9876');
    expect(inv.risk?.grade).toMatch(/^[ABC]$/);
    expect(Array.isArray(inv.risk?.reasons)).toBe(true);
    expect(JSON.stringify(inv)).not.toContain('004512349876');
  });

  test('RBAC MASKING — supplier sees their own record unmasked', async ({ request }) => {
    const r = await request.get(`/invoices/${invoiceId}`, { headers: auth(t.supplier) });
    const inv = await r.json();
    expect(inv.supplierProfile.bankAccount).toBe('004512349876');
  });
});
