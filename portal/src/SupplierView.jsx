import { useEffect, useState } from 'react';
import { listInvoices, registerInvoice, aiExtract, getHistory } from './api';
import AuditTrail from './AuditTrail';

const EMPTY = {
  invoiceNumber: '', payerName: 'BigRetail Ltd', amount: '', requestedAmount: '',
  currency: 'INR', invoiceDate: '', dueDate: '', goodsDescription: ''
};
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

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));
  const setDoc = (k, f) => setFiles(prev => ({ ...prev, [k]: f }));

  // Client-side guard only — the chaincode is the real enforcer (FINANCING
  // REQUEST REJECTED). This just gives immediate feedback before a round-trip.
  const amt = Number(fields.amount);
  const req = Number(fields.requestedAmount);
  const requestedTooHigh =
    fields.requestedAmount !== '' && fields.amount !== '' &&
    Number.isFinite(amt) && Number.isFinite(req) && req > amt;

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

  async function register() {
    if (requestedTooHigh) return;   // inline message already shown; ledger would reject anyway
    setResult(null);
    setBusy(true);
    try {
      const inv = await registerInvoice(fields, files);
      setResult({ ok: true, message: `Registered as ${inv.invoiceId} — status ${inv.status}. Document hash anchored on-chain.` });
      setFields(EMPTY); setFiles(NO_FILES);
      refresh();
    } catch (e) {
      setResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  const mine = invoices.filter(i => i.supplierVRN === me.vrn);
  const canSubmit = !busy && fields.invoiceNumber && fields.amount && fields.requestedAmount && !requestedTooHigh;

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
            Financing requested ({fields.currency} {Number(fields.requestedAmount).toLocaleString('en-IN')}) cannot exceed
            the invoice face value ({fields.currency} {Number(fields.amount).toLocaleString('en-IN')}).
          </p>
        )}

        <label className="f" style={{ marginTop: 12 }}><span>Goods / services description</span>
          <input type="text" value={fields.goodsDescription} placeholder="e.g. 200 bales cotton yarn, 40s count"
                 onChange={e => set('goodsDescription', e.target.value)} /></label>

        <div className="formgrid" style={{ marginTop: 12 }}>
          <label className="f"><span>Invoice copy {files.invoiceCopy ? '✓' : '(drives OCR above)'}</span>
            <input type="file" accept=".pdf,image/*"
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
          <thead><tr><th>Invoice</th><th>Amount</th><th>Requested</th><th>Status</th><th>Registered</th><th></th></tr></thead>
          <tbody>
            {mine.length === 0 && <tr><td colSpan="6" className="sub">No invoices yet — register the first one above.</td></tr>}
            {mine.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td className="amount">{inv.currency} {Number(inv.amount).toLocaleString('en-IN')}</td>
                <td className="amount">{inv.requestedAmount != null ? `${inv.currency} ${Number(inv.requestedAmount).toLocaleString('en-IN')}` : '—'}</td>
                <td><span className={`badge ${inv.status}`}>{inv.status}</span></td>
                <td className="sub">{new Date(inv.registeredAt).toLocaleString()}</td>
                <td><button className="btn" disabled={busy}
                            onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trail && <AuditTrail trail={trail} onClose={() => setTrail(null)} />}
    </div>
  );
}
