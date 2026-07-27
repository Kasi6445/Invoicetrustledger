import axios from 'axios';

// Empty string = same-origin (hosted build, where the API also serves the portal).
// Local dev sets VITE_API_URL=http://localhost:3000 in portal/.env.development.
const API = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'itl_token';
const USER_KEY = 'itl_user';

let token = sessionStorage.getItem(TOKEN_KEY);
let unauthorizedHandler = null;

// App registers a handler so an expired/invalid session drops back to login.
export function onUnauthorized(h) { unauthorizedHandler = h; }

const client = axios.create({ baseURL: API });

client.interceptors.request.use(cfg => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

client.interceptors.response.use(
  r => r,
  err => {
    const is401 = err.response?.status === 401;
    const isLoginCall = (err.config?.url || '').includes('/auth/login');
    if (is401 && !isLoginCall) {
      clearSession();
      unauthorizedHandler?.('Your session has expired — please sign in again.');
    }
    return Promise.reject(err);
  }
);

function clearSession() {
  token = null;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

// Survive a page refresh: restore { role, displayName, supplierCRN, payerId } if a token is stored.
export function restoreSession() {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!token || !raw) return null;
  try { return JSON.parse(raw); } catch { clearSession(); return null; }
}

export async function login(username, password) {
  const { data } = await client.post('/auth/login', { username, password });
  token = data.token;
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(
    { role: data.role, displayName: data.displayName,
      supplierCRN: data.supplierCRN, payerId: data.payerId }));
  return data; // { token, role, displayName, supplierCRN, payerId }
}
export function logout() { clearSession(); }

export const listInvoices   = () => client.get('/invoices').then(r => r.data);
export const getInvoice     = id => client.get(`/invoices/${id}`).then(r => r.data);
export const getHistory     = id => client.get(`/invoices/${id}/history`).then(r => r.data);
export const approveInvoice = id => client.post(`/invoices/${id}/approve`, {}).then(r => r.data);
export const disputeInvoice = (id, reason) => client.post(`/invoices/${id}/dispute`, { reason }).then(r => r.data);
export const fundInvoice    = id => client.post(`/invoices/${id}/fund`, {}).then(r => r.data);
// App-layer only: offer this invoice to a named lender. Returns the updated list.
export const applyToLender  = (id, lender) => client.post(`/invoices/${id}/apply`, { lender }).then(r => r.data);
export const declineInvoice = (id, reason) => client.post(`/invoices/${id}/decline`, { reason }).then(r => r.data);
export const verifyLedger   = () => client.get('/ledger/verify').then(r => r.data);
export const getPaymentInstructions = id => client.get(`/invoices/${id}/payment-instructions`).then(r => r.data);

// Fetch a supporting document (auth header required, so we can't just link to
// the URL) and hand back a blob URL the caller can open in a new tab.
export async function getDoc(id, type) {
  const res = await client.get(`/invoices/${id}/doc/${type}`, { responseType: 'blob' });
  return URL.createObjectURL(res.data);
}

// Recompute the on-disk document's SHA-256 and compare it to the hash anchored
// on the ledger at registration. Returns { anchoredHash, recomputedHash, match, ... }.
export const verifyDoc = (id, type) =>
  client.get(`/invoices/${id}/doc/${type}/verify`).then(r => r.data);

// Companies House register check for the invoice's supplier CRN.
// Returns { found, status, companyName, source: 'live'|'cached', ... }.
export const supplierCheck = id =>
  client.get(`/invoices/${id}/supplier-check`).then(r => r.data);

// files: { invoiceCopy, purchaseOrder, goodsReceived } — each optional.
export function registerInvoice(fields, files) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (files) for (const [name, f] of Object.entries(files)) if (f) fd.append(name, f);
  return client.post('/invoices', fd).then(r => r.data);
}
export function aiExtract(file) {
  const fd = new FormData(); fd.append('doc', file);
  return client.post('/ai/extract', fd).then(r => r.data);
}
