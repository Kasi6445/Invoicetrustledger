import { test, expect, Page, Locator } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * ============================================================================
 * INVOICE TRUST LEDGER — FULL LIFECYCLE VIDEO EVIDENCE (UI)
 * ============================================================================
 * One continuous test = one continuous video of the entire flow:
 *
 *   1. Supplier uploads the invoice copy + fills the form  (register form)
 *   2. Supplier registers    -> REGISTERED on the ledger, docHash anchored
 *   3. Payer approves        -> APPROVED
 *   4. Second lender (OtherBank) opens its console while APPROVED (fund live)
 *   5. Lloyds funds          -> FINANCED (+ masked a/c pre-fund, risk grade)
 *   5b. Lloyds (the funder) opens Payment instructions -> FULL bank details
 *       (CR01 entitlement unlock)
 *   6. OtherBank clicks its stale Fund -> RED BANNER "DUPLICATE FINANCING
 *      BLOCKED … another financial institution" + OtherBank still sees the
 *      supplier bank MASKED (non-funder)                          <- KILL SHOT
 *   7. Audit trail modal     -> immutable history with real txIds
 *   8. Fake resubmission: same number, different amount -> BLOCKED at
 *      registration ("DUPLICATE INVOICE BLOCKED … Possible tampered…")
 *   9. Negative: the PAYER (never entitled) never sees the full bank account
 *
 * GEMINI IS STUBBED (constraint): this spec makes ZERO live /ai/extract calls —
 * page.route intercepts it. The form is filled MANUALLY here; the OCR autofill
 * PATH is covered by one separate targeted test in real-documents.spec.ts.
 *
 * REPEATABILITY: the ledger permanently blocks re-registering an invoice number
 * per supplier, so we use a unique per-run number.
 * ============================================================================
 */

const PDF = path.join(__dirname, '..', 'fixtures', 'invoice-clean-INV-2026-007.pdf');
const EVIDENCE = path.join(__dirname, '..', 'evidence');
const RUN = Date.now();
const INV_NO = `INV-E2E-${RUN}`; // unique per run -> repeatable suite

const FULL_BANK_ACCOUNT = '004512349876'; // funder-only; never for payer / non-funder
const MASKED_BANK = '••••9876';

// Deterministic stub for /ai/extract — no live Gemini, no quota spent.
const STUB_EXTRACT = {
  invoiceNumber: 'INV-2026-007', supplierName: 'Sri Lakshmi Textiles Pvt Ltd',
  supplierVRN: 'VRN123456', payerName: 'BigRetail Ltd', amount: 500000, currency: 'INR',
  invoiceDate: '2026-07-01', dueDate: '2026-08-30',
  goodsDescription: '200 bales cotton yarn, 40s count', poNumber: 'PO-BR-2026-3391',
  simulated: true, note: 'stubbed in e2e',
};
async function stubGemini(page: Page) {
  await page.route('**/ai/extract', route => route.fulfill({ json: STUB_EXTRACT }));
}

// ---------------------------------------------------------------------------
let shotIndex = 0;
async function shot(page: Page, name: string) {
  shotIndex += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `${String(shotIndex).padStart(2, '0')}-${name}.png`), fullPage: true });
}

async function loginAs(page: Page, who: RegExp) {
  await page.goto('/');
  const logoutBtn = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
  if (await logoutBtn.isVisible().catch(() => false)) await logoutBtn.click();
  await page.getByRole('button', { name: who }).first().click();
  await page.getByLabel(/password/i).fill('demo123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('button', { name: /log ?out/i })).toBeVisible({ timeout: 15_000 });
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /log ?out|sign ?out/i }).first().click();
}

function field(page: Page, label: RegExp, name: string): Locator {
  return page
    .getByLabel(label)
    .or(page.locator(`input[name="${name}"], select[name="${name}"], textarea[name="${name}"]`))
    .or(page.getByPlaceholder(label))
    .first();
}
async function fillSmart(loc: Locator, value: string) {
  const tag = await loc.evaluate((el) => el.tagName);
  if (tag === 'SELECT') await loc.selectOption(value).catch(() => loc.selectOption({ label: value }));
  else await loc.fill(value);
}

