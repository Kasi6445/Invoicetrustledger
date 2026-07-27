import { useRef, useState } from 'react';
import { login } from './api';

// Category cards only — no company or institution names before sign-in. The
// sign-in page is pre-authentication, so it must not disclose who is on the
// ledger; there is ONE lender card because both lenders share the same role
// (naming them here would leak the competing institution).
const ROLES = [
  { key: 'supplier', role: 'Supplier', username: 'supplier1', desc: 'Registers invoices on the ledger' },
  { key: 'payer',    role: 'Payer',    username: 'payer1',    desc: 'Confirms invoices are genuine' },
  { key: 'lender',   role: 'Lender',   username: '',          desc: 'Verifies risk and finances invoices' },
];

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [picked, setPicked] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef(null);

  // Quick-select: pre-fill the form only. No authentication until submit.
  // The lender card deliberately leaves the username blank — which lender is
  // signing in is theirs to type, not ours to suggest.
  function pick(r) {
    setUsername(r.username);
    setPassword('demo123');
    setPicked(r.key);
    setErr(null);
    if (!r.username) userRef.current?.focus();
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
          <button key={r.key} type="button"
                  className={`login-card${picked === r.key ? ' selected' : ''}`}
                  onClick={() => pick(r)}>
            <div className="n">{r.role}</div>
            <div className="d">{r.desc}</div>
          </button>
        ))}
      </div>

      <form className="card" onSubmit={submit} style={{ marginTop: 16, maxWidth: 420 }}>
        <div className="formgrid">
          <label className="f"><span>Username</span>
            <input type="text" value={username} autoComplete="username" ref={userRef}
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
