import { test, expect, Page, Locator } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * ============================================================================
 * REAL-DOCUMENT SCENARIOS — the actual demo PDFs, as-is (no renaming)
 * ============================================================================
 * Complements invoice-lifecycle.spec.ts (which uses unique numbers for
 * repeatability). Here the point is the OPPOSITE: use the real fixture PDFs
 * with their real invoice numbers, so the ledger's permanent rules fire.
 *
 *   R1. OCR GENERALIZATION — the second, differently-designed invoice
 *       (INV-2026-014, teal letterhead) is extracted correctly, then
 *       registered under a unique number. PLUS: cryptographic proof that
 *       the on-chain docHash === sha256 of the uploaded file.
 *
 *   R2. DUPLICATE REGISTRATION BLOCKED — upload invoice-clean-INV-2026-007
 *       and register it UNCHANGED. Whatever the ledger's prior state, this
 *       test always ends at the same place: the ledger refusing a second
 *       identical registration, on screen.
 *
 *   R3. TAMPERED RESUBMISSION — upload the TAMPERED twin (same number,
 *       ₹7,50,000). The ledger accepts it but stamps a permanent
 *       tamperWarning, and the lender console shows the ⚠ flag.
 *
 * STATE-TOLERANT DESIGN: R2/R3 check the ledger via API *before* acting and
 * branch: fresh ledger -> register succeeds first, then the duplicate attempt
 * is blocked; already-populated ledger (e.g. this morning's manual testing,
 * or a previous run of this suite) -> the very first attempt is blocked.
 * Both branches capture the same evidence. The suite is green forever.
 *
 * GEMINI QUOTA: up to 4 /ai/extract calls in this file (007 once or twice,
 * tampered once, 014 once). Free tier = 10/min. Do not loop this spec.
 * ============================================================================
 */

const FIX = (f: string) => path.join(__dirname, '..', 'fixtures', f);
const PDF_007 = FIX('invoice-clean-INV-2026-007.pdf');
const PDF_TAMPERED = FIX('invoice-TAMPERED-INV-2026-007.pdf');
const PDF_014 = FIX('invoice-clean-INV-2026-014.pdf');

const EVIDENCE = path.join(__dirname, '..', 'evidence');
const HASH_PROOF = path.join(EVIDENCE, 'hash-proof.txt');
const RUN = Date.now();

const sha256 = (p: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// ---------------------------------------------------------------------------
// helpers (same [ADAPT] semantics as invoice-lifecycle.spec.ts)
// ---------------------------------------------------------------------------

let shotIndex = 0;
async function shot(page: Page, name: string) {
  shotIndex += 1;
  await page.screenshot({
    path: path.join(EVIDENCE, `R${shotIndex}-${name}.png`),
    fullPage: true,
  });
}

/** Reconciled against Login.jsx: a role card only PRE-FILLS the username — real
 *  authentication happens on form submit with the password. */
async function loginAs(page: Page, who: RegExp) {
  await page.goto('/');
  // sessionStorage keeps a session alive across goto/reload — sign out first if so.
  const logoutBtn = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
  if (await logoutBtn.isVisible().catch(() => false)) await logoutBtn.click();
  await page.getByRole('button', { name: who }).first().click();
  await page.getByLabel(/password/i).fill('demo123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('button', { name: /log ?out/i }))
    .toBeVisible({ timeout: 15_000 });
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /log ?out|sign ?out/i }).first().click(); // [ADAPT]
}

function field(page: Page, label: RegExp, name: string): Locator {
  return page
    .getByLabel(label)
    .or(page.locator(`input[name="${name}"], select[name="${name}"]`))
    .or(page.getByPlaceholder(label))
    .first();
}

/** SupplierView may render the 409 error as text or fire an alert(). Accept both. */
function armDialogCapture(page: Page): { last: () => string } {
  let msg = '';
  page.on('dialog', async (d) => { msg = d.message(); await d.dismiss().catch(() => {}); });
  return { last: () => msg };
}

async function expectDuplicateBlocked(page: Page, dialogs: { last: () => string }) {
  // [ADAPT] generated SupplierView shows "the server's error message" on failure.
  const onScreen = page.getByText(/DUPLICATE REGISTRATION BLOCKED/i).first();
  try {
    await expect(onScreen).toBeVisible({ timeout: 20_000 });
  } catch {
    expect(dialogs.last(), 'rejection should surface as text or alert dialog')
      .toMatch(/DUPLICATE REGISTRATION BLOCKED/i);
  }
}

// --- read ledger state via the API so tests can branch on prior history ----

// Cache the token: ledgerFind runs inside expect.poll loops, and logging in on
// every iteration trips the API's /auth/login rate limit (20/min).
let cachedToken: string | null = null;
async function lenderToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const r = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'lloyds', password: 'demo123' }),
  }).then((x) => x.json());
  cachedToken = r.token;
  return r.token;
}

