import { test, expect, Page, Locator } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * ============================================================================
 * INVOICE TRUST LEDGER — FULL LIFECYCLE VIDEO EVIDENCE (UI)
 * ============================================================================
 * One continuous test = one continuous video of the entire flow:
 *
 *   1. Supplier uploads PDF  -> Gemini OCR autofills the form   (slide 11)
 *   2. Supplier registers    -> REGISTERED on the ledger        (slide 10)
 *   3. Payer approves        -> APPROVED
 *   4. Second lender (OtherBank) opens its console while the
 *      invoice is still APPROVED (fund button live)             <- the race
 *   5. Lloyds funds          -> FINANCED (+ masked a/c, risk grade)
 *   6. OtherBank clicks its stale Fund button ->
 *      RED BANNER: "DUPLICATE FINANCING BLOCKED … another
 *      financial institution" (competitor never named)          <- KILL SHOT
 *   7. Audit trail modal     -> immutable history with real txIds
 *   8. Fake resubmission: same invoice number re-registered with
 *      a different amount -> REJECTED at registration:
 *      "DUPLICATE INVOICE BLOCKED … Possible tampered or fake invoice."
 *   9. Negative: the full bank account number never renders
 *
 * REPEATABILITY: the chaincode permanently blocks re-registering an invoice
 * number (per supplier). So after asserting the OCR extracted the PDF's real
 * values, we override the invoice number with a unique per-run value BEFORE
 * registering. OCR evidence preserved, suite re-runnable.
 *
 * QUOTA: exactly ONE Gemini call per run (the PDF upload). Free tier on
 * gemini-2.5-flash = 10/min, ~250/day. Do not loop this test rapidly.
 *
 * [ADAPT] markers: Login/Supplier/Payer views were AI-generated in this repo,
 * so a few selectors are best-effort. If a step fails on a selector, open the
 * matching portal/src/*.jsx and align the locator — see CLAUDE-CODE-TASK.md.
 * ============================================================================
 */

const PDF = path.join(__dirname, '..', 'fixtures', 'invoice-clean-INV-2026-007.pdf');
const EVIDENCE = path.join(__dirname, '..', 'evidence');
const RUN = Date.now();
const INV_NO = `INV-E2E-${RUN}`; // unique per run -> repeatable suite

// Values baked into the fixture PDF (what Gemini must extract)
const PDF_INVOICE_NO = /INV-2026-007/i;
const PDF_AMOUNT = /500000|5,?00,?000/;

const FULL_BANK_ACCOUNT = '004512349876'; // must NEVER appear for payer/lender
const MASKED_BANK = '••••9876';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let shotIndex = 0;
async function shot(page: Page, name: string) {
  shotIndex += 1;
  const file = path.join(EVIDENCE, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
}

/** Login screen has four role cards (Supplier · Payer · Lloyds Bank · OtherBank NBFC).
 *  Reconciled against Login.jsx: a role card only PRE-FILLS the username — real
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
  // [ADAPT] App.jsx was specced with a logout button.
  await page.getByRole('button', { name: /log ?out|sign ?out/i }).first().click();
}

/** Resilient form-field lookup: label -> name attr -> placeholder. */
function field(page: Page, label: RegExp, name: string): Locator {
  return page
    .getByLabel(label)
    .or(page.locator(`input[name="${name}"], select[name="${name}"], textarea[name="${name}"]`))
    .or(page.getByPlaceholder(label))
    .first();
}

/** fill() for inputs, selectOption() for selects. */
async function fillSmart(loc: Locator, value: string) {
  const tag = await loc.evaluate((el) => el.tagName);
  if (tag === 'SELECT') await loc.selectOption(value).catch(() => loc.selectOption({ label: value }));
  else await loc.fill(value);
}

/** Read ledger state through the API so UI assertions never race the chain.
 *  Token is cached: this runs inside expect.poll loops, and logging in every
 *  iteration trips the API's /auth/login rate limit (20/min). */
let apiToken: string | null = null;
async function apiState(requestFetch: typeof fetch, invNo: string) {
  if (!apiToken) {
    const login = await requestFetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lloyds', password: 'demo123' }),
    }).then((r) => r.json());
    apiToken = login.token;
  }
  const all = await requestFetch('http://localhost:3000/invoices', {
    headers: { Authorization: `Bearer ${apiToken}` },
  }).then((r) => r.json());
  if (!Array.isArray(all)) { apiToken = null; return []; } // bad/expired token: retry next poll
  return (all as any[]).filter((i) => i.invoiceNumber === invNo);
}

// ---------------------------------------------------------------------------

