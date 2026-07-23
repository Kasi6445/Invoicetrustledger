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
 *   R2. DUPLICATE INVOICE BLOCKED — upload invoice-clean-INV-2026-007
 *       and register it UNCHANGED. Whatever the ledger's prior state, this
 *       test always ends at the same place: the ledger refusing a second
 *       registration of the number, on screen.
 *
 *   R3. TAMPERED RESUBMISSION — upload the TAMPERED twin (same number,
 *       ₹7,50,000). The invoice number is single-use per supplier, so the
 *       resubmission is REJECTED at registration ("DUPLICATE INVOICE
 *       BLOCKED … Possible tampered or fake invoice.") and the lender
 *       never sees a ₹7,50,000 row for the number.
 *
 *   R4. SIMILAR-INVOICE FLAG — the workaround for R2/R3 is re-registering
 *       the SAME PDF under a NEW invoice number. That registers (different
 *       numbers are never blocked — recurring billing is legitimate), but
 *       the read-time document-hash match flags it: −25 risk points, the
 *       twin number named in the reasons, and the ⚠ similar chip on the
 *       lender row.
 *
 * STATE-TOLERANT DESIGN: R2 checks the ledger via API *before* acting and
 * branches: number absent -> register succeeds first, then the duplicate
 * attempt is blocked; number already present (any amount — e.g. a previous
 * run of this suite) -> the very first attempt is blocked. Both branches
 * capture the same evidence. The suite is green forever.
 *
 * GEMINI QUOTA: up to 6 /ai/extract calls in this file (007 once or twice,
 * tampered once, 014 three times — R1 plus both R4 uploads). Free tier =
 * 10/min. Do not loop this spec.
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
  const onScreen = page.getByText(/DUPLICATE INVOICE BLOCKED/i).first();
  try {
    await expect(onScreen).toBeVisible({ timeout: 20_000 });
  } catch {
    expect(dialogs.last(), 'rejection should surface as text or alert dialog')
      .toMatch(/DUPLICATE INVOICE BLOCKED/i);
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

// Any registration of the number, regardless of amount — the uniqueness key.
async function ledgerFindByNumber(invoiceNumber: string) {
  const token = await lenderToken();
  const all: any[] = await fetch('http://localhost:3000/invoices', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((x) => x.json());
  if (!Array.isArray(all)) { cachedToken = null; return []; }
  return all.filter((i) => i.invoiceNumber === invoiceNumber);
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

  test('R2 — the real INV-2026-007 PDF: duplicate invoice number BLOCKED by the ledger', async ({ page }) => {
    const dialogs = armDialogCapture(page);
    const fileHash = sha256(PDF_007);
    // Any prior amount blocks: uniqueness keys on the NUMBER, not the fingerprint.
    const preExisting = (await ledgerFindByNumber('INV-2026-007')).length > 0;

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
    await shot(page, 'duplicate-invoice-blocked-real-pdf');

    // The rule held: exactly ONE registration of this number exists, ever.
    const matches = await ledgerFindByNumber('INV-2026-007');
    expect(matches.length, 'an invoice number registers at most once per supplier').toBe(1);

    // Hash proof (strict when this run created it; informational if pre-existing,
    // since an earlier manual registration may have attached no/another file).
    fs.appendFileSync(HASH_PROOF,
      `invoice-clean-INV-2026-007.pdf\n  sha256(file) = ${fileHash}\n` +
      `  docHash on-chain (${matches[0].invoiceId}) = ${matches[0].docHash}\n` +
      `  MATCH: ${matches[0].docHash === fileHash ? 'YES' : 'no (pre-existing registration)'}\n\n`);
    if (!preExisting) expect(matches[0].docHash).toBe(fileHash);
  });

  test('R3 — the TAMPERED twin (₹7.5L, same number): REJECTED at registration', async ({ page }) => {
    const dialogs = armDialogCapture(page);
    // Serial mode: R2 has just guaranteed the number is on the ledger.
    const before = await ledgerFindByNumber('INV-2026-007');
    expect(before.length, 'R2 must have left INV-2026-007 on the ledger').toBeGreaterThan(0);

    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadAndAwaitOcr(page, PDF_TAMPERED, /INV-2026-007/i, /750000|7,?50,?000/);
    await shot(page, 'tampered-pdf-ocr-inflated-amount');
    await page.getByRole('button', { name: /register/i }).click();

    // The single-use rule fires: the tampered resubmission never lands.
    await expectDuplicateBlocked(page, dialogs);
    if (Number(before[0].amount) !== 750000) {
      await expect(page.getByText(/Possible tampered or fake invoice/i).first()).toBeVisible();
    }
    await shot(page, 'supplier-tampered-resubmission-blocked');

    // Ledger unchanged: no new registration of this number was created.
    expect((await ledgerFindByNumber('INV-2026-007')).length).toBe(before.length);

    // The lender never even sees a ₹7,50,000 row for the number ("All" shows
    // every invoice, including those financed by others).
    await logout(page);
    await loginAs(page, /lloyds/i);
    await page.getByRole('button', { name: /^All \(/ }).click();
    await expect(page.locator('tr').filter({ hasText: 'INV-2026-007' }).first())
      .toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tr')
      .filter({ hasText: 'INV-2026-007' })
      .filter({ hasText: /7,?50,?000/ })).toHaveCount(0);

    await shot(page, 'lender-sees-no-tampered-row');
  });

  test('R4 — SAME PDF under a NEW number: registers, but flagged as similar', async ({ page }) => {
    const twinA = `INV-014-TWIN-${RUN}-A`;
    const twinB = `INV-014-TWIN-${RUN}-B`;

    // First upload of the document under a fresh number — registers fine.
    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadAndAwaitOcr(page, PDF_014, /INV-2026-014/i, /325000|3,?25,?000/);
    await field(page, /invoice ?number/i, 'invoiceNumber').fill(twinA);
    await page.getByRole('button', { name: /register/i }).click();
    await expect
      .poll(async () => (await ledgerFindByNumber(twinA)).length, { timeout: 30_000 })
      .toBe(1);

    // Second upload of the IDENTICAL PDF under another fresh number. The
    // number rule cannot fire (new number) — the similarity flag is the net.
    await page.reload();
    await loginAs(page, /supplier|sri lakshmi/i);
    await uploadAndAwaitOcr(page, PDF_014, /INV-2026-014/i, /325000|3,?25,?000/);
    await field(page, /invoice ?number/i, 'invoiceNumber').fill(twinB);
    await page.getByRole('button', { name: /register/i }).click();
    await expect
      .poll(async () => (await ledgerFindByNumber(twinB)).length, { timeout: 30_000 })
      .toBe(1);
    await shot(page, 'same-pdf-new-number-registered');

    // API truth: strong flag present, −25 applied, twin named in the reasons.
    const [twin] = await ledgerFindByNumber(twinB);
    expect(twin.risk.similar?.sameDocument, 'document-hash match must name the twin')
      .toContain(twinA);
    expect(twin.risk.reasons.join(' | ')).toMatch(/Same document already registered .* re-numbered resubmission \(−25\)/);

    // Lender console: the amber ⚠ similar chip on the flagged row. Scope to
    // twinB's INVOICE-NUMBER cell (first column) — twinA's row also quotes
    // twinB inside its (symmetric) same-document risk reason.
    await logout(page);
    await loginAs(page, /lloyds/i);
    await page.getByRole('button', { name: /^All \(/ }).click();
    const row = page.locator('tr', { has: page.locator('td:first-child', { hasText: twinB }) });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row.locator('div.similar'), 'flagged row must carry the ⚠ similar chip')
      .toBeVisible();

    await shot(page, 'lender-similar-flag-same-document');
  });
});
