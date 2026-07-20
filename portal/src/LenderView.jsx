import { useEffect, useState } from 'react';
import { listInvoices, fundInvoice, getHistory } from './api';
import AuditTrail from './AuditTrail';

export default function LenderView({ me }) {
  const [invoices, setInvoices] = useState([]);
  const [blocked, setBlocked] = useState(null);   // the rejection message
  const [funded, setFunded] = useState(null);
  const [trail, setTrail] = useState(null);
  const [fundingId, setFundingId] = useState(null);   // invoice currently being funded

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function fund(id) {
    setBlocked(null); setFunded(null);
    setFundingId(id);
    try {
      const inv = await fundInvoice(id);
      setFunded(`${inv.invoiceNumber} financed by ${me.displayName} — funds disbursed, ledger marked FINANCED.`);
      refresh();
    } catch (e) {
      setBlocked(e.response?.data?.error || e.message);   // "DUPLICATE FINANCING BLOCKED: ..."
      refresh();
    } finally { setFundingId(null); }
  }

  return (
    <div>
      <p className="eyebrow">Steps 4–5 · Verify &amp; fund</p>
      <h2 style={{ margin: '0 0 12px' }}>Lender console — {me.displayName}</h2>

      {blocked && (
        <div className="rejected">
          <div className="headline">⛔ Ledger rejected this transaction</div>
          <div className="ledger-says">{blocked}</div>
        </div>
      )}
      {funded && <div className="notice-ok">✓ {funded}</div>}

      <div className="card">
        <table>
          <thead>
            <tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Status</th><th>Risk</th><th></th></tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan="6" className="sub">Ledger is empty — run the seed script or register an invoice as the supplier.</td></tr>}
            {invoices.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}
                  <div className="sub">a/c {inv.supplierProfile?.bankAccount || '—'}</div></td>
                <td className="amount">{inv.currency} {Number(inv.amount).toLocaleString('en-IN')}</td>
                <td><span className={`badge ${inv.status}`}>{inv.status}</span></td>
                <td>
                  {inv.risk && (
                    <details className="reasons">
                      <summary><span className={`grade ${inv.risk.grade}`}>{inv.risk.grade}</span> ({inv.risk.score})</summary>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {inv.risk.reasons.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </details>
                  )}
                  {inv.tamperWarning && <div className="tamper" title={inv.tamperWarning}>⚠ tamper flag</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn primary"
                          disabled={fundingId !== null || inv.status === 'FINANCED' || inv.status === 'SETTLED'}
                          onClick={() => fund(inv.invoiceId)}>
                    {fundingId === inv.invoiceId ? 'Funding…'
                      : inv.status === 'FINANCED' ? `Financed by ${inv.financedBy}` : 'Fund invoice'}
                  </button>{' '}
                  <button className="btn" disabled={fundingId !== null}
                          onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sub" style={{ marginBottom: 0 }}>
          Risk grades are rule-based and ledger-derived — expand a grade to see every reason. KYC references are masked; bank account shown last-4 only.
        </p>
      </div>

      {trail && <AuditTrail trail={trail} onClose={() => setTrail(null)} />}
    </div>
  );
}
