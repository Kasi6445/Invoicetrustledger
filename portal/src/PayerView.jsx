import { useEffect, useState } from 'react';
import { listInvoices, approveInvoice, disputeInvoice, getHistory, getDoc } from './api';
import AuditTrail from './AuditTrail';

// `goodsReceived` is the historical upload key; the supplier now labels it
// "Other documents" — goods receipt itself is confirmed by the payer below.
const DOC_LABELS = { invoiceCopy: 'Invoice copy', purchaseOrder: 'Purchase order',
  goodsReceived: 'Other documents', goodsReceivedNote: 'Goods-received note' };
const gbp = (v, currency = 'GBP') =>
  Number(v).toLocaleString('en-GB', { style: 'currency', currency: currency || 'GBP' });

// Accepted upload formats — mirrors the API's multer whitelist.
const ACCEPTED_UPLOAD = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

// Status filters for the "Your invoices" list — the KPI stat cards drive these,
// so each card's count equals exactly the rows its click reveals.
const NAMING_FILTERS = {
  all:      { label: 'All',      match: () => true },
  approved: { label: 'Approved', match: i => ['APPROVED', 'FINANCED', 'SETTLED'].includes(i.status) },
};

export default function PayerView({ me }) {
  const [invoices, setInvoices] = useState([]);
  const [msg, setMsg] = useState(null);        // { ok, text }
  const [trail, setTrail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('pending');   // list view: 'pending' | 'naming'
  const [namingFilter, setNamingFilter] = useState('all');   // 'all' | 'approved'
  const [uploadErr, setUploadErr] = useState(null);   // red popup for a wrong-format upload

  // Reject a wrong-format goods-received note before it is attached.
  const chooseReceipt = (id, f) => {
    if (f && !ACCEPTED_UPLOAD.includes(f.type)) {
      setUploadErr(`"${f.name}" is not a supported format. Please upload a PDF, PNG or JPG.`);
      return;
    }
    setReceived(r => ({ ...r, [id]: f }));
  };
  // Proof-of-receipt file chosen per pending invoice: { [invoiceId]: File }. Held only
  // until approval — it is an attestation made at the moment the payer approves.
  const [received, setReceived] = useState({});

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
    // inv.docs holds the LEDGER-anchored registration documents only; the payer's own
    // proof of receipt is off-chain and surfaces in the "other invoices" table below.
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

  // `naming` is EVERY invoice that names this payer (including the still-REGISTERED
  // ones awaiting approval); `pending` is just the subset that still needs the payer
  // to act. The registered rows therefore appear both in the Awaiting-approval queue
  // (where the Approve/Dispute controls live) and in the full Naming-you list.
  const naming = invoices.filter(samePayer);
  const pending = naming.filter(i => i.status === 'REGISTERED');
  const shownNaming = naming.filter(NAMING_FILTERS[namingFilter].match);

  // Portfolio summary for the KPI band. Every clickable card's count equals the
  // rows it opens: "Naming you" = the full list (all statuses), "Approved" = its
  // approved subset, "Awaiting approval" = the pending list.
  const stats = {
    pending: pending.length,
    pendingAmt: pending.reduce((s, i) => s + (Number(i.amount) || 0), 0),
    approved: naming.filter(NAMING_FILTERS.approved.match).length,
    naming: naming.length,
  };

  return (
    <div className="supplier-view">
      <section className="sv-hero">
        <div className="sv-hero-head">
          <div>
            <h2>Payer console</h2>
            <p>{me.displayName} — confirm goods received and approve the invoices that name you.</p>
          </div>
        </div>
        <div className="sv-stats">
          <button type="button" className={`stat${tab === 'naming' && namingFilter === 'all' ? ' active' : ''}`} onClick={() => { setTab('naming'); setNamingFilter('all'); }}><span className="stat-val">{stats.naming}</span><span className="stat-lab">Naming you</span></button>
          <button type="button" className={`stat${tab === 'pending' ? ' active' : ''}`} onClick={() => setTab('pending')}><span className="stat-val">{stats.pending}</span><span className="stat-lab">Awaiting approval</span></button>
          <button type="button" className={`stat${tab === 'naming' && namingFilter === 'approved' ? ' active' : ''}`} onClick={() => { setTab('naming'); setNamingFilter('approved'); }}><span className="stat-val">{stats.approved}</span><span className="stat-lab">Approved</span></button>
          <div className="stat"><span className="stat-val">{gbp(stats.pendingAmt)}</span><span className="stat-lab">Value awaiting</span></div>
        </div>
      </section>

      <div className="sv-content solo">
        {/* Stat cards above are the navigation: Awaiting approval → pending queue,
            Approved / Naming you → your-invoices. No sidebar needed. */}
      {msg && (msg.ok
        ? <div className="notice-ok">✓ {msg.text}</div>
        : <div className="rejected">
            <div className="headline">⛔ Ledger rejected this transaction</div>
            <div className="ledger-says">{msg.text}</div>
          </div>)}

          {tab === 'pending' && (
          <div className="card card-lift">
            <div className="pane-head">
              <h3>Awaiting your confirmation</h3>
              <p>Attach the goods-received note, then approve or dispute each invoice.</p>
            </div>
            <div className="table-scroll">
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
                <td style={{ maxWidth: 260 }}>
                  <GoodsAndDocs inv={inv} />
                  {/* Goods receipt is evidenced HERE, by the party that actually took
                      delivery — not by a supplier-uploaded note. The attachment is
                      required before Approve; it is stored off-chain, never anchored,
                      so it never gates the ledger write. */}
                  <label className="grn">
                    <span>Goods-received note {received[inv.invoiceId]
                      ? <b title={received[inv.invoiceId].name}>✓ {received[inv.invoiceId].name}</b>
                      : <span style={{ color: 'var(--red)' }}>* required to approve</span>}</span>
                    <input type="file" accept=".pdf,image/*"
                           onChange={e => chooseReceipt(inv.invoiceId, e.target.files[0] || null)} />
                  </label>
                </td>
                <td className="sub">{inv.dueDate}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn primary" disabled={busy || !received[inv.invoiceId]}
                          title={received[inv.invoiceId] ? undefined : 'Attach the goods-received note first'}
                          onClick={() => act(i => approveInvoice(i, received[inv.invoiceId]), inv.invoiceId)}>{busy ? 'Working…' : 'Approve'}</button>{' '}
                  <button className="btn danger" disabled={busy} onClick={() => rejectWithReason(inv.invoiceId)}>Dispute</button>{' '}
                  <button className="btn" disabled={busy} onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
            </div>
            <p className="sub" style={{ marginBottom: 0, marginTop: 12 }}>
              Field-level access: you see the commercial record and can open every supporting document; the supplier's bank account is masked to last-4, sort code masked, and lender risk/financing data is not shown to you.
            </p>
          </div>
          )}

          {tab === 'naming' && (
          <div className="card card-lift">
            <div className="pane-head">
              <h3>Your other invoices</h3>
              <p>{NAMING_FILTERS[namingFilter].label} · {shownNaming.length} of {naming.length} naming {me.displayName}</p>
            </div>
            <div className="table-scroll">
        <table>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shownNaming.length === 0 && <tr><td colSpan="5" className="sub">{naming.length === 0 ? 'No invoices name you yet.' : 'No invoices match this filter.'}</td></tr>}
            {shownNaming.map(inv => (
              <tr key={inv.invoiceId}>
                <td>{inv.invoiceNumber}<div className="sub">{inv.invoiceId}</div></td>
                <td>{inv.supplierName}</td>
                <td className="amount">{gbp(inv.amount, inv.currency)}</td>
                <td><span className={`badge ${inv.status}`}>{inv.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {/* the goods-received note the payer attached at approval — this is
                      the only table it can appear in, since approving moves the row here */}
                  {inv.goodsReceivedNote && (
                    <><button className="btn" style={{ padding: '4px 10px', fontSize: 12 }}
                              onClick={() => openDoc(inv.invoiceId, 'goodsReceivedNote')}
                              title={inv.goodsReceivedNote.fileName}>📎 Goods-received note</button>{' '}</>
                  )}
                  <button className="btn" disabled={busy}
                          onClick={async () => { try { setTrail(await getHistory(inv.invoiceId)); } catch {} }}>Audit trail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
            </div>
          </div>
          )}
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
