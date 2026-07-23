import { test, expect, Page, Locator } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * ============================================================================
 * REAL-DOCUMENT SCENARIOS — the actual demo PDFs, as-is (no renaming)
 * ============================================================================
 * The point here is the OPPOSITE of the lifecycle spec: use the real fixture
 * PDFs with their real invoice numbers so the ledger's permanent rules fire.
 * The uploaded file still drives the on-chain docHash; the form is filled
 * MANUALLY (Gemini is stubbed — see below), so these tests never depend on OCR.
 *
 *   R1. SECOND LAYOUT + HASH PROOF — a differently-designed invoice
 *       (INV-2026-014, ₹3,25,000) registers, and the on-chain docHash ===
 *       sha256 of the uploaded file (cryptographic doc-integrity proof).
 *   R2. DUPLICATE INVOICE BLOCKED — register the real INV-2026-007 twice;
 *       the ledger refuses the second registration of the number, on screen.
 *   R3. TAMPERED RESUBMISSION — the tampered twin (same number, ₹7,50,000) is
 *       REJECTED at registration; the lender never sees a ₹7,50,000 row.
 *   R4. SIMILAR-INVOICE FLAG — the SAME PDF under a NEW number registers, but
 *       the read-time document-hash match flags it (−25, ⚠ similar chip).
 *   OCR. (targeted) uploading the invoice copy autofills the form — the ONE
 *       test that exercises the OCR path (against the stub).
 *
 * GEMINI IS STUBBED: `test.beforeEach` intercepts the /ai/extract route with a
 * fixed response, so this whole file makes ZERO live Gemini calls — the demo
 * quota stays intact. Real OCR accuracy is a manual demo check.
 * ============================================================================
 */

const FIX = (f: string) => path.join(__dirname, '..', 'fixtures', f);
const PDF_007 = FIX('invoice-clean-INV-2026-007.pdf');
const PDF_TAMPERED = FIX('invoice-TAMPERED-INV-2026-007.pdf');
const PDF_014 = FIX('invoice-clean-INV-2026-014.pdf');

const EVIDENCE = path.join(__dirname, '..', 'evidence');
const HASH_PROOF = path.join(EVIDENCE, 'hash-proof.txt');
const RUN = Date.now();

const sha256 = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const STUB_EXTRACT = {
  invoiceNumber: 'INV-2026-007', supplierName: 'Sri Lakshmi Textiles Pvt Ltd',
  supplierVRN: 'VRN123456', payerName: 'BigRetail Ltd', amount: 500000, currency: 'INR',
  invoiceDate: '2026-07-01', dueDate: '2026-08-30',
  goodsDescription: '200 bales cotton yarn, 40s count', poNumber: 'PO-BR-2026-3391',
  simulated: true, note: 'stubbed in e2e',
};

// ---------------------------------------------------------------------------

let shotIndex = 0;
async function shot(page: Page, name: string) {
  shotIndex += 1;
  await page.screenshot({ path: path.join(EVIDENCE, `R${shotIndex}-${name}.png`), fullPage: true });
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
    .or(page.locator(`input[name="${name}"], select[name="${name}"]`))
    .or(page.getByPlaceholder(label))
    .first();
}
async function fillSmart(loc: Locator, value: string) {
  const tag = await loc.evaluate((el) => el.tagName);
  if (tag === 'SELECT') await loc.selectOption(value).catch(() => loc.selectOption({ label: value }));
  else await loc.fill(value);
}

// Upload the invoice copy (drives docHash) then fill the form manually. The
// stubbed /ai/extract may pre-fill fields; we overwrite them deterministically.
async function uploadThenFill(page: Page, pdf: string, o: {
  invoiceNumber: string; amount: string; requestedAmount: string; dueDate: string;
}) {
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  await field(page, /invoice ?number/i, 'invoiceNumber').fill(o.invoiceNumber);
  await fillSmart(field(page, /payer/i, 'payerName'), 'BigRetail Ltd');
  await field(page, /amount/i, 'amount').fill(o.amount);
  await field(page, /financing requested/i, 'requestedAmount').fill(o.requestedAmount);
  await fillSmart(field(page, /currency/i, 'currency'), 'INR');
  await fillSmart(field(page, /due ?date/i, 'dueDate'), o.dueDate);
}

