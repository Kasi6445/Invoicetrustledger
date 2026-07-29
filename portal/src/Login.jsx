import { useRef, useState } from 'react';
import { login } from './api';
import heroImage from './assets/invoiceTrustLedger.png';

// Category cards only — no company or institution names before sign-in. The
// sign-in page is pre-authentication, so it must not disclose who is on the
// ledger; there is ONE lender card because both lenders share the same role
// (naming them here would leak the competing institution).
const ROLES = [
  {
    key: 'supplier', role: 'Supplier', username: 'supplier1',
    desc: 'Registers invoices on the ledger',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="11" y="14" width="26" height="20" rx="3" fill="currentColor" opacity=".14" />
        <path d="M18 20h4M26 20h4M18 26h4M26 26h4M18 32h4M26 32h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'payer', role: 'Payer', username: 'payer1',
    desc: 'Confirms invoices are genuine',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 10c6.627 0 12 5.373 12 12 0 7.333-5.98 12.557-12 16.174C17.98 34.557 12 29.333 12 22c0-6.627 5.373-12 12-12Z" fill="currentColor" opacity=".14" />
        <path d="M20 24l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'lender', role: 'Lender', username: '',
    desc: 'Verifies risk and finances invoices',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 34V16h20v18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 18v14M22 18v14M26 18v14M30 18v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 30h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [picked, setPicked] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef(null);
  const passRef = useRef(null);

  // Selecting a role card is a visual shortcut only — it highlights the chosen
  // role and focuses the username box, but never fills any credentials. The user
  // types both the username and password themselves; nothing authenticates until
  // submit. (No pre-fill for any role, so the fields always start empty.)
  function pick(r) {
    setUsername('');
    setPassword('');
    setPicked(r.key);
    setErr(null);
    userRef.current?.focus();
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
    <div className="login-shell">
      <section className="login-hero">
        <div className="hero-head">
          <h1>Welcome to the Invoice Trust Ledger Console</h1>
          <p>Sign in with your role and access a secure, tamper-proof invoice registry.</p>
        </div>

        <div className="hero-artboard">
          <img
            className="hero-illustration"
            src={heroImage}
            width="720" height="576"
            fetchPriority="high"
            decoding="async"
            alt="Illustration showing invoices being verified and shared on a ledger"
          />
        </div>

        <div className="hero-benefits">
          <div className="benefit-card">
            <strong>Secure</strong>
            <span>Tamper-proof and trusted</span>
          </div>
          <div className="benefit-card">
            <strong>Transparent</strong>
            <span>Real-time invoice verification</span>
          </div>
          <div className="benefit-card">
            <strong>Reliable</strong>
            <span>Risk and finance insights you trust</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card-shell">
          <div className="login-form-header card">
            <h2>Sign in to continue</h2>
            <p>Choose your role to get started</p>
          </div>

          <div className="login-grid">
            {ROLES.map(r => (
              <button key={r.key} type="button"
                      className={`role-card${picked === r.key ? ' selected' : ''}`}
                      onClick={() => pick(r)}>
                <div className="role-icon">{r.icon}</div>
                <div className="role-info">
                  <div className="role-title">{r.role}</div>
                  <div className="role-desc">{r.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <form className="card login-form" onSubmit={submit}>
            <div className={`form-stack${err ? ' with-error' : ''}`}>
              {err && (
                <div className="rejected login-error" role="alert">
                  <div className="ledger-says">{err}</div>
                </div>
              )}

              <label className="f input-with-icon">
                <span>Username</span>
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M5.5 19c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
                <input type="text" value={username} autoComplete="username" ref={userRef}
                       placeholder="Enter your username"
                       onChange={e => setUsername(e.target.value)} />
              </label>

              <label className="f input-with-icon">
                <span>Password</span>
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="5" y="10.5" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
                <input type="password" value={password} autoComplete="current-password" ref={passRef}
                       placeholder="Enter your password"
                       onChange={e => setPassword(e.target.value)} />
              </label>

              <div className="login-form-meta">
                <label className="checkbox">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                  Remember me
                </label>
              </div>
            </div>

            <div className="login-actions">
              <button className="btn primary" type="submit" disabled={busy || !username || !password}>
                <span className="btn-icon" aria-hidden="true">↪</span>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>

            <div className="login-note">
              Your data is secure and encrypted
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