async function ledgerFind(invoiceNumber: string, amount: number) {
  const token = await lenderToken();
  const all: any[] = await fetch('http://localhost:3000/invoices', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((x) => x.json());
  if (!Array.isArray(all)) { cachedToken = null; return []; } // bad/expired token: retry next poll
  return all.filter((i) => i.invoiceNumber === invoiceNumber && Number(i.amount) === amount);
}

async function uploadAndAwaitOcr(page: Page, pdf: string, expectNo: RegExp, expectAmt: RegExp) {
  await page.setInputFiles('input[type="file"]', pdf);
  const invNo = field(page, /invoice ?number/i, 'invoiceNumber');
  await expect(invNo, 'Gemini should extract the invoice number')
    .toHaveValue(expectNo, { timeout: 60_000 });
  await expect(field(page, /amount/i, 'amount'), 'Gemini should extract the amount')
    .toHaveValue(expectAmt);
  return invNo;
}

// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test.describe('Real-document scenarios (fixture PDFs, as-is)', () => {

  test('R1 — OCR generalizes to a different layout + on-chain hash === file sha256', async ({ page }) => {
    const fileHash = sha256(PDF_014);
    fs.writeFileSync(HASH_PROOF,
      `Cryptographic doc-integrity proof — run ${new Date().toISOString()}\n` +
      `${'='.repeat(70)}\n\n` +
      `invoice-clean-INV-2026-014.pdf\n  sha256(file) = ${fileHash}\n`);

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadAndAwaitOcr(page, PDF_014, /INV-2026-014/i, /325000|3,?25,?000/);
    await shot(page, 'ocr-second-layout-INV-2026-014');

    // Unique number so R1 stays repeatable; document (and its hash) unchanged.
    const unique = `INV-014-E2E-${RUN}`;
    await field(page, /invoice ?number/i, 'invoiceNumber').fill(unique);
    await page.getByRole('button', { name: /register/i }).click();

    await expect
      .poll(async () => (await ledgerFind(unique, 325000)).length, { timeout: 30_000 })
      .toBe(1);
    const [inv] = await ledgerFind(unique, 325000);

    expect(inv.docHash, 'ledger must anchor exactly the sha256 of the uploaded PDF')
      .toBe(fileHash);
    fs.appendFileSync(HASH_PROOF,
      `  docHash on-chain (${inv.invoiceId}) = ${inv.docHash}\n  MATCH: YES\n\n`);
  });

  test('R2 — the real INV-2026-007 PDF: duplicate registration BLOCKED by the ledger', async ({ page }) => {
    const dialogs = armDialogCapture(page);
    const fileHash = sha256(PDF_007);
    const preExisting = (await ledgerFind('INV-2026-007', 500000)).length > 0;

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadAndAwaitOcr(page, PDF_007, /INV-2026-007/i, /500000|5,?00,?000/);
    await page.getByRole('button', { name: /register/i }).click(); // register AS-IS

    if (preExisting) {
      // Already on the ledger (this morning's testing / a prior run):
      // the very first attempt must be rejected.
      await expectDuplicateBlocked(page, dialogs);
    } else {
      // Fresh ledger: first registration lands...
      await expect
        .poll(async () => (await ledgerFind('INV-2026-007', 500000)).length, { timeout: 30_000 })
        .toBe(1);
      // ...and the second identical attempt is rejected.
      await page.reload();
      await loginAs(page, /supplier|sri lakshmi/i);
      await uploadAndAwaitOcr(page, PDF_007, /INV-2026-007/i, /500000|5,?00,?000/);
      await page.getByRole('button', { name: /register/i }).click();
      await expectDuplicateBlocked(page, dialogs);
    }
    await shot(page, 'duplicate-registration-blocked-real-pdf');

    // The rule held: exactly ONE such invoice exists, ever.
    const matches = await ledgerFind('INV-2026-007', 500000);
    expect(matches.length, 'fingerprint uniqueness must hold').toBe(1);

    // Hash proof (strict when this run created it; informational if pre-existing,
    // since an earlier manual registration may have attached no/another file).
    fs.appendFileSync(HASH_PROOF,
      `invoice-clean-INV-2026-007.pdf\n  sha256(file) = ${fileHash}\n` +
      `  docHash on-chain (${matches[0].invoiceId}) = ${matches[0].docHash}\n` +
      `  MATCH: ${matches[0].docHash === fileHash ? 'YES' : 'no (pre-existing registration)'}\n\n`);
    if (!preExisting) expect(matches[0].docHash).toBe(fileHash);
  });

  test('R3 — the TAMPERED twin (₹7.5L, same number): permanent tamper flag for lenders', async ({ page }) => {
    const dialogs = armDialogCapture(page);
    const preExisting = (await ledgerFind('INV-2026-007', 750000)).length > 0;

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadAndAwaitOcr(page, PDF_TAMPERED, /INV-2026-007/i, /750000|7,?50,?000/);
    await shot(page, 'tampered-pdf-ocr-inflated-amount');
    await page.getByRole('button', { name: /register/i }).click();

    if (preExisting) {
      // A prior run already registered the tampered version -> duplicate block,
      // which is itself the rule working. The tamper flag below still verifies.
      await expectDuplicateBlocked(page, dialogs);
    } else {
      await expect
        .poll(async () => (await ledgerFind('INV-2026-007', 750000)).length, { timeout: 30_000 })
        .toBe(1);
    }

    // The permanent, on-ledger warning — regardless of which branch ran.
    const [tampered] = await ledgerFind('INV-2026-007', 750000);
    expect(tampered.tamperWarning, 'ledger must carry the altered-resubmission warning')
      .toMatch(/previously registered/i);
    expect(tampered.tamperWarning).toMatch(/500000/);

    // And the lender sees it: the ₹7,50,000 row for INV-2026-007 carries the flag.
    await logout(page);
    await loginAs(page, /lloyds/i);
    const tamperedRow = page.locator('tr')
      .filter({ hasText: 'INV-2026-007' })
      .filter({ hasText: /7,?50,?000/ })
      .first();
    await expect(tamperedRow).toBeVisible({ timeout: 15_000 });
    // div.tamper is the visible "⚠ tamper flag" badge; the collapsed risk
    // <details> also contains the words "tamper flag", hidden — scope precisely.
    await expect(tamperedRow.locator('div.tamper'),
      'lender console must surface the tamper warning').toBeVisible();

    await shot(page, 'lender-tamper-flag-real-tampered-pdf');
  });
});