// Fill the supplier register form manually (OCR-independent). requestedAmount is
// always set because the ledger requires it and the Register button is disabled
// without it.
async function fillRegisterForm(page: Page, o: {
  invoiceNumber: string; amount: string; requestedAmount: string; dueDate: string; invoiceDate?: string;
}) {
  await field(page, /invoice ?number/i, 'invoiceNumber').fill(o.invoiceNumber);
  await fillSmart(field(page, /payer/i, 'payerName'), 'BigRetail Ltd');
  await field(page, /amount/i, 'amount').fill(o.amount);
  await field(page, /financing requested/i, 'requestedAmount').fill(o.requestedAmount);
  await fillSmart(field(page, /currency/i, 'currency'), 'INR');
  if (o.invoiceDate) await fillSmart(field(page, /invoice date/i, 'invoiceDate'), o.invoiceDate);
  await fillSmart(field(page, /due ?date/i, 'dueDate'), o.dueDate);
}

let apiToken: string | null = null;
async function apiState(requestFetch: typeof fetch, invNo: string) {
  if (!apiToken) {
    const login = await requestFetch('http://localhost:3000/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lloyds', password: 'demo123' }),
    }).then((r) => r.json());
    apiToken = login.token;
  }
  const all = await requestFetch('http://localhost:3000/invoices', {
    headers: { Authorization: `Bearer ${apiToken}` },
  }).then((r) => r.json());
  if (!Array.isArray(all)) { apiToken = null; return []; }
  return (all as any[]).filter((i) => i.invoiceNumber === invNo);
}

// ---------------------------------------------------------------------------