test('full invoice lifecycle: OCR → register → approve → fund → DUPLICATE BLOCKED → audit trail → fake resubmission blocked', async ({ page, browser }, testInfo) => {

  // =========================================================================
  await test.step('1. SUPPLIER: upload PDF -> Gemini OCR autofills the form', async () => {
    await loginAs(page, /supplier|sri lakshmi/i);

    await page.setInputFiles('input[type="file"]', PDF);

    // The OCR proof: fields fill themselves from the document (allow Gemini latency).
    const invNoField = field(page, /invoice ?number/i, 'invoiceNumber');
    await expect(invNoField, 'Gemini should extract the invoice number from the PDF')
      .toHaveValue(PDF_INVOICE_NO, { timeout: 60_000 });
    await expect(field(page, /amount/i, 'amount'),
      'Gemini should extract the amount from the PDF')
      .toHaveValue(PDF_AMOUNT);

    await shot(page, 'supplier-ocr-autofill');

    // Make the run repeatable: unique invoice number, everything else as extracted.
    await invNoField.fill(INV_NO);

    // [ADAPT] safety net if OCR left a field blank in this run
    const due = field(page, /due ?date/i, 'dueDate');
    if (!(await due.inputValue().catch(() => ''))) await fillSmart(due, '2026-08-30');
  });

  // =========================================================================
  await test.step('2. SUPPLIER: register -> REGISTERED with on-chain docHash', async () => {
    await page.getByRole('button', { name: /register/i }).click();

    // New invoice appears in "my invoices" (blockchain write ~2-3s).
    await expect(page.getByText(INV_NO).first()).toBeVisible({ timeout: 30_000 });

    // Deterministic ledger check via API (state + real SHA-256 docHash).
    const [inv] = await apiState(fetch, INV_NO);
    expect(inv, 'invoice must exist on the ledger').toBeTruthy();
    expect(inv.status).toBe('REGISTERED');
    expect(inv.docHash, 'PDF SHA-256 must be anchored on-chain').toMatch(/^[0-9a-f]{64}$/);
    testInfo.annotations.push({ type: 'docHash', description: inv.docHash });

    await shot(page, 'supplier-registered');
  });

  // =========================================================================
  await test.step('3. PAYER: approve -> APPROVED', async () => {
    await logout(page);
    await loginAs(page, /payer|bigretail/i);

    // Reconciled against PayerView.jsx: pending REGISTERED invoices are table
    // rows, each with its own Approve button. Other REGISTERED invoices may
    // coexist (e.g. the API suite's), so scope strictly to our row.
    const row = page.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: /approve/i }).click();

    await expect
      .poll(async () => (await apiState(fetch, INV_NO))[0]?.status, {
        timeout: 30_000, message: 'ledger status should become APPROVED',
      })
      .toBe('APPROVED');

    await shot(page, 'payer-approved');
  });

  // =========================================================================
  // 4. Open OtherBank's console NOW, while the invoice is APPROVED, so its
  //    Fund button is live. This is the honest fraud scenario: two lenders
  //    looking at the same approved invoice at the same time.
  // =========================================================================
  const otherCtx = await browser.newContext({
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: testInfo.outputPath('otherbank-video'), size: { width: 1280, height: 800 } },
  });
  const otherPage = await otherCtx.newPage();

  await test.step('4. SECOND LENDER (OtherBank): console open, Fund button live', async () => {
    await loginAs(otherPage, /other ?bank/i);
    const otherRow = otherPage.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(otherRow).toBeVisible({ timeout: 15_000 });
    await expect(otherRow.getByRole('button', { name: /fund invoice/i }),
      'OtherBank sees an APPROVED, fundable invoice — the fraud window is open')
      .toBeEnabled();
  });

  // =========================================================================
  await test.step('5. LLOYDS: verify risk + masking, then fund -> FINANCED', async () => {
    await logout(page);
    await loginAs(page, /lloyds/i);

    const row = page.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Field-level RBAC (slides 19/21): last-4 only, never the full account.
    await expect(row.getByText(MASKED_BANK)).toBeVisible();
    await expect(page.getByText(FULL_BANK_ACCOUNT)).toHaveCount(0);

    // Explainable risk grade, ledger-derived (e.g. "A (90)").
    await expect(row.getByText(/[ABC] \(\d+\)/)).toBeVisible();

    await row.getByRole('button', { name: /fund invoice/i }).click();

    await expect
      .poll(async () => (await apiState(fetch, INV_NO))[0]?.status, {
        timeout: 30_000, message: 'ledger status should become FINANCED',
      })
      .toBe('FINANCED');
    const [inv] = await apiState(fetch, INV_NO);
    expect(inv.financedBy).toBe('Lloyds Bank');

    // The refreshed list drops the invoice from the default "Ready to fund"
    // tab; it now lives under "Funded by me" with a disabled Financed-by-you
    // button — only one's OWN financing disables the button.
    await page.getByRole('button', { name: /funded by me/i }).click();
    const fundedRow = page.locator('tr').filter({ hasText: INV_NO }).first();
    await expect(fundedRow).toBeVisible({ timeout: 15_000 });
    await expect(fundedRow.getByRole('button', { name: /financed by you/i })).toBeDisabled();

    await shot(page, 'lloyds-financed');
  });

  // =========================================================================
  await test.step('6. KILL SHOT: OtherBank clicks its stale Fund -> LEDGER REJECTS', async () => {
    const otherRow = otherPage.locator('tr').filter({ hasText: INV_NO }).first();
    await otherRow.getByRole('button', { name: /fund invoice/i }).click();

    // The chaincode's own rejection, rendered in the red banner (LenderView.jsx).
    await expect(otherPage.getByText(/LEDGER REJECTED THIS TRANSACTION/i))
      .toBeVisible({ timeout: 30_000 });
    await expect(otherPage.getByText(/DUPLICATE FINANCING BLOCKED/i)).toBeVisible();
    // Lender anonymity: OtherBank is told an institution financed it — never WHICH.
    await expect(otherPage.getByText(/another financial institution/i)).toBeVisible();
    await expect(otherPage.getByText(/Lloyds/)).toHaveCount(0);

    await shot(otherPage, 'KILL-SHOT-duplicate-financing-blocked');
  });

  // Flush + keep OtherBank's video as a named evidence artefact.
  const otherVideo = otherPage.video();
  await otherCtx.close();
  if (otherVideo) {
    const src = await otherVideo.path();
    fs.copyFileSync(src, path.join(EVIDENCE, 'otherbank-kill-shot.webm'));
  }

  // =========================================================================
  await test.step('7. AUDIT TRAIL: immutable history with real blockchain txIds', async () => {
    const row = page.locator('tr').filter({ hasText: INV_NO }).first();
    await row.getByRole('button', { name: /audit trail/i }).click();

    await expect(page.getByText(/On-chain audit trail/i)).toBeVisible();
    for (const status of [/REGISTERED/, /APPROVED/, /FINANCED/]) {
      await expect(page.getByText(status).first()).toBeVisible();
    }
    // Fabric txIds are 64 hex chars ("tx <id>" in AuditTrail.jsx); mock uses tx-<hex>.
    await expect(page.getByText(/tx (tx-|mock-)?[0-9a-f]{12,}/i).first()).toBeVisible();

    await shot(page, 'audit-trail-immutable-history');
    await page.getByRole('button', { name: /close/i }).click();
  });

  // =========================================================================
  await test.step('8. FAKE RESUBMISSION: same number, different amount -> BLOCKED at registration', async () => {
    // No Gemini call here — manual fields, zero quota cost.
    await logout(page);
    await loginAs(page, /supplier|sri lakshmi/i);

    await field(page, /invoice ?number/i, 'invoiceNumber').fill(INV_NO); // SAME number
    await fillSmart(field(page, /payer/i, 'payerName'), 'BigRetail Ltd');
    await field(page, /amount/i, 'amount').fill('750000');               // DIFFERENT amount
    await fillSmart(field(page, /currency/i, 'currency'), 'INR');
    await fillSmart(field(page, /due ?date/i, 'dueDate'), '2026-09-15');
    await page.getByRole('button', { name: /register/i }).click();

    // The ledger's own rejection, rendered in the supplier's red banner.
    await expect(page.getByText(/LEDGER REJECTED THIS TRANSACTION/i))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/DUPLICATE INVOICE BLOCKED/i)).toBeVisible();
    await expect(page.getByText(/Possible tampered or fake invoice/i)).toBeVisible();
    await shot(page, 'supplier-duplicate-invoice-blocked');

    // The resubmission never landed: still exactly one invoice for this number.
    expect((await apiState(fetch, INV_NO)).length).toBe(1);

    // The lender never even sees a second row for the number (All tab shows
    // everything, including invoices financed by others). Match the INVOICE-
    // NUMBER cell (first column), not whole-row text: other rows may quote
    // INV_NO inside their similar-invoice risk reasons (same-document flag).
    await logout(page);
    await loginAs(page, /lloyds/i);
    await page.getByRole('button', { name: /^All \(/ }).click();
    await expect(page.locator('tr td:first-child').filter({ hasText: INV_NO })).toHaveCount(1);
  });

  // =========================================================================
  await test.step('9. NEGATIVE: full bank account number never rendered to lender', async () => {
    await expect(page.getByText(FULL_BANK_ACCOUNT)).toHaveCount(0);
  });
});
