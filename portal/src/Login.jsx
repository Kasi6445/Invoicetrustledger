import { useState } from 'react';
import { login } from './api';

const ROLES = [
  { username: 'supplier1', role: 'Supplier', name: 'Pennine Textiles Ltd',            desc: 'Registers invoices on the ledger' },
  { username: 'payer1',    role: 'Payer',    name: 'Northfield Retail Group plc',     desc: 'Confirms invoices are genuine' },
  { username: 'lloyds',    role: 'Lender',   name: 'Lloyds Bank Commercial Banking',  desc: 'Verifies risk and finances invoices' },
  { username: 'meridian',  role: 'Lender',   name: 'Meridian Invoice Finance Ltd',    desc: 'A second lender — tries the same invoice' },
];

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Quick-select: pre-fill the username only. No authentication until submit.
  function pick(u) {
    setUsername(u);
    setErr(null);
  }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try { onLogin(await login(username.trim(), password)); }
    catch (e2) { setErr(e2.response?.data?.error || 'Login failed — is the API running on :3000?'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <p className="eyebrow">One shared, tamper-proof register — three parties</p>
      <h2 style={{ margin: '0 0 4px' }}>Sign in to a console</h2>
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        Every role writes to and reads from the same ledger. What each role can see is enforced field by field.
      </p>

      <div className="login-grid">
        {ROLES.map(r => (
          <button key={r.username} type="button"
                  className={`login-card${username === r.username ? ' selected' : ''}`}
                  onClick={() => pick(r.username)}>
            <div className="r">{r.role}</div>
            <div className="n">{r.name}</div>
            <div className="d">{r.desc}</div>
          </button>
        ))}
      </div>

      <form className="card" onSubmit={submit} style={{ marginTop: 16, maxWidth: 420 }}>
        <div className="formgrid">
          <label className="f"><span>Username</span>
            <input type="text" value={username} autoComplete="username"
                   onChange={e => setUsername(e.target.value)} /></label>
          <label className="f"><span>Password</span>
            <input type="password" value={password} autoComplete="current-password"
                   onChange={e => setPassword(e.target.value)} /></label>
        </div>
        {err && <div className="rejected" style={{ marginTop: 10 }}><div className="ledger-says">{err}</div></div>}
        <div style={{ marginTop: 14 }}>
          <button className="btn primary" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