test('full invoice lifecycle: register → approve → fund → payment-instructions → DUPLICATE BLOCKED → audit trail → fake resubmission blocked', async ({ page, browser }, testInfo) => {
  await stubGemini(page);

  await test.step('1. SUPPLIER: upload invoice copy + fill the register form', async () => {
    await loginAs(page, /supplier|sri lakshmi/i);
    // First file input is the OCR dropzone (invoiceCopy) — upload drives the
    // on-chain docHash. /ai/extract is stubbed, so no live Gemini.
    await page.locator('input[type="file"]').first().setInputFiles(PDF);
    await fillRegisterForm(page, {
      invoiceNumber: INV_NO, amount: '500000', requestedAmount: '450000',
      invoiceDate: '2026-07-01', dueDate: '2026-08-30',
    });
    await shot(page, 'supplier-ocr-autofill');
  });

  await test.step('2. SUPPLIER: register -> REGISTERED with on-chain docHash', async () => {
    await page.getByRole('button', { name: /register on ledger/i }).click();
    await expect(page.getByText(INV_NO).first()).toBeVisible({ timeout: 30_000 });

    const [inv] = await apiState(fetch, INV_NO);
    expect(inv, 'invoice must exist on the ledger').toBeTruthy();
    expect(inv.status).toBe('REGISTERED');
    expect(inv.docHash, 'invoice-copy SHA-256 anchored on-chain').toMatch(/^[0-9a-f]{64}$/);
    expect(Number(inv.requestedAmount), 'requestedAmount persisted').toBe(450000);
    testInfo.annotations.push({ type: 'docHash', description: inv.docHash });
    await shot(page, 'supplier-registered');
  });

  await test.step('3. PAYER: approve -> APPROVED', async () => {
    await logout(page);
    await loginAs(page, /payer|bigretail/i);
    const row = page.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /approve/i }).click();
    await expect
      .poll(async () => (await apiState(fetch, INV_NO))[0]?.status, { timeout: 30_000, message: 'ledger -> APPROVED' })
      .toBe('APPROVED');
    await shot(page, 'payer-approved');
  });

  // Open OtherBank's console NOW, while APPROVED, so its Fund button is live.
  const otherCtx = await browser.newContext({
    baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 },
    recordVideo: { dir: testInfo.outputPath('otherbank-video'), size: { width: 1280, height: 800 } },
  });
  const otherPage = await otherCtx.newPage();

  await test.step('4. SECOND LENDER (OtherBank): console open, Fund button live', async () => {
    await loginAs(otherPage, /other ?bank/i);
    const otherRow = otherPage.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(otherRow).toBeVisible({ timeout: 15_000 });
    await expect(otherRow.getByRole('button', { name: /fund invoice/i }),
      'OtherBank sees an APPROVED, fundable invoice — the fraud window is open').toBeEnabled();
  });

  await test.step('5. LLOYDS: verify masking pre-fund, then fund -> FINANCED', async () => {
    await logout(page);
    await loginAs(page, /lloyds/i);
    const row = page.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Pre-fund Lloyds is NOT yet the funder -> bank masked, no full account.
    await expect(row.getByText(MASKED_BANK)).toBeVisible();
    await expect(page.getByText(FULL_BANK_ACCOUNT)).toHaveCount(0);
    await expect(row.getByText(/[ABC] \(\d+\)/)).toBeVisible();   // risk grade

    await row.getByRole('button', { name: /fund invoice/i }).click();
    await expect
      .poll(async () => (await apiState(fetch, INV_NO))[0]?.status, { timeout: 30_000, message: 'ledger -> FINANCED' })
      .toBe('FINANCED');
    expect((await apiState(fetch, INV_NO))[0].financedBy).toBe('Lloyds Bank');

    await page.getByRole('button', { name: /funded by me/i }).click();
    const fundedRow = page.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(fundedRow).toBeVisible({ timeout: 15_000 });
    await expect(fundedRow.getByRole('button', { name: /financed by you/i })).toBeDisabled();
    await shot(page, 'lloyds-financed');
  });

  await test.step('5b. LLOYDS (funder): Payment instructions modal reveals full bank details', async () => {
    const fundedRow = page.locator('tr').filter({ hasText: INV_NO }).first();
    await fundedRow.getByRole('button', { name: /payment instructions/i }).click();
    // CR01 entitlement unlock: the funder — and only the funder — sees the
    // supplier's real account + IFSC. Scope to the modal (the funder also sees
    // full accounts inline on other rows it financed).
    const modal = page.locator('.modal');
    await expect(modal.getByRole('heading', { name: /payment instructions/i })).toBeVisible();
    await expect(modal.getByText(FULL_BANK_ACCOUNT)).toBeVisible();
    await expect(modal.getByText(/HDFC0001234/)).toBeVisible();
    await shot(page, 'lloyds-payment-instructions');
    await page.getByRole('button', { name: /close/i }).click();
  });

  await test.step('6. KILL SHOT: OtherBank clicks its stale Fund -> LEDGER REJECTS (and stays masked)', async () => {
    const otherRow = otherPage.locator('tr').filter({ hasText: INV_NO }).first();
    // Non-funder masking: OtherBank never sees the supplier's real account.
    await expect(otherRow.getByText(MASKED_BANK)).toBeVisible();
    await expect(otherPage.getByText(FULL_BANK_ACCOUNT)).toHaveCount(0);

    await otherRow.getByRole('button', { name: /fund invoice/i }).click();

    // The chaincode's own rejection, rendered in the red banner (LenderView.jsx).
    await expect(otherPage.getByText(/LEDGER REJECTED THIS TRANSACTION/i)).toBeVisible({ timeout: 30_000 });
    await expect(otherPage.getByText(/DUPLICATE FINANCING BLOCKED/i)).toBeVisible();
    await expect(otherPage.getByText(/another financial institution/i)).toBeVisible();
    await expect(otherPage.getByText(/Lloyds/)).toHaveCount(0);
    await shot(otherPage, 'KILL-SHOT-duplicate-financing-blocked');
  });

  const otherVideo = otherPage.video();
  await otherCtx.close();
  if (otherVideo) fs.copyFileSync(await otherVideo.path(), path.join(EVIDENCE, 'otherbank-kill-shot.webm'));

  await test.step('7. AUDIT TRAIL: immutable history with real blockchain txIds', async () => {
    const row = page.locator('tr').filter({ hasText: INV_NO }).first();
    await row.getByRole('button', { name: /audit trail/i }).click();
    await expect(page.getByText(/On-chain audit trail/i)).toBeVisible();
    for (const status of [/REGISTERED/, /APPROVED/, /FINANCED/]) {
      await expect(page.getByText(status).first()).toBeVisible();
    }
    await expect(page.getByText(/tx (tx-|mock-)?[0-9a-f]{12,}/i).first()).toBeVisible();
    await shot(page, 'audit-trail-immutable-history');
    await page.getByRole('button', { name: /close/i }).click();
  });

  await test.step('8. FAKE RESUBMISSION: same number, different amount -> BLOCKED at registration', async () => {
    await logout(page);
    await loginAs(page, /supplier|sri lakshmi/i);
    await fillRegisterForm(page, {
      invoiceNumber: INV_NO, amount: '750000', requestedAmount: '700000', dueDate: '2026-09-15',
    });
    await page.getByRole('button', { name: /register on ledger/i }).click();

    await expect(page.getByText(/LEDGER REJECTED THIS TRANSACTION/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/DUPLICATE INVOICE BLOCKED/i)).toBeVisible();
    await expect(page.getByText(/Possible tampered or fake invoice/i)).toBeVisible();
    await shot(page, 'supplier-duplicate-invoice-blocked');

    expect((await apiState(fetch, INV_NO)).length).toBe(1);
  });

  await test.step('9. NEGATIVE: the payer (never entitled) never sees the full bank account', async () => {
    await logout(page);
    await loginAs(page, /payer|bigretail/i);
    // Payer is never a funder — the entitlement unlock must not reach them.
    await expect(page.getByText(FULL_BANK_ACCOUNT)).toHaveCount(0);
  });
});
