import { useEffect, useState } from 'react';
import { listInvoices, fundInvoice, declineInvoice, getHistory, getPaymentInstructions, verifyDoc, getDoc } from './api';
import AuditTrail from './AuditTrail';

const gbp = (v, currency = 'GBP') =>
  Number(v).toLocaleString('en-GB', { style: 'currency', currency: currency || 'GBP' });

export default function LenderView({ me }) {
  const [invoices, setInvoices] = useState([]);
  const [blocked, setBlocked] = useState(null);   // the rejection message
  const [funded, setFunded] = useState(null);
  const [trail, setTrail] = useState(null);
  const [fundingId, setFundingId] = useState(null);   // invoice currently being funded
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('ready');
  const [payInfo, setPayInfo] = useState(null);   // funder-only payment instructions modal
  const [docCheck, setDocCheck] = useState(null); // document integrity-verification modal

  const refresh = () => listInvoices().then(setInvoices).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const declinedByMe = inv => (inv.declines || []).some(d => d.by === me.displayName);
  const fundedByMe   = inv => inv.status === 'FINANCED' && inv.financedBy === me.displayName;

  const TABS = [
    { key: 'ready',    label: 'Ready to fund',  match: inv => inv.status === 'APPROVED' && !declinedByMe(inv) },
    { key: 'funded',   label: 'Funded by me',   match: fundedByMe },
    { key: 'declined', label: 'Declined by me', match: declinedByMe },
    { key: 'all',      label: 'All',            match: () => true },
  ];

  const q = search.trim().toLowerCase();
  const matchesSearch = inv => !q ||
    [inv.supplierName, inv.payerName, inv.invoiceNumber]
      .some(v => String(v || '').toLowerCase().includes(q));

  const activeTab = TABS.find(t => t.key === tab);
  const visible = invoices.filter(inv => activeTab.match(inv) && matchesSearch(inv));

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

  async function decline(id) {
    const reason = window.prompt('Reason for declining (one line):', 'Outside risk appetite');
    if (reason === null) return;   // cancelled
    setBlocked(null); setFunded(null);
    setFundingId(id);
    try {
      const inv = await declineInvoice(id, reason);
      setFunded(`${inv.invoiceNumber} declined by ${me.displayName} — recorded on the ledger; other lenders may still fund it.`);
      refresh();
    } catch (e) {
      setBlocked(e.response?.data?.error || e.message);
      refresh();
    } finally { setFundingId(null); }
  }

  // Entitlement: the API returns full supplier bank details only to the lender
  // that financed this invoice (403 otherwise, without naming the funder).
  async function showPayInstructions(id) {
    setPayInfo({ loading: true });
    try { setPayInfo(await getPaymentInstructions(id)); }
    catch (e) { setPayInfo({ error: e.response?.data?.error || e.message }); }
  }

  // Due-diligence beat: recompute the stored invoice-copy's hash and prove it
  // matches the fingerprint anchored on the ledger. Green = provably unchanged.
  async function checkDoc(id) {
    setDocCheck({ loading: true });
    try { setDocCheck(await verifyDoc(id, 'invoiceCopy')); }
    catch (e) { setDocCheck({ error: e.response?.data?.error || e.message }); }
  }
  async function openDoc(id) {
    try { window.open(await getDoc(id, 'invoiceCopy'), '_blank', 'noopener'); }
    catch (e) { setDocCheck({ error: e.response?.data?.error || e.message }); }
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
        <input
          type="text" placeholder="Search supplier, payer or invoice number…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 13,
                   border: '1px solid var(--line)', borderRadius: 8, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {TABS.map(t => {
            const count = invoices.filter(inv => t.match(inv)).length;
            const active = t.key === tab;
            return (
              <button key={t.key} className="btn" onClick={() => setTab(t.key)}
                      style={active
                        ? { background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }
                        : undefined}>
                {t.label} ({count})
              </button>
            );
          })}
        </div>
        <details className="legend">
          <summary>How the risk grade is calculated</summary>
          <div className="legend-body">
            <p className="sub" style={{ marginTop: 0 }}>
              Rule-based and fully explainable — no black box. Every point maps to a fact on the
              ledger, so any grade can be defended line by line. Score is out of 100:
              &nbsp;<span className="grade A">A</span>&nbsp;≥&nbsp;78&nbsp;·&nbsp;
              <span className="grade B">B</span>&nbsp;≥&nbsp;55&nbsp;·&nbsp;
              <span className="grade C">C</span>&nbsp;below.
            </p>
            <table className="legend-table">
              <thead><tr><th>Signal</th><th>Max</th><th>Where it comes from</th></tr></thead>
              <tbody>
                <tr><td>Payer approved</td><td>+35</td><td>on-chain status</td></tr>
                <tr><td>Document hash anchored</td><td>+15</td><td>SHA-256 on-chain</td></tr>
                <tr><td>Due date in 7–180 day window</td><td>+10</td><td>invoice terms</td></tr>
                <tr><td>Amount in routine band (≤ £1M)</td><td>+10</td><td>face value</td></tr>
                <tr><td>No lender declines</td><td>+10</td><td>ledger declines</td></tr>
                <tr><td>Conservative advance (≤ 90% of face)</td><td>+12</td><td>requested vs face</td></tr>
                <tr><td>Short payer terms (≤ 30 days)</td><td>+8</td><td>payer credit profile</td></tr>
              </tbody>
            </table>
            <p className="sub" style={{ marginBottom: 0 }}>
              <b>Adjustments.</b> −25 if the same document is already registered under a different
              number (a re-numbered resubmission). <b>Structural cap:</b> a payer with no credit
              rating on file can never grade above <span className="grade B">B</span>, whatever the
              score — a deliberate rule, not a one-point margin.
            </p>
          </div>
        </details>
        <table>
          <thead>
            <tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Payer terms</th><th>Status</th><th>Risk</th><th></th></tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan="7" className="sub">Ledger is empty — run the seed script or register an invoice as the supplier.</td></tr>}
            {invoices.length > 0 && visible.length === 0 &&
              <tr><td colSpan="7" className="sub">Nothing matches this tab{q ? ' and search' : ''} — try the All tab or clear the search.</td></tr>}
            {visible.map(inv => {
              const mine = fundedByMe(inv);
              // Fund button appearance is status-driven. It stays CLICKABLE on a
              // FINANCED row viewed by a non-funder — that rejected click is the
              // demo's climax — so it is never disabled there, only re-styled amber.
              // The row never names the funding institution (matches the masked error).
              let fundClass = 'btn primary', fundLabel = 'Fund invoice', fundDisabled = fundingId !== null;
              if (inv.status === 'REGISTERED') { fundClass = 'btn'; fundLabel = 'Awaiting payer approval'; fundDisabled = true; }
              else if (inv.status === 'FINANCED') {
                if (mine) { fundClass = 'btn'; fundLabel = 'Financed by you'; fundDisabled = true; }
                else { fundClass = 'btn amber'; fundLabel = 'Attempt funding'; }
              }
              else if (inv.status === 'SETTLED') { fundClass = 'btn'; fundLabel = 'Settled'; fundDisabled = true; }
              else if (inv.status === 'DISPUTED') { fundClass = 'btn'; fundLabel = 'Disputed'; fundDisabled = true; }
              if (fundingId === inv.invoiceId) fundLabel = 'Funding…';
              return (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}
                  <div className="sub">a/c {inv.supplierProfile?.bankAccount || '—'}</div></td>
                <td className="amount">{gbp(inv.amount, inv.currency)}</td>
                <td>
                  {inv.payerProfile
                    ? <span>{inv.payerProfile.paymentTerms || '—'}
                        {inv.payerProfile.payerRating && <div className="sub">rating {inv.payerProfile.payerRating}</div>}</span>
                    : <span className="sub">—</span>}
                </td>
                <td>
                  <span className={`badge ${inv.status}`}>{inv.status}</span>
                  {inv.status === 'FINANCED' &&
                    <div className="sub" style={{ marginTop: 4 }}>Prior assignment recorded on ledger</div>}
                </td>
                <td>
                  {inv.risk && (
                    <details className="reasons">
                      <summary><span className={`grade ${inv.risk.grade}`}>{inv.risk.grade}</span> ({inv.risk.score})</summary>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {inv.risk.reasons.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </details>
                  )}
                  {inv.risk?.similar &&
                    <div className="similar" title="Similar invoice(s) on the ledger — expand the risk grade for details">⚠ similar</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className={fundClass} disabled={fundDisabled}
                          onClick={() => fund(inv.invoiceId)}>{fundLabel}</button>{' '}
                  {(inv.status === 'APPROVED' || inv.status === 'REGISTERED') && (
                    <><button className="btn danger"
                              disabled={fundingId !== null || inv.status !== 'APPROVED'}
                              title={inv.status === 'APPROVED' ? undefined : 'Declinable once the payer approves'}
                              onClick={() => decline(inv.invoiceId)}>Decline</button>{' '}</>
                  )}
                  {fundedByMe(inv) && (
                    <><button className="btn" disabled={fundingId !== null}
                              onClick={() => showPayInstructions(inv.invoiceId)}>Payment instructions</button>{' '}</>
                  )}
                  <button className="btn" disabled={fundingId !== null}
                          onClick={() => checkDoc(inv.invoiceId)}
                          title="Recompute the document hash and check it against the ledger">Verify document</button>{' '}
                  <button className="btn" disabled={fundingId !== null}
                          onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        <p className="sub" style={{ marginBottom: 0 }}>
          Risk grades are rule-based and ledger-derived — expand a grade to see every reason. CDD records are masked; bank account shown last-4 only.
        </p>
      </div>

      {trail && <AuditTrail trail={trail} onClose={() => setTrail(null)} />}

      {payInfo && (
        <div className="overlay" onClick={() => setPayInfo(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Payment instructions</h3>
            {payInfo.loading && <p className="sub">Loading…</p>}
            {payInfo.error && <p style={{ color: 'var(--red)' }}>{payInfo.error}</p>}
            {!payInfo.loading && !payInfo.error && (
              <div style={{ fontSize: 14, lineHeight: 1.9 }}>
                <div><b>{payInfo.invoiceNumber}</b></div>
                <div>Beneficiary: {payInfo.beneficiary}</div>
                <div>Bank: {payInfo.bankName}</div>
                <div>Account: {payInfo.bankAccount}</div>
                <div>Sort code: {payInfo.sortCode}</div>
                <div>Disburse: {gbp(payInfo.amount, payInfo.currency)}</div>
                <p className="sub" style={{ marginTop: 10 }}>
                  Released to you as the financing institution — the ledger gates these
                  details so no other lender can read them.
                </p>
              </div>
            )}
            <button className="btn" onClick={() => setPayInfo(null)}>Close</button>
          </div>
        </div>
      )}

      {docCheck && (
        <div className="overlay" onClick={() => setDocCheck(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Document integrity</h3>
            {docCheck.loading && <p className="sub">Recomputing hash…</p>}
            {docCheck.error && <p style={{ color: 'var(--red)' }}>{docCheck.error}</p>}
            {!docCheck.loading && !docCheck.error && (
              <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                {docCheck.match ? (
                  <div className="notice-ok" style={{ marginBottom: 12 }}>
                    ✓ Integrity confirmed — the stored invoice copy is byte-identical to the
                    document anchored on the ledger at registration.
                  </div>
                ) : (
                  <div className="rejected" style={{ marginBottom: 12 }}>
                    <div className="headline">⛔ Document does NOT match the ledger</div>
                    <div className="ledger-says">
                      The off-chain file has changed since it was anchored — do not fund against it.
                    </div>
                  </div>
                )}
                <div className="sub">Invoice {docCheck.invoiceNumber} · {docCheck.type} · {docCheck.algorithm}</div>
                <div style={{ marginTop: 8 }}>
                  <div className="sub">Anchored on ledger</div>
                  <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{docCheck.anchoredHash}</code>
                  <div className="sub" style={{ marginTop: 6 }}>Recomputed from the stored file</div>
                  <code style={{ fontSize: 11, wordBreak: 'break-all',
                                 color: docCheck.match ? 'var(--ok)' : 'var(--red)' }}>{docCheck.recomputedHash}</code>
                </div>
                <p className="sub" style={{ marginTop: 10 }}>
                  The document lives off-chain and is mutable; its fingerprint on the ledger is not.
                  This proves the copy has not been swapped since the payer approved it.
                </p>
                <button className="btn" style={{ marginRight: 8 }}
                        onClick={() => openDoc(docCheck.invoiceId)}>Open document</button>
              </div>
            )}
            <button className="btn" onClick={() => setDocCheck(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
