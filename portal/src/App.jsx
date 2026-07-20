import { useEffect, useState } from 'react';
import { logout as apiLogout, verifyLedger, restoreSession, onUnauthorized } from './api';
import Login from './Login';
import SupplierView from './SupplierView';
import PayerView from './PayerView';
import LenderView from './LenderView';

export default function App() {
  const [me, setMe] = useState(() => restoreSession());  // survives page refresh
  const [chain, setChain] = useState(null);              // ledger integrity result
  const [notice, setNotice] = useState(null);            // e.g. "session expired"

  useEffect(() => {
    onUnauthorized(message => {
      setMe(null); setChain(null); setNotice(message);
    });
  }, []);

  async function checkChain() {
    try { setChain(await verifyLedger()); }
    catch (e) { setChain({ valid: false, detail: e.response?.data?.error || e.message }); }
  }

  function signOut() { apiLogout(); setMe(null); setChain(null); setNotice(null); }

  function onLogin(user) { setNotice(null); setMe(user); }

  return (
    <>
      <header className="topbar">
        <div className="brandmark">◫</div>
        <h1>Invoice Trust Ledger</h1>
        {me && (
          <div className="who">
            <button className="chainpill" onClick={checkChain} title="Recompute the ledger hash chain">
              {chain == null ? 'verify ledger'
                : chain.valid ? `✓ chain intact${chain.entries != null ? ` · ${chain.entries} tx` : ''}`
                : '✗ chain broken'}
            </button>
            <span className="rolechip">{me.role}</span>
            <span>{me.displayName}</span>
            <button onClick={signOut}>Log out</button>
          </div>
        )}
      </header>
      <main className="wrap">
        {!me && notice && <div className="rejected"><div className="ledger-says">{notice}</div></div>}
        {!me && <Login onLogin={onLogin} />}
        {me?.role === 'supplier' && <SupplierView me={me} />}
        {me?.role === 'payer'    && <PayerView me={me} />}
        {me?.role === 'lender'   && <LenderView me={me} />}
      </main>
    </>
  );
}
