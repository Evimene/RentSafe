const BASE = '/api';

async function request(path, { method = 'GET', body, token, isForm } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text.slice(0, 200) || 'Server returned a non-JSON response' }; }
  }

  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  register: (b) => request('/auth/register', { method: 'POST', body: b }),
  verifyPhone: (b) => request('/auth/verify-phone', { method: 'POST', body: b }),
  resendOtp: (b) => request('/auth/resend-otp', { method: 'POST', body: b }),
  login: (b) => request('/auth/login', { method: 'POST', body: b }),
  logout: (b) => request('/auth/logout', { method: 'POST', body: b }),
  me: (t) => request('/auth/me', { token: t }),
  kycStatus: (t) => request('/kyc/status', { token: t }),
  submitKyc: (t, formData) =>
    request('/kyc/submit', { method: 'POST', body: formData, token: t, isForm: true }),
};