function armDialogCapture(page: Page): { last: () => string } {
  let msg = '';
  page.on('dialog', async (d) => { msg = d.message(); await d.dismiss().catch(() => {}); });
  return { last: () => msg };
}
async function expectDuplicateBlocked(page: Page, dialogs: { last: () => string }) {
  const onScreen = page.getByText(/DUPLICATE INVOICE BLOCKED/i).first();
  try {
    await expect(onScreen).toBeVisible({ timeout: 20_000 });
  } catch {
    expect(dialogs.last(), 'rejection should surface as text or alert dialog').toMatch(/DUPLICATE INVOICE BLOCKED/i);
  }
}

let cachedToken: string | null = null;
async function lenderToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const r = await fetch('http://localhost:3000/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lloyds', password: 'demo123' }),
  }).then((x) => x.json());
  cachedToken = r.token;
  return r.token;
}
async function ledgerFind(invoiceNumber: string, amount: number) {
  const token = await lenderToken();
  const all: any[] = await fetch('http://localhost:3000/invoices', { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json());
  if (!Array.isArray(all)) { cachedToken = null; return []; }
  return all.filter((i) => i.invoiceNumber === invoiceNumber && Number(i.amount) === amount);
}
async function ledgerFindByNumber(invoiceNumber: string) {
  const token = await lenderToken();
  const all: any[] = await fetch('http://localhost:3000/invoices', { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json());
  if (!Array.isArray(all)) { cachedToken = null; return []; }
  return all.filter((i) => i.invoiceNumber === invoiceNumber);
}

// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.describe('Real-document scenarios (fixture PDFs, as-is)', () => {
  // Stub Gemini for every test — zero live /ai/extract calls.
  test.beforeEach(async ({ page }) => {
    await page.route('**/ai/extract', route => route.fulfill({ json: STUB_EXTRACT }));
  });

  test('R1 — second layout registers + on-chain hash === file sha256', async ({ page }) => {
    const fileHash = sha256(PDF_014);
    fs.writeFileSync(HASH_PROOF,
      `Cryptographic doc-integrity proof — run ${new Date().toISOString()}\n` +
      `${'='.repeat(70)}\n\n` +
      `invoice-clean-INV-2026-014.pdf\n  sha256(file) = ${fileHash}\n`);

    await loginAs(page, /supplier|sri lakshmi/i);
    const unique = `INV-014-E2E-${RUN}`;   // unique number so R1 stays repeatable
    await uploadThenFill(page, PDF_014, { invoiceNumber: unique, amount: '325000', requestedAmount: '300000', dueDate: '2026-09-20' });
    await shot(page, 'ocr-second-layout-INV-2026-014');
    await page.getByRole('button', { name: /register on ledger/i }).click();

    await expect.poll(async () => (await ledgerFind(unique, 325000)).length, { timeout: 30_000 }).toBe(1);
    const [inv] = await ledgerFind(unique, 325000);
    expect(inv.docHash, 'ledger must anchor exactly the sha256 of the uploaded PDF').toBe(fileHash);
    fs.appendFileSync(HASH_PROOF, `  docHash on-chain (${inv.invoiceId}) = ${inv.docHash}\n  MATCH: YES\n\n`);
  });

  test('R2 — the real INV-2026-007 PDF: duplicate invoice number BLOCKED by the ledger', async ({ page }) => {
    const dialogs = armDialogCapture(page);
    const fileHash = sha256(PDF_007);
    const preExisting = (await ledgerFindByNumber('INV-2026-007')).length > 0;

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadThenFill(page, PDF_007, { invoiceNumber: 'INV-2026-007', amount: '500000', requestedAmount: '450000', dueDate: '2026-08-30' });
    await page.getByRole('button', { name: /register on ledger/i }).click();

    if (preExisting) {
      await expectDuplicateBlocked(page, dialogs);
    } else {
      await expect.poll(async () => (await ledgerFind('INV-2026-007', 500000)).length, { timeout: 30_000 }).toBe(1);
      await page.reload();
      await loginAs(page, /supplier|sri lakshmi/i);
      await uploadThenFill(page, PDF_007, { invoiceNumber: 'INV-2026-007', amount: '500000', requestedAmount: '450000', dueDate: '2026-08-30' });
      await page.getByRole('button', { name: /register on ledger/i }).click();
      await expectDuplicateBlocked(page, dialogs);
    }
    await shot(page, 'duplicate-invoice-blocked-real-pdf');

    const matches = await ledgerFindByNumber('INV-2026-007');
    expect(matches.length, 'an invoice number registers at most once per supplier').toBe(1);
    fs.appendFileSync(HASH_PROOF,
      `invoice-clean-INV-2026-007.pdf\n  sha256(file) = ${fileHash}\n` +
      `  docHash on-chain (${matches[0].invoiceId}) = ${matches[0].docHash}\n` +
      `  MATCH: ${matches[0].docHash === fileHash ? 'YES' : 'no (pre-existing registration)'}\n\n`);
    if (!preExisting) expect(matches[0].docHash).toBe(fileHash);
  });

  test('R3 — the TAMPERED twin (₹7.5L, same number): REJECTED at registration', async ({ page }) => {
    const dialogs = armDialogCapture(page);
    const before = await ledgerFindByNumber('INV-2026-007');
    expect(before.length, 'R2 must have left INV-2026-007 on the ledger').toBeGreaterThan(0);

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadThenFill(page, PDF_TAMPERED, { invoiceNumber: 'INV-2026-007', amount: '750000', requestedAmount: '700000', dueDate: '2026-09-15' });
    await shot(page, 'tampered-pdf-ocr-inflated-amount');
    await page.getByRole('button', { name: /register on ledger/i }).click();

    await expectDuplicateBlocked(page, dialogs);
    if (Number(before[0].amount) !== 750000) {
      await expect(page.getByText(/Possible tampered or fake invoice/i).first()).toBeVisible();
    }
    await shot(page, 'supplier-tampered-resubmission-blocked');

    expect((await ledgerFindByNumber('INV-2026-007')).length).toBe(before.length);

    await logout(page);
    await loginAs(page, /lloyds/i);
    await page.getByRole('button', { name: /^All \(/ }).click();
    await expect(page.locator('tr').filter({ hasText: 'INV-2026-007' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tr').filter({ hasText: 'INV-2026-007' }).filter({ hasText: /7,?50,?000/ })).toHaveCount(0);
    await shot(page, 'lender-sees-no-tampered-row');
  });

  test('R4 — SAME PDF under a NEW number: registers, but flagged as similar', async ({ page }) => {
    const twinA = `INV-014-TWIN-${RUN}-A`;
    const twinB = `INV-014-TWIN-${RUN}-B`;

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadThenFill(page, PDF_014, { invoiceNumber: twinA, amount: '325000', requestedAmount: '300000', dueDate: '2026-09-20' });
    await page.getByRole('button', { name: /register on ledger/i }).click();
    await expect.poll(async () => (await ledgerFindByNumber(twinA)).length, { timeout: 30_000 }).toBe(1);

    await page.reload();
    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadThenFill(page, PDF_014, { invoiceNumber: twinB, amount: '325000', requestedAmount: '300000', dueDate: '2026-09-20' });
    await page.getByRole('button', { name: /register on ledger/i }).click();
    await expect.poll(async () => (await ledgerFindByNumber(twinB)).length, { timeout: 30_000 }).toBe(1);
    await shot(page, 'same-pdf-new-number-registered');

    const [twin] = await ledgerFindByNumber(twinB);
    expect(twin.risk.similar?.sameDocument, 'document-hash match must name the twin').toContain(twinA);
    expect(twin.risk.reasons.join(' | ')).toMatch(/Same document already registered .* re-numbered resubmission \(−25\)/);

    await logout(page);
    await loginAs(page, /lloyds/i);
    await page.getByRole('button', { name: /^All \(/ }).click();
    const row = page.locator('tr', { has: page.locator('td:first-child', { hasText: twinB }) });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row.locator('div.similar'), 'flagged row must carry the ⚠ similar chip').toBeVisible();
    await shot(page, 'lender-similar-flag-same-document');
  });

  // The ONE test that exercises the OCR path (constraint: stub Gemini, cover
  // OCR in a single targeted test). Uploading the invoice copy autofills the
  // form from the (stubbed) extraction — proving the upload -> extract ->
  // form-populate wiring without spending live quota.
  test('OCR — uploading the invoice copy autofills the form (stubbed extraction)', async ({ page }) => {
    await loginAs(page, /supplier|sri lakshmi/i);
    await page.locator('input[type="file"]').first().setInputFiles(PDF_007);
    await expect(field(page, /invoice ?number/i, 'invoiceNumber'), 'invoice number autofilled').toHaveValue(/INV-2026-007/);
    await expect(field(page, /amount/i, 'amount'), 'amount autofilled').toHaveValue(/500000/);
    await shot(page, 'ocr-autofill-wiring');
  });
});
