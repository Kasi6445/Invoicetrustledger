import { useEffect, useState } from 'react';
import { logout as apiLogout, restoreSession, onUnauthorized } from './api';
import Login from './Login';
import SupplierView from './SupplierView';
import PayerView from './PayerView';
import LenderView from './LenderView';

export default function App() {
  const [me, setMe] = useState(() => restoreSession());  // survives page refresh
  const [notice, setNotice] = useState(null);            // e.g. "session expired"

  useEffect(() => {
    onUnauthorized(message => {
      setMe(null); setNotice(message);
    });
  }, []);

  function signOut() { apiLogout(); setMe(null); setNotice(null); }

  function onLogin(user) { setNotice(null); setMe(user); }

  return (
    <>
      <header className="topbar">
        <div className="brandmark">◫</div>
        <h1>Invoice Trust Ledger</h1>
        {me && (
          <div className="who">
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
