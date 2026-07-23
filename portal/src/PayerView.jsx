import { useEffect, useState } from 'react';
import { listInvoices, approveInvoice, disputeInvoice, getHistory, getDoc } from './api';
import AuditTrail from './AuditTrail';

const DOC_LABELS = { invoiceCopy: 'Invoice copy', purchaseOrder: 'Purchase order', goodsReceived: 'Goods-received note' };

export default function PayerView({ me }) {
  const [invoices, setInvoices] = useState([]);
  const [msg, setMsg] = useState(null);        // { ok, text }
  const [trail, setTrail] = useState(null);
  const [busy, setBusy] = useState(false);

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

  const pending = invoices.filter(i => i.status === 'REGISTERED' && i.payerName === me.displayName);
  const rest = invoices.filter(i => !(i.status === 'REGISTERED' && i.payerName === me.displayName));

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
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Goods &amp; documents</th><th>Due</th><th></th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan="6" className="sub">Nothing waiting for approval.</td></tr>}
            {pending.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}
                  <div className="sub">a/c {inv.supplierProfile?.bankAccount || '—'} · IFSC {inv.supplierProfile?.ifsc || '—'}</div></td>
                <td className="amount">{inv.currency} {Number(inv.amount).toLocaleString('en-IN')}</td>
                <td style={{ maxWidth: 260 }}><GoodsAndDocs inv={inv} /></td>
                <td className="sub">{inv.dueDate}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn primary" disabled={busy} onClick={() => act(approveInvoice, inv.invoiceId)}>{busy ? 'Working…' : 'Approve'}</button>{' '}
                  <button className="btn danger" disabled={busy} onClick={() => act(id => disputeInvoice(id, 'Goods not received as described'), inv.invoiceId)}>Dispute</button>{' '}
                  <button className="btn" disabled={busy} onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginBottom: 0 }}>
          Field-level access: you see the commercial record and can open every supporting document; the supplier's bank account is masked to last-4, IFSC masked, and lender risk/financing data is not shown to you.
        </p>
      </div>

      <p className="eyebrow">All invoices naming {me.displayName}</p>
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rest.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}</td>
                <td className="amount">{inv.currency} {Number(inv.amount).toLocaleString('en-IN')}</td>
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
