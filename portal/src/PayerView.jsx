import { useEffect, useState } from 'react';
import { listInvoices, approveInvoice, disputeInvoice, getHistory } from './api';
import AuditTrail from './AuditTrail';

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
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Due</th><th></th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan="5" className="sub">Nothing waiting for approval.</td></tr>}
            {pending.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}
                  <div className="sub">a/c {inv.supplierProfile?.bankAccount || '—'} · sort {inv.supplierProfile?.sortCode || '—'}</div></td>
                <td className="amount">{inv.currency} {Number(inv.amount).toLocaleString('en-IN')}</td>
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
          Field-level access: you see the commercial record; the supplier's bank account is masked to last-4 and lender risk data is not shown to you.
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
