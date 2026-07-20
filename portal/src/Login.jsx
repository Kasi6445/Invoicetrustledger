import { useState } from 'react';
import { login } from './api';

const ROLES = [
  { username: 'supplier1', role: 'Supplier', name: 'Sri Lakshmi Textiles', desc: 'Registers invoices on the ledger' },
  { username: 'payer1',    role: 'Payer',    name: 'BigRetail Ltd',        desc: 'Confirms invoices are genuine' },
  { username: 'lloyds',    role: 'Lender',   name: 'Lloyds Bank',          desc: 'Verifies risk and finances invoices' },
  { username: 'otherbank', role: 'Lender',   name: 'OtherBank NBFC',       desc: 'A second lender — tries the same invoice' },
];

export default function Login({ onLogin }) {
  const [err, setErr] = useState(null);

  async function pick(username) {
    setErr(null);
    try { onLogin(await login(username, 'demo123')); }
    catch (e) { setErr(e.response?.data?.error || 'Login failed — is the API running on :3000?'); }
  }

  return (
    <div>
      <p className="eyebrow">One shared, tamper-proof register — three parties</p>
      <h2 style={{ margin: '0 0 4px' }}>Choose a console to sign in</h2>
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        Every role writes to and reads from the same ledger. What each role can see is enforced field by field.
      </p>
      {err && <div className="rejected"><div className="ledger-says">{err}</div></div>}
      <div className="login-grid">
        {ROLES.map(r => (
          <button key={r.username} className="login-card" onClick={() => pick(r.username)}>
            <div className="r">{r.role}</div>
            <div className="n">{r.name}</div>
            <div className="d">{r.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
