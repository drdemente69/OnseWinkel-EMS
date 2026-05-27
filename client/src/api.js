// REST client for the Onse Winkel EMS backend.
// Uses Vite's dev proxy in development and same-origin in production.

const base = '/api';
const TOKEN_KEY = 'ow-auth-token';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set token(v) {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else   localStorage.removeItem(TOKEN_KEY);
  },
  clear() { localStorage.removeItem(TOKEN_KEY); },
};

// Subscribers notified on 401 so the app can boot back to the login screen.
const unauthorizedHandlers = new Set();
export function onUnauthorized(fn) { unauthorizedHandlers.add(fn); return () => unauthorizedHandlers.delete(fn); }

async function req(path, opts = {}) {
  const url = `${base}${path}`;
  const init = { ...opts };
  const headers = { ...(init.headers || {}) };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  init.headers = headers;
  const r = await fetch(url, init);
  if (r.status === 401 && !path.startsWith('/auth/')) {
    auth.clear();
    for (const fn of unauthorizedHandlers) fn();
  }
  if (!r.ok) {
    let detail;
    try { detail = await r.json(); } catch { detail = await r.text(); }
    const message = detail?.error || (typeof detail === 'string' ? detail : `${r.status} ${r.statusText}`);
    const err = new Error(message);
    err.status = r.status;
    err.detail = detail;
    throw err;
  }
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return r.json();
  if (ct.startsWith('text/')) return r.text();
  return r.blob();
}

export const api = {
  health: () => req('/health'),
  dashboard: () => req('/dashboard'),
  hoursBreakdown: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/dashboard/hours-breakdown${qs ? `?${qs}` : ''}`);
  },
  attendancePdfUrl: (params = {}) => {
    const qs = new URLSearchParams({ ...params, token: auth.token || '' }).toString();
    return `${base}/attendance/pdf?${qs}`;
  },
  search: (q) => req(`/dashboard/search?q=${encodeURIComponent(q)}`),

  // ---- Auth
  login: (username, password) => req('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => req('/auth/logout', { method: 'POST' }),
  me: () => req('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    req('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  // ---- User management (owner only)
  permissionsCatalogue: () => req('/auth/permissions'),
  listUsers: () => req('/auth/users'),
  createUser: (body) => req('/auth/users', { method: 'POST', body }),
  updateUser: (id, body) => req(`/auth/users/${id}`, { method: 'PATCH', body }),
  resetUserPassword: (id, newPassword, ownerPassword) =>
    req(`/auth/users/${id}/reset-password`, { method: 'POST', body: { newPassword, ownerPassword } }),
  deleteUser: (id, ownerPassword) =>
    req(`/auth/users/${id}`, { method: 'DELETE', body: { ownerPassword } }),
  changeOwnerSecret: (current, nextSecret) =>
    req('/auth/owner-secret', { method: 'POST', body: { current, next: nextSecret } }),

  // ---- Employees
  listEmployees: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/employees${qs ? `?${qs}` : ''}`);
  },
  getEmployee: (id) => req(`/employees/${id}`),
  createEmployee: (body) => req('/employees', { method: 'POST', body }),
  updateEmployee: (id, body) => req(`/employees/${id}`, { method: 'PATCH', body }),
  deleteEmployee: (id) => req(`/employees/${id}`, { method: 'DELETE' }),

  // ---- Attendance
  listAttendance: (employeeId, from, to) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return req(`/attendance/${employeeId}${qs.toString() ? `?${qs}` : ''}`);
  },
  upsertAttendance: (employeeId, date, body) =>
    req(`/attendance/${employeeId}/${date}`, { method: 'PUT', body }),
  bulkAttendance: (employeeId, entries, range) =>
    req(`/attendance/${employeeId}/bulk`, { method: 'POST', body: { entries, range } }),
  deleteAttendance: (employeeId, date) =>
    req(`/attendance/${employeeId}/${date}`, { method: 'DELETE' }),

  // ---- Documents
  listDocuments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/documents${qs ? `?${qs}` : ''}`);
  },
  uploadDocument: (employeeId, file, tag, name) => {
    const fd = new FormData();
    fd.append('file', file);
    if (tag) fd.append('tag', tag);
    if (name) fd.append('name', name);
    return req(`/documents/${employeeId}`, { method: 'POST', body: fd });
  },
  updateDocument: (id, body) => req(`/documents/${id}`, { method: 'PATCH', body }),
  deleteDocument: (id) => req(`/documents/${id}`, { method: 'DELETE' }),
  documentUrl: (id) => `${base}/documents/${id}/file?token=${encodeURIComponent(auth.token || '')}`,

  // ---- Payslips
  listPayslips: () => req('/payslips'),
  previewPayslip: (body) => req('/payslips/preview', { method: 'POST', body }),
  createPayslip: (body) => req('/payslips', { method: 'POST', body }),
  getPayslip: (id) => req(`/payslips/${id}`),
  deletePayslip: (id) => req(`/payslips/${id}`, { method: 'DELETE' }),
  payslipPdfUrl: (id) => `${base}/payslips/${id}/pdf?token=${encodeURIComponent(auth.token || '')}`,

  // ---- OCR
  scanTimesheet: (file, opts = {}) => {
    const fd = new FormData();
    if (file) fd.append('image', file);
    if (opts.employeeId) fd.append('employeeId', opts.employeeId);
    if (opts.useSample) fd.append('useSample', 'true');
    if (opts.periodLabel) fd.append('periodLabel', opts.periodLabel);
    if (opts.periodStart) fd.append('periodStart', opts.periodStart);
    if (opts.periodEnd)   fd.append('periodEnd',   opts.periodEnd);
    if (opts.payDate)     fd.append('payDate',     opts.payDate);
    return req('/ocr/scan', { method: 'POST', body: fd });
  },
  commitOCR: (id, employeeId, rows) =>
    req(`/ocr/${id}/commit`, { method: 'POST', body: { employeeId, rows } }),
  ocrImageUrl: (id) => `${base}/ocr/${id}/image`,

  // ---- Backup
  backupExportUrl: () => `${base}/backup/export`,
  saveLocalBackup: () => req('/backup/save', { method: 'POST' }),
  listBackups: () => req('/backup'),
  importBackup: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return req('/backup/import', { method: 'POST', body: fd });
  },

  // ---- Settings
  getSettings: () => req('/settings'),
  saveSetting: (key, value) => req(`/settings/${key}`, { method: 'PUT', body: value }),
};

// Shared formatters — Onse Winkel uses dot as the decimal separator and comma
// as the thousands separator (e.g. R5,571.20).
export const ZAR = (n) => {
  if (n == null || isNaN(n)) return '–';
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return `${sign}R${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const NUM = (n, digits = 0) =>
  n == null || isNaN(n)
    ? '–'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const initials = (f, l) => `${(f || '').charAt(0)}${(l || '').charAt(0)}`.toUpperCase();
export const fmtDate = (iso, opts = {}) => {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return '–';
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
};
export const fmtDateShort = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '–';
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
};
export const fmtBytes = (b) => {
  if (b == null) return '–';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};
