import { useEffect, useState } from 'react';
import { listInvoices, registerInvoice, aiExtract, getHistory } from './api';
import AuditTrail from './AuditTrail';

const EMPTY = { invoiceNumber: '', payerName: 'BigRetail Ltd', amount: '', currency: 'INR', dueDate: '' };

export default function SupplierView({ me }) {
  const [fields, setFields] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState(null);
  const [result, setResult] = useState(null);   // { ok, message }
  const [invoices, setInvoices] = useState([]);
  const [trail, setTrail] = useState(null);

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const set = (k, v) => setFields(f => ({ ...f, [k]: v }));

  async function onFile(f) {
    setFile(f); setAiNote(null); setResult(null);
    if (!f) return;
    setAiBusy(true);
    try {
      const x = await aiExtract(f);
      setFields(prev => ({
        invoiceNumber: x.invoiceNumber || prev.invoiceNumber,
        payerName: x.payerName || prev.payerName,
        amount: x.amount || prev.amount,
        currency: x.currency || prev.currency,
        dueDate: x.dueDate || prev.dueDate,
      }));
      setAiNote(x.simulated ? x.note : 'Fields extracted from the document by Gemini — review and register.');
    } catch (e) {
      setAiNote('AI extraction unavailable: ' + (e.response?.data?.error || e.message));
    } finally { setAiBusy(false); }
  }

  async function register() {
    setResult(null);
    try {
      const inv = await registerInvoice(fields, file);
      setResult({ ok: true, message: `Registered as ${inv.invoiceId} — status ${inv.status}. Document hash anchored on-chain.` });
      setFields(EMPTY); setFile(null);
      refresh();
    } catch (e) {
      setResult({ ok: false, message: e.response?.data?.error || e.message });
    }
  }

  const mine = invoices.filter(i => i.supplierVRN === me.vrn);

  return (
    <div>
      <p className="eyebrow">Step 1 · Register</p>
      <div className="card">
        <div className="dropzone">
          <span className="ai-tag">AI</span>
          <span>Upload the invoice PDF/image — fields fill themselves.</span>
          <input type="file" accept=".pdf,image/*"
                 onChange={e => onFile(e.target.files[0] || null)} />
          {aiBusy && <span>Reading document…</span>}
        </div>
        {aiNote && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '8px 0 0' }}>{aiNote}</p>}

        <div className="formgrid" style={{ marginTop: 14 }}>
          <label className="f"><span>Invoice number</span>
            <input type="text" value={fields.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} /></label>
          <label className="f"><span>Payer</span>
            <input type="text" value={fields.payerName} onChange={e => set('payerName', e.target.value)} /></label>
          <label className="f"><span>Amount</span>
            <input type="number" value={fields.amount} onChange={e => set('amount', e.target.value)} /></label>
          <label className="f"><span>Currency</span>
            <input type="text" value={fields.currency} onChange={e => set('currency', e.target.value)} /></label>
          <label className="f"><span>Due date</span>
            <input type="date" value={fields.dueDate} onChange={e => set('dueDate', e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!fields.invoiceNumber || !fields.amount}
                  onClick={register}>Register on ledger</button>
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
          <thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Registered</th><th></th></tr></thead>
          <tbody>
            {mine.length === 0 && <tr><td colSpan="5" className="sub">No invoices yet — register the first one above.</td></tr>}
            {mine.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td className="amount">{inv.currency} {Number(inv.amount).toLocaleString('en-IN')}</td>
                <td><span className={`badge ${inv.status}`}>{inv.status}</span>
                  {inv.tamperWarning && <div className="tamper">⚠ tamper flag</div>}</td>
                <td className="sub">{new Date(inv.registeredAt).toLocaleString()}</td>
                <td><button className="btn" onClick={async () => setTrail(await getHistory(inv.invoiceId))}>Audit trail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {trail && <AuditTrail trail={trail} onClose={() => setTrail(null)} />}
    </div>
  );
}
