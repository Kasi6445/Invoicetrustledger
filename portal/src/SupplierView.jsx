import { useEffect, useState } from 'react';
import { listInvoices, registerInvoice, aiExtract, getHistory, applyToLender, cancelInvoice } from './api';
import AuditTrail from './AuditTrail';

// The funders this supplier can offer an invoice to. `name` is byte-identical to the
// displayName in users.js so an application compares directly against the ledger's
// financedBy; `short` is display only — the full name rides along as the tooltip.
// A dropdown, not one control per bank: this list is expected to grow to many funders,
// so the register form scales by selection, never by adding UI per lender.
const LENDERS = [
  { name: 'Lloyds Bank Commercial Banking', short: 'Lloyds' },
  { name: 'Meridian Invoice Finance Ltd',   short: 'Meridian' },
];
const shortName = name => (LENDERS.find(l => l.name === name) || {}).short || name;

// Statuses a supplier may still withdraw from. Mirrors the ledger's own guard —
// FINANCED / SETTLED / CANCELLED are refused there regardless of what the UI shows.
const CANCELLABLE = ['REGISTERED', 'APPROVED', 'DISPUTED'];

// Status filters for the My-invoices list — the KPI stat cards and the filter bar
// both drive these. Their counts line up with the stat-card numbers by design.
const INV_FILTERS = {
  all:      { label: 'All',              match: () => true },
  financed: { label: 'Financed',         match: i => ['FINANCED', 'SETTLED'].includes(i.status) },
  awaiting: { label: 'Awaiting finance', match: i => ['REGISTERED', 'APPROVED'].includes(i.status) },
};

const EMPTY = {
  invoiceNumber: '', payerName: '', amount: '', requestedAmount: '',
  currency: 'GBP', invoiceDate: '', dueDate: '', goodsDescription: ''
};

// Formats the invoice-copy OCR will accept. Mirrors the API's multer whitelist so a
// wrong-format file is caught before it leaves the browser.
const ACCEPTED_UPLOAD = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

// UK currency formatting: en-GB, GBP, e.g. £250,000.00
const gbp = (v, currency = 'GBP') =>
  Number(v).toLocaleString('en-GB', { style: 'currency', currency: currency || 'GBP' });
const NO_FILES = { invoiceCopy: null, purchaseOrder: null, goodsReceived: null };

