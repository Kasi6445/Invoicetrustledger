import axios from 'axios';
const API = 'http://localhost:3000';
let token = null;

export async function login(username, password) {
  const { data } = await axios.post(`${API}/auth/login`, { username, password });
  token = data.token;
  return data; // { token, role, displayName, vrn }
}
export function logout() { token = null; }

const h = () => ({ headers: { Authorization: `Bearer ${token}` } });

export const listInvoices   = () => axios.get(`${API}/invoices`, h()).then(r => r.data);
export const getInvoice     = id => axios.get(`${API}/invoices/${id}`, h()).then(r => r.data);
export const getHistory     = id => axios.get(`${API}/invoices/${id}/history`, h()).then(r => r.data);
export const approveInvoice = id => axios.post(`${API}/invoices/${id}/approve`, {}, h()).then(r => r.data);
export const disputeInvoice = (id, reason) => axios.post(`${API}/invoices/${id}/dispute`, { reason }, h()).then(r => r.data);
export const fundInvoice    = id => axios.post(`${API}/invoices/${id}/fund`, {}, h()).then(r => r.data);
export const verifyLedger   = () => axios.get(`${API}/ledger/verify`, h()).then(r => r.data);

export function registerInvoice(fields, file) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (file) fd.append('doc', file);
  return axios.post(`${API}/invoices`, fd, h()).then(r => r.data);
}
export function aiExtract(file) {
  const fd = new FormData(); fd.append('doc', file);
  return axios.post(`${API}/ai/extract`, fd, h()).then(r => r.data);
}
