import { useEffect, useState } from 'react';
import { listInvoices, registerInvoice, aiExtract, getHistory, applyToLender } from './api';
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

const EMPTY = {
  invoiceNumber: '', payerName: 'Northfield Retail Group plc', amount: '', requestedAmount: '',
  currency: 'GBP', invoiceDate: '', dueDate: '', goodsDescription: ''
};

// UK currency formatting: en-GB, GBP, e.g. £250,000.00
const gbp = (v, currency = 'GBP') =>
  Number(v).toLocaleString('en-GB', { style: 'currency', currency: currency || 'GBP' });
const NO_FILES = { invoiceCopy: null, purchaseOrder: null, goodsReceived: null };

export default function SupplierView({ me }) {
  const [fields, setFields] = useState(EMPTY);
  const [files, setFiles] = useState(NO_FILES);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState(null);
  const [result, setResult] = useState(null);   // { ok, message }
  const [invoices, setInvoices] = useState([]);
  const [trail, setTrail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lenders, setLenders] = useState([]);   // funders chosen on the register form

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));
  const setDoc = (k, f) => setFiles(prev => ({ ...prev, [k]: f }));

  // Client-side guard only — the chaincode is the real enforcer (FINANCING
  // REQUEST REJECTED). This just gives immediate feedback before a round-trip.
  const amt = Number(fields.amount);
  const req = Number(fields.requestedAmount);
  // Financing cap: advance may not exceed 90% of face value (the ledger enforces this;
  // this is the client-side fast-fail so the form catches it before submit).
  const requestedTooHigh =
    fields.requestedAmount !== '' && fields.amount !== '' &&
    Number.isFinite(amt) && Number.isFinite(req) && req > 0.9 * amt;

  // Only the INVOICE COPY drives OCR. The PO and goods-received note are
  // attached as-is (no extraction).
  async function onInvoiceCopy(f) {
    setDoc('invoiceCopy', f); setAiNote(null); setResult(null);
    if (!f) return;
    setAiBusy(true);
    try {
      const x = await aiExtract(f);
      setFields(prev => ({
        ...prev,
        invoiceNumber: x.invoiceNumber || prev.invoiceNumber,
        payerName: x.payerName || prev.payerName,
        amount: x.amount || prev.amount,
        currency: x.currency || prev.currency,
        invoiceDate: x.invoiceDate || prev.invoiceDate,
        dueDate: x.dueDate || prev.dueDate,
        goodsDescription: x.goodsDescription || prev.goodsDescription,
      }));
      setAiNote(x.simulated ? x.note : 'Fields extracted from the invoice copy by Gemini — review and register.');
    } catch (e) {
      setAiNote('AI extraction unavailable: ' + (e.response?.data?.error || e.message));
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
      refresh();
    } catch (e) {
      setResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  const mine = invoices.filter(i => i.supplierCRN === me.supplierCRN);
  const canSubmit = !busy && fields.invoiceNumber && fields.amount && fields.requestedAmount
    && files.invoiceCopy && !requestedTooHigh;

  return (
    <div>
      <p className="eyebrow">Step 1 · Register</p>
      <div className="card">
        <div className="dropzone">
          <span className="ai-tag">AI</span>
          <span>Upload the invoice copy — fields fill themselves.</span>
          <input type="file" accept=".pdf,image/*"
                 onChange={e => onInvoiceCopy(e.target.files[0] || null)} />
          {aiBusy && <span>Reading document…</span>}
        </div>
        {aiNote && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 0' }}>{aiNote}</p>}

        <div className="formgrid" style={{ marginTop: 14 }}>
          <label className="f"><span>Invoice number</span>
            <input type="text" value={fields.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} /></label>
          <label className="f"><span>Payer</span>
            <input type="text" value={fields.payerName} onChange={e => set('payerName', e.target.value)} /></label>
          <label className="f"><span>Invoice amount (face value)</span>
            <input type="number" value={fields.amount} onChange={e => set('amount', e.target.value)} /></label>
          <label className="f"><span>Financing requested</span>
            <input type="number" value={fields.requestedAmount}
                   style={requestedTooHigh ? { borderColor: 'var(--red)' } : undefined}
                   onChange={e => set('requestedAmount', e.target.value)} /></label>
          <label className="f"><span>Currency</span>
            <input type="text" value={fields.currency} onChange={e => set('currency', e.target.value)} /></label>
          <label className="f"><span>Invoice date</span>
            <input type="date" value={fields.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} /></label>
          <label className="f"><span>Due date</span>
            <input type="date" value={fields.dueDate} onChange={e => set('dueDate', e.target.value)} /></label>
        </div>

        {requestedTooHigh && (
          <p style={{ fontSize: 13, color: 'var(--red)', margin: '8px 0 0' }}>
            Financing requested ({gbp(fields.requestedAmount, fields.currency)}) cannot exceed
            90% of the invoice face value ({gbp(0.9 * amt, fields.currency)}).
          </p>
        )}

        <label className="f" style={{ marginTop: 12 }}><span>Goods / services description</span>
          <input type="text" value={fields.goodsDescription} placeholder="e.g. 200 bales cotton yarn, 40s count"
                 onChange={e => set('goodsDescription', e.target.value)} /></label>

        {/* Pick the funders here, at registration. The dropdown only ever lists what is
            not already chosen, so it scales to any number of banks; the picks below are
            an app-layer application each — the ledger sees one invoice, once. */}
        <label className="f" style={{ marginTop: 12 }}>
          <span>Submit financing request to</span>
          <select value="" disabled={busy || lenders.length === LENDERS.length}
                  onChange={e => { if (e.target.value) setLenders(ls => [...ls, e.target.value]); }}>
            <option value="">
              {lenders.length === LENDERS.length ? 'All funders selected' : 'Choose a funder…'}
            </option>
            {LENDERS.filter(l => !lenders.includes(l.name))
                    .map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </label>
        <div className="chiprow" style={{ marginTop: 8 }}>
          {lenders.length === 0
            ? <span className="sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
                No funder selected — the invoice registers on the ledger but reaches no lender's queue.
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

        <div className="formgrid" style={{ marginTop: 12 }}>
          <label className="f"><span>Invoice copy {files.invoiceCopy
              ? '✓' : <span style={{ color: 'var(--red)' }}>* required — drives OCR</span>}</span>
            <input type="file" accept=".pdf,image/*" required
                   onChange={e => onInvoiceCopy(e.target.files[0] || null)} /></label>
          <label className="f"><span>Purchase order {files.purchaseOrder ? '✓' : '(optional)'}</span>
            <input type="file" accept=".pdf,image/*"
                   onChange={e => setDoc('purchaseOrder', e.target.files[0] || null)} /></label>
          <label className="f"><span>Goods-received note {files.goodsReceived ? '✓' : '(optional)'}</span>
            <input type="file" accept=".pdf,image/*"
                   onChange={e => setDoc('goodsReceived', e.target.files[0] || null)} /></label>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!canSubmit}
                  onClick={register}>{busy ? 'Registering…' : 'Register on ledger'}</button>
        </div>
      </div>

      {result && (result.ok
        ? <div className="notice-ok">✓ {result.message}</div>
        : <div className="rejected">
            <div className="headline">⛔ Ledger rejected this transaction</div>
            <div className="ledger-says">{result.message}</div>
          </div>)}

      <p className="eyebrow">My invoices — {me.displayName}</p>
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Amount</th><th>Requested</th><th>Status</th><th>Submitted to</th><th>Registered</th><th></th></tr></thead>
          <tbody>
            {mine.length === 0 && <tr><td colSpan="7" className="sub">No invoices yet — register the first one above.</td></tr>}
            {mine.map(inv => (
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
                          <span key={a.lender} className="applied"
                                title={`${a.lender} — submitted ${new Date(a.appliedAt).toLocaleString()}`}>
                            ✓ {shortName(a.lender)} <span className="state">{a.status}</span>
                          </span>
                        ))}
                      </div>}
                </td>
                <td className="sub">{new Date(inv.registeredAt).toLocaleString()}</td>
                <td><button className="btn" disabled={busy}
                            onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginBottom: 0 }}>
          Funders are chosen when the invoice is registered. Submitting to a lender is an
          application-layer action — no ledger write — and the same lender cannot be
          submitted to twice for one invoice.
        </p>
      </div>

      {trail && <AuditTrail trail={trail} onClose={() => setTrail(null)} />}
    </div>
  );
}
