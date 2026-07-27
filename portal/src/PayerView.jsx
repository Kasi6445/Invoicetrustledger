import { useEffect, useState } from 'react';
import { listInvoices, approveInvoice, disputeInvoice, getHistory, getDoc } from './api';
import AuditTrail from './AuditTrail';

const DOC_LABELS = { invoiceCopy: 'Invoice copy', purchaseOrder: 'Purchase order', goodsReceived: 'Goods-received note' };
const gbp = (v, currency = 'GBP') =>
  Number(v).toLocaleString('en-GB', { style: 'currency', currency: currency || 'GBP' });

export default function PayerView({ me }) {
  const [invoices, setInvoices] = useState([]);
  const [msg, setMsg] = useState(null);        // { ok, text }
  const [trail, setTrail] = useState(null);
  const [busy, setBusy] = useState(false);

  // payerName is free text (supplier types it, or Gemini OCR fills it from the invoice
  // copy) while displayName is a fixed account constant — so match leniently, and match
  // through ONE helper so the two lists below can never disagree about whose invoice it is.
  const samePayer = (inv) =>
    (inv.payerName || '').trim().toLowerCase() ===
    (me.displayName || '').trim().toLowerCase();

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function act(fn, id, label) {
    setMsg(null);
    setBusy(true);
    try {
      const inv = await fn(id);
      setMsg({ ok: true, text: `${inv.invoiceNumber} → ${inv.status}` });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || e.message });
      refresh();
    } finally { setBusy(false); }
  }

  // A rejection must carry a reason — the supplier has to know what to fix. This is the
  // client-side fast-fail (empty default, cancel aborts); the API is the real guard and
  // returns 400 "A rejection reason is required." if an empty one ever gets through.
  function rejectWithReason(id) {
    const reason = window.prompt('Reason for rejecting this invoice (required):', '');
    if (reason === null) return;                       // cancelled
    if (!reason.trim()) {
      setMsg({ ok: false, text: 'A rejection reason is required.' });
      return;
    }
    act(i => disputeInvoice(i, reason.trim()), id);
  }

  async function openDoc(id, type) {
    try {
      const url = await getDoc(id, type);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setMsg({ ok: false, text: 'Could not open document: ' + (e.response?.data?.error || e.message) });
    }
  }

  // Goods narrative + buttons for whichever supporting documents are attached.
  function GoodsAndDocs({ inv }) {
    const attached = Object.keys(inv.docs || {}).filter(t => inv.docs[t] && DOC_LABELS[t]);
    return (
      <div>
        <div>{inv.goodsDescription || <span className="sub">No goods description provided</span>}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {attached.length === 0 && <span className="sub">No documents attached</span>}
          {attached.map(t => (
            <button key={t} className="btn" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => openDoc(inv.invoiceId, t)}>📎 {DOC_LABELS[t]}</button>
          ))}
        </div>
      </div>
    );
  }

  // Both lists are scoped by samePayer; `naming` is the remainder, so a row shows in
  // exactly one table and the two can't drift apart.
  const isPending = (inv) => inv.status === 'REGISTERED' && samePayer(inv);
  const pending = invoices.filter(isPending);
  const naming = invoices.filter(i => samePayer(i) && !isPending(i));

  return (
    <div>
      {msg && (msg.ok
        ? <div className="notice-ok">✓ {msg.text}</div>
        : <div className="rejected">
            <div className="headline">⛔ Ledger rejected this transaction</div>
            <div className="ledger-says">{msg.text}</div>
          </div>)}

      <p className="eyebrow">Step 2 · Awaiting your confirmation</p>
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Requested</th><th>Goods &amp; documents</th><th>Due</th><th></th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan="7" className="sub">Nothing waiting for approval.</td></tr>}
            {pending.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}
                  <div className="sub">a/c {inv.supplierProfile?.bankAccount || '—'} · sort {inv.supplierProfile?.sortCode || '—'}</div></td>
                <td className="amount">{gbp(inv.amount, inv.currency)}</td>
                <td className="amount">{inv.requestedAmount != null ? gbp(inv.requestedAmount, inv.currency) : '—'}</td>
                <td style={{ maxWidth: 260 }}><GoodsAndDocs inv={inv} /></td>
                <td className="sub">{inv.dueDate}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn primary" disabled={busy} onClick={() => act(approveInvoice, inv.invoiceId)}>{busy ? 'Working…' : 'Approve'}</button>{' '}
                  <button className="btn danger" disabled={busy} onClick={() => rejectWithReason(inv.invoiceId)}>Dispute</button>{' '}
                  <button className="btn" disabled={busy} onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginBottom: 0 }}>
          Field-level access: you see the commercial record and can open every supporting document; the supplier's bank account is masked to last-4, sort code masked, and lender risk/financing data is not shown to you.
        </p>
      </div>

      <p className="eyebrow">Your other invoices</p>
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {naming.length === 0 && <tr><td colSpan="5" className="sub">No invoices name you yet.</td></tr>}
            {naming.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}</td>
                <td className="amount">{gbp(inv.amount, inv.currency)}</td>
                <td><span className={`badge ${inv.status}`}>{inv.status}</span></td>
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
