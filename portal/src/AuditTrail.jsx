export default function AuditTrail({ trail, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>On-chain audit trail</h3>
        <p className="sub">Every version, permanently recorded — each entry carries a ledger transaction id and timestamp.</p>
        {trail.length === 0 && <p className="sub">No history found for this record.</p>}
        {trail.map((h, i) => (
          <div key={i} className="tl">
            <div><b>{h.record?.status}</b> · {new Date(h.timestamp).toLocaleString()}</div>
            <div className="txid">tx {h.txId}</div>
            {h.record?.financedBy && <div style={{ fontSize: 13 }}>financed by {h.record.financedBy}</div>}
            {h.record?.approvedBy && !h.record?.financedBy && <div style={{ fontSize: 13 }}>actioned by {h.record.approvedBy}</div>}
            {h.record?.disputeReason && <div style={{ fontSize: 13, color: 'var(--red)' }}>reason: {h.record.disputeReason}</div>}
          </div>
        ))}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