export default function SupplierView({ me }) {
  const [fields, setFields] = useState(EMPTY);
  const [files, setFiles] = useState(NO_FILES);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState(null);
  const [uploadErr, setUploadErr] = useState(null);   // red popup: bad format / not-an-invoice
  // Which fields OCR actually read (non-empty) on a GENUINE extraction — those lock to
  // read-only. Anything OCR left blank, or a failed/fallback extraction, stays editable
  // so the supplier can type it by hand (the documented "AI can't read it" path).
  const [ocrLocked, setOcrLocked] = useState({});
  const isLocked = (k) => Boolean(ocrLocked[k]);
  const [result, setResult] = useState(null);   // { ok, message }
  const [invoices, setInvoices] = useState([]);
  const [trail, setTrail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lenders, setLenders] = useState([]);   // funders chosen on the register form
  const [tab, setTab] = useState('register');   // left-pane view: 'register' | 'invoices'
  const [invFilter, setInvFilter] = useState('all');   // My-invoices status filter

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));
  const setDoc = (k, f) => setFiles(prev => ({ ...prev, [k]: f }));
  // Supporting docs (PO / Other): reject a wrong-format file with the red popup.
  const chooseDoc = (k, f) => {
    if (f && !ACCEPTED_UPLOAD.includes(f.type)) {
      setUploadErr(`"${f.name}" is not a supported format. Please upload a PDF, PNG or JPG.`);
      return;
    }
    setDoc(k, f);
  };

  // Client-side guard only — the chaincode is the real enforcer (FINANCING
  // REQUEST REJECTED). This just gives immediate feedback before a round-trip.
  const amt = Number(fields.amount);
  const req = Number(fields.requestedAmount);
  // Financing cap: advance may not exceed 90% of face value. The API enforces this too
  // (fast-fail before the ledger); here it clamps the input so the user can't exceed it.
  const cap90 = amt > 0 ? Math.floor(0.9 * amt) : 0;
  const requestedTooHigh =
    fields.requestedAmount !== '' && fields.amount !== '' &&
    Number.isFinite(amt) && Number.isFinite(req) && req > cap90;
  // Editable financing input — clamp anything over 90% of the face value down to the cap.
  function setRequested(v) {
    if (v === '') return set('requestedAmount', '');
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    set('requestedAmount', String(amt > 0 && n > cap90 ? cap90 : n));
  }

  // Only the INVOICE COPY drives OCR. The PO and any other documents are
  // attached as-is (no extraction).
  async function onInvoiceCopy(f) {
    setAiNote(null); setResult(null); setUploadErr(null);
    if (!f) { setDoc('invoiceCopy', null); return; }

    // Wrong format never leaves the browser — warn in red immediately and keep the
    // form empty. The register fields stay read-only, so nothing to clean up beyond this.
    if (!ACCEPTED_UPLOAD.includes(f.type)) {
      setDoc('invoiceCopy', null);
      setUploadErr(`"${f.name}" is not a supported format. Please upload the invoice as a PDF, PNG or JPG.`);
      return;
    }

    setDoc('invoiceCopy', f);
    setAiBusy(true);
    try {
      const x = await aiExtract(f);
      // Fill from the document — replace (don't merge) so a re-upload never leaves stale
      // values behind. requestedAmount is the one field the supplier owns.
      const vals = {
        invoiceNumber: x.invoiceNumber || '',
        payerName: x.payerName || '',
        amount: x.amount || '',
        // currency stays pinned to GBP (OCR reads the "£" glyph, not the ISO code).
        invoiceDate: x.invoiceDate || '',
        dueDate: x.dueDate || '',
        goodsDescription: x.goodsDescription || '',
      };
      setFields(prev => ({ ...EMPTY, requestedAmount: prev.requestedAmount, ...vals }));
      // Lock ONLY on a genuine read (not the labelled `simulated` fallback), and ONLY the
      // fields OCR actually returned. Blank fields — or a fallback — stay editable to type.
      const locked = {};
      if (!x.simulated) {
        for (const k of Object.keys(vals)) if (String(vals[k]).trim() !== '') locked[k] = true;
      }
      setOcrLocked(locked);
      setAiNote(x.simulated
        ? (x.note || 'The AI could not read this document — please enter the invoice details below.')
        : 'Fields read from the invoice copy by Gemini — review and register.');
    } catch (e) {
      const status = e.response?.status;
      if (status === 415 || status === 422) {
        // Wrong format / not an invoice → hard reject: red popup, detach the file.
        setDoc('invoiceCopy', null);
        setFields(prev => ({ ...EMPTY, requestedAmount: prev.requestedAmount }));
        setOcrLocked({});
        setUploadErr(e.response?.data?.error ||
          'This file could not be used as an invoice. Please upload a valid PDF, PNG or JPG invoice.');
      } else {
        // OCR service failure (network/5xx): keep the file, leave every field EDITABLE so
        // the supplier can type the invoice by hand — the documented fallback.
        setFields(prev => ({ ...EMPTY, requestedAmount: prev.requestedAmount }));
        setOcrLocked({});
        setAiNote('The AI service is unavailable — please enter the invoice details below by hand.');
      }
    } finally { setAiBusy(false); }
  }

  // Register, then submit the invoice to each funder chosen on the form. The
  // applications are a separate app-layer step (no ledger write) — so a failure to
  // reach one funder never unwinds a registration that the ledger has already accepted.
  async function register() {
    if (requestedTooHigh) return;   // inline message already shown; ledger would reject anyway
    setResult(null);
    setBusy(true);
    try {
      const inv = await registerInvoice(fields, files);
      let note = '';
      if (lenders.length) {
        const failed = [];
        for (const l of lenders) {
          try { await applyToLender(inv.invoiceId, l); }
          catch (e) { failed.push(`${shortName(l)} (${e.response?.data?.error || e.message})`); }
        }
        const sent = lenders.filter(l => !failed.some(f => f.startsWith(shortName(l))));
        if (sent.length) note += ` Submitted to ${sent.map(shortName).join(' and ')}.`;
        if (failed.length) note += ` Could not submit to ${failed.join('; ')}.`;
      }
      setResult({ ok: true, message: `Registered as ${inv.invoiceId} — status ${inv.status}. Document hash anchored on-chain.${note}` });
      setFields(EMPTY); setFiles(NO_FILES); setLenders([]);
      setTab('invoices'); setInvFilter('all');   // jump to the list (unfiltered) so the new invoice is in view
      refresh();
    } catch (e) {
      setResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  // Withdraw a submission made in error. The reason is required — it is written to
  // the ledger alongside the CANCELLED status, so the withdrawal is itself auditable.
  async function cancelWithReason(id, number) {
    const reason = window.prompt(`Cancel ${number}? This is recorded on the ledger. Reason (required):`, '');
    if (reason === null) return;                        // cancelled the cancel
    if (!reason.trim()) { setResult({ ok: false, message: 'A cancellation reason is required.' }); return; }
    setResult(null); setBusy(true);
    try {
      const inv = await cancelInvoice(id, reason.trim());
      setResult({ ok: true, message: `${inv.invoiceNumber} cancelled — the number is free to register again. The cancelled record stays on the ledger.` });
      refresh();
    } catch (e) {
      setResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  const mine = invoices.filter(i => i.supplierCRN === me.supplierCRN);
  const shownInvoices = mine.filter(INV_FILTERS[invFilter].match);
  const canSubmit = !busy && fields.invoiceNumber && fields.amount && fields.requestedAmount
    && files.invoiceCopy && !requestedTooHigh;

  // Portfolio summary for the header KPI band — a glanceable read of everything this
  // supplier has on the ledger, recomputed on every refresh.
  const stats = {
    total: mine.length,
    requested: mine.reduce((s, i) => s + (Number(i.requestedAmount) || 0), 0),
    financed: mine.filter(i => ['FINANCED', 'SETTLED'].includes(i.status)).length,
    awaiting: mine.filter(i => ['REGISTERED', 'APPROVED'].includes(i.status)).length,
  };
  // Live advance ratio driving the financing meter (advance ÷ face value).
  const ratio = amt > 0 && req > 0 ? req / amt : 0;
  const showMeter = fields.amount !== '' && fields.requestedAmount !== '' && amt > 0 && req > 0;

  return (
    <div className="supplier-view">
      {/* Portfolio summary — a glanceable read of everything this supplier has on the ledger */}
      <section className="sv-hero">
        <div className="sv-hero-head">
          <div>
            <h2>Supplier console</h2>
            <p>{me.displayName} — register invoices and track financing in real time.</p>
          </div>
        </div>
        <div className="sv-stats">
          <button type="button" className={`stat${tab === 'invoices' && invFilter === 'all' ? ' active' : ''}`}
                  onClick={() => { setTab('invoices'); setInvFilter('all'); }}>
            <span className="stat-val">{stats.total}</span>
            <span className="stat-lab">Invoices registered</span>
          </button>
          <button type="button" className={`stat${tab === 'invoices' && invFilter === 'awaiting' ? ' active' : ''}`}
                  onClick={() => { setTab('invoices'); setInvFilter('awaiting'); }}>
            <span className="stat-val">{stats.awaiting}</span>
            <span className="stat-lab">Awaiting finance</span>
          </button>
          <button type="button" className={`stat${tab === 'invoices' && invFilter === 'financed' ? ' active' : ''}`}
                  onClick={() => { setTab('invoices'); setInvFilter('financed'); }}>
            <span className="stat-val">{stats.financed}</span>
            <span className="stat-lab">Financed</span>
          </button>
          <div className="stat">
            <span className="stat-val">{gbp(stats.requested)}</span>
            <span className="stat-lab">Financing requested</span>
          </div>
        </div>
      </section>

      <div className="sv-layout">
        {/* Left pane — Register is the one destination not reachable from a stat card
            (the invoice list is opened by clicking any of the KPI cards above). */}
        <nav className="sv-nav" aria-label="Supplier sections">
          <button type="button" className={`sv-nav-item${tab === 'register' ? ' active' : ''}`}
                  onClick={() => setTab('register')}>
            <span className="sv-nav-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sv-nav-txt">
              <span className="sv-nav-title">Register</span>
              <span className="sv-nav-sub">New invoice</span>
            </span>
          </button>
        </nav>

        <div className="sv-content">
          {result && (result.ok
            ? <div className="notice-ok">✓ {result.message}</div>
            : <div className="rejected">
                <div className="headline">⛔ Ledger rejected this transaction</div>
                <div className="ledger-says">{result.message}</div>
              </div>)}

          {tab === 'register' && (
          <div className="card card-lift">
            <div className="pane-head">
              <h3>Register a new invoice</h3>
              <p>Upload the invoice copy — AI reads the details, you review and submit to the ledger.</p>
            </div>
        <label className="dropzone">
          <span className="dz-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 15V4m0 0L8.5 7.5M12 4l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 14.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <span className="dz-body">
            <span className="dz-title"><span className="ai-tag">AI</span> Upload the invoice copy</span>
            <span className="dz-hint">PDF, PNG or JPG — the fields below fill themselves from the document.</span>
          </span>
          <input type="file" accept=".pdf,image/*"
                 onChange={e => onInvoiceCopy(e.target.files[0] || null)} />
          {aiBusy
            ? <span className="dz-status reading">Reading document…</span>
            : files.invoiceCopy
              ? <span className="dz-status done" title={files.invoiceCopy.name}>✓ {files.invoiceCopy.name}</span>
              : null}
        </label>
        {aiNote && <p className="ai-note">{aiNote}</p>}

        <div className="form-section-label">Invoice details</div>
        <div className="formgrid">
          {/* System-filled, never typed: the invoice number is whatever OCR read off
              the uploaded copy, so the registered number always matches the anchored
              document. A supplier cannot re-key it to dodge the one-number-one-
              registration rule — and if it is wrong, the fix is a corrected document
              (or Cancel request, which frees the number again). */}
          {/* OCR-sourced fields lock to read-only ONLY when OCR read them; if OCR failed
              or left a field blank it stays editable so the supplier can type it. */}
          <label className="f"><span>Invoice number</span>
            <input type="text" value={fields.invoiceNumber} readOnly={isLocked('invoiceNumber')}
                   placeholder={isLocked('invoiceNumber') ? '' : 'From invoice, or type it'}
                   title={isLocked('invoiceNumber') ? 'Read from the invoice copy' : 'Type it if the AI could not read the document'}
                   onChange={e => set('invoiceNumber', e.target.value)} /></label>
          <label className="f"><span>Payer</span>
            <input type="text" value={fields.payerName} readOnly={isLocked('payerName')}
                   placeholder={isLocked('payerName') ? '' : 'From invoice, or type it'}
                   onChange={e => set('payerName', e.target.value)} /></label>
          <label className="f"><span>Invoice amount (face value)</span>
            <input type="number" value={fields.amount} readOnly={isLocked('amount')}
                   placeholder={isLocked('amount') ? '' : 'From invoice, or type it'}
                   onChange={e => set('amount', e.target.value)} /></label>
          {/* The ONE field the supplier always owns — clamped to 90% of the face value. */}
          <label className="f"><span>Financing requested</span>
            <input type="number" value={fields.requestedAmount} max={cap90 || undefined}
                   placeholder="Enter amount to finance"
                   style={requestedTooHigh ? { borderColor: 'var(--red)' } : undefined}
                   onChange={e => setRequested(e.target.value)} /></label>
          <label className="f"><span>Currency</span>
            <input type="text" value={fields.currency} readOnly title="Sterling-only ledger" /></label>
          <label className="f"><span>Invoice date</span>
            <input type="date" value={fields.invoiceDate} readOnly={isLocked('invoiceDate')}
                   onChange={e => set('invoiceDate', e.target.value)} /></label>
          <label className="f"><span>Due date</span>
            <input type="date" value={fields.dueDate} readOnly={isLocked('dueDate')}
                   onChange={e => set('dueDate', e.target.value)} /></label>
        </div>

        {/* Slider convenience for the advance — capped at 90% of face value, so it can
            never exceed the limit; the numeric field above stays the precise input. */}
        {amt > 0 && (
          <div className="finance-slider">
            <input type="range" min={0} max={cap90} step={Math.max(1, Math.round(cap90 / 100)) || 1}
                   value={Math.min(Number(fields.requestedAmount) || 0, cap90)}
                   aria-label="Advance amount"
                   onChange={e => setRequested(e.target.value)} />
            <div className="finance-slider-foot">
              <span>Drag to set the advance</span>
              <span>Cap {gbp(cap90, fields.currency)} · 90% of face value</span>
            </div>
          </div>
        )}

        {showMeter && (
          <div className={`advance-meter${requestedTooHigh ? ' over' : ''}`}>
            <div className="advance-meter-top">
              <span>Advance requested</span>
              <strong>{Math.round(ratio * 100)}% of face value</strong>
            </div>
            <div className="advance-track">
              <div className="advance-fill" style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
              <span className="advance-cap" title="Financing cap — 90% of face value" />
            </div>
            <div className="advance-meter-foot">
              <span>{gbp(req, fields.currency)} of {gbp(amt, fields.currency)}</span>
              <span className="cap-label">Cap 90%</span>
            </div>
          </div>
        )}

        {requestedTooHigh && (
          <p style={{ fontSize: 13, color: 'var(--red)', margin: '8px 0 0' }}>
            Financing requested ({gbp(fields.requestedAmount, fields.currency)}) cannot exceed
            90% of the invoice face value ({gbp(0.9 * amt, fields.currency)}).
          </p>
        )}

        <label className="f" style={{ marginTop: 12 }}><span>Goods / services description</span>
          <input type="text" value={fields.goodsDescription} readOnly={isLocked('goodsDescription')}
                 placeholder={isLocked('goodsDescription') ? '' : 'From invoice, or type it'}
                 onChange={e => set('goodsDescription', e.target.value)} /></label>

        <div className="form-section-label">Funding request</div>
        {/* Pick the funders here, at registration. The dropdown only ever lists what is
            not already chosen, so it scales to any number of banks; the picks below are
            an app-layer application each — the ledger sees one invoice, once. */}
        <label className="f">
          <span>Submit financing request to</span>
          <select value="" disabled={busy || lenders.length === LENDERS.length}
                  onChange={e => { if (e.target.value) setLenders(ls => [...ls, e.target.value]); }}>
            <option value="">
              {lenders.length === LENDERS.length ? 'All lenders selected' : 'Choose a lender…'}
            </option>
            {LENDERS.filter(l => !lenders.includes(l.name))
                    .map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </label>
        <div className="chiprow" style={{ marginTop: 8 }}>
          {lenders.length === 0
            ? <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                No lender selected — the invoice registers on the ledger but reaches no lender's queue.
              </span>
            : lenders.map(l => (
                <span key={l} className="applied" title={l}>
                  {shortName(l)}
                  <button type="button" className="chip-x" disabled={busy}
                          title={`Remove ${shortName(l)}`}
                          onClick={() => setLenders(ls => ls.filter(x => x !== l))}>×</button>
                </span>
              ))}
        </div>

        <div className="form-section-label">Supporting documents</div>
        <div className="formgrid doc-grid">
          
          <label className={`f doc-tile${files.purchaseOrder ? ' filled' : ''}`}>
            <span>Purchase order {files.purchaseOrder ? '✓' : '(optional)'}</span>
            <input type="file" accept=".pdf,image/*"
                   onChange={e => chooseDoc('purchaseOrder', e.target.files[0] || null)} /></label>
          {/* Label only — the upload key stays `goodsReceived` so the stored hash,
              the API's REGISTER_DOCS whitelist and the doc-viewer route are unchanged.
              Goods receipt is now confirmed by the PAYER at approval, not evidenced here. */}
          <label className={`f doc-tile${files.goodsReceived ? ' filled' : ''}`}>
            <span>Other documents {files.goodsReceived ? '✓' : '(optional)'}</span>
            <input type="file" accept=".pdf,image/*"
                   onChange={e => chooseDoc('goodsReceived', e.target.files[0] || null)} /></label>
        </div>

        <div className="register-actions">
          <button className="btn primary btn-lg" disabled={!canSubmit}
                  onClick={register}>{busy ? 'Registering…' : 'Register on ledger'}</button>
          <span className="register-hint" aria-hidden="true">
            🔒 The document hash is anchored on-chain at registration — tamper-proof from this moment.
          </span>
        </div>
          </div>
          )}

          {tab === 'invoices' && (
          <div className="card card-lift">
            <div className="pane-head">
              <h3>My invoices</h3>
              <p>{me.displayName} · {INV_FILTERS[invFilter].label} · {shownInvoices.length} of {stats.total}</p>
            </div>
        <div className="table-scroll">
        <table>
          <thead><tr><th>Invoice</th><th>Amount</th><th>Requested</th><th>Status</th><th>Submitted to</th><th>Registered</th><th></th></tr></thead>
          <tbody>
            {shownInvoices.length === 0 && <tr><td colSpan="7"><div className="empty-row">{mine.length === 0 ? 'No invoices yet — register your first one above.' : 'No invoices match this filter.'}</div></td></tr>}
            {shownInvoices.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td className="amount">{gbp(inv.amount, inv.currency)}</td>
                <td className="amount">{inv.requestedAmount != null ? gbp(inv.requestedAmount, inv.currency) : '—'}</td>
                <td><span className={`badge ${inv.status}`}>{inv.status}</span>
                  {inv.status === 'DISPUTED' && (
                    <div className="sub" style={{ marginTop: 4, color: 'var(--red)' }}>
                      Payer's reason: {inv.disputeReason || 'none recorded'}
                    </div>)}
                </td>
                {/* Read-only: funders are chosen on the register form, so this column
                    lists only what this invoice was actually submitted to — it never
                    grows a control per bank. */}
                <td style={{ minWidth: 150 }}>
                  {(inv.applications || []).length === 0
                    ? <span className="sub">—</span>
                    : <div className="chiprow">
                        {inv.applications.map(a => (
                          <span key={a.lender} className={`applied applied-${a.status}`}
                                title={`${a.lender} — submitted ${new Date(a.appliedAt).toLocaleString()}`}>
                            {shortName(a.lender)} <span className={`state state-${a.status}`}>{a.status}</span>
                          </span>
                        ))}
                      </div>}
                </td>
                <td className="sub">{new Date(inv.registeredAt).toLocaleString()}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {/* Withdraw a mistaken submission. Hidden once financing has happened —
                      the ledger enforces that too, this only keeps the console honest. */}
                  {CANCELLABLE.includes(inv.status) && (
                    <><button className="btn danger" disabled={busy}
                              onClick={() => cancelWithReason(inv.invoiceId, inv.invoiceNumber)}>Cancel request</button>{' '}</>
                  )}
                  <button className="btn" disabled={busy}
                          onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="sub" style={{ marginBottom: 0, marginTop: 12 }}>
          Lenders are chosen when the invoice is registered. Submitting to a lender is an
          application-layer action — no ledger write — and the same lender cannot be
          submitted to twice for one invoice.
        </p>
          </div>
          )}
        </div>
      </div>

      {uploadErr && (
        <div className="overlay" onClick={() => setUploadErr(null)}>
          <div className="modal alert-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="alert-modal-head">⛔ Upload rejected</div>
            <p className="alert-modal-body">{uploadErr}</p>
            <button className="btn primary" onClick={() => setUploadErr(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {trail && <AuditTrail trail={trail} onClose={() => setTrail(null)} />}
    </div>
  );
}
