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


  // ---- Admin ----
  adminStats: (t) => request('/admin/stats', { token: t }),
  adminListKyc: (t, params) =>
    request(`/admin/kyc?${new URLSearchParams(params).toString()}`, { token: t }),
  adminKycDetail: (t, id) => request(`/admin/kyc/${id}`, { token: t }),
  adminReveal: (t, id, field) =>
    request(`/admin/kyc/${id}/reveal`, { method: 'POST', body: { field }, token: t }),
  adminReviewKyc: (t, id, body) =>
    request(`/admin/kyc/${id}/review`, { method: 'POST', body, token: t }),
  adminAudit: (t, params) =>
    request(`/admin/audit?${new URLSearchParams(params).toString()}`, { token: t }),
  adminRejectionReasons: (t) => request('/admin/rejection-reasons', { token: t }),



  // ---- Host ----
hostListings: (t, status = 'all') =>
  request(`/host/listings?status=${status}`, { token: t }),
hostCreateListing: (t, body) =>
  request('/host/listings', { method: 'POST', body, token: t }),
hostGetListing: (t, id) => request(`/host/listings/${id}`, { token: t }),
hostUpdateListing: (t, id, body) =>
  request(`/host/listings/${id}`, { method: 'PATCH', body, token: t }),
hostSubmitListing: (t, id) =>
  request(`/host/listings/${id}/submit`, { method: 'POST', token: t }),
hostArchiveListing: (t, id) =>
  request(`/host/listings/${id}/archive`, { method: 'POST', token: t }),
hostSetAvailability: (t, id, body) =>
  request(`/host/listings/${id}/availability`, { method: 'POST', body, token: t }),
hostUploadPhotos: (t, id, formData) =>
  request(`/host/listings/${id}/media`, { method: 'POST', body: formData, token: t, isForm: true }),
hostDeletePhoto: (t, id, mediaId) =>
  request(`/host/listings/${id}/media/${mediaId}`, { method: 'DELETE', token: t }),
hostSetCover: (t, id, mediaId) =>
  request(`/host/listings/${id}/media/${mediaId}/cover`, { method: 'POST', token: t }),

// ---- Public listings ----
searchListings: (t, params) =>
  request(`/listings/search?${new URLSearchParams(params).toString()}`, { token: t }),
getListing: (t, id) => request(`/listings/${id}`, { token: t }),


// Host availability
hostGetAvailability: (t, id, from, to) =>
  request(`/host/listings/${id}/availability?from=${from}&to=${to}`, { token: t }),
hostBulkAvailability: (t, id, body) =>
  request(`/host/listings/${id}/availability/bulk`, { method: 'POST', body, token: t }),
hostClearOverrides: (t, id, body) =>
  request(`/host/listings/${id}/availability/clear-overrides`, { method: 'POST', body, token: t }),

// Public availability + pricing
publicAvailability: (t, id, from, to) =>
  request(`/listings/${id}/availability?from=${from}&to=${to}`, { token: t }),
priceListing: (t, id, checkIn, checkOut) =>
  request(`/listings/${id}/price?checkIn=${checkIn}&checkOut=${checkOut}`, { token: t }),


// Map API
mapMarkers: (t, params) =>
  request(`/map/markers?${new URLSearchParams(params).toString()}`, { token: t }),
geocode: (t, q) =>
  request(`/map/geocode?q=${encodeURIComponent(q)}`, { token: t }),
reverseGeocode: (t, lat, lng) =>
  request(`/map/reverse?lat=${lat}&lng=${lng}`, { token: t }),
nearbyListings: (t, id, radius = 2000) =>
  request(`/map/nearby/${id}?radius=${radius}`, { token: t }),
saveSearch: (t, body) =>
  request('/saved-searches', { method: 'POST', body, token: t }),
listSavedSearches: (t) => request('/saved-searches', { token: t }),
deleteSavedSearch: (t, id) =>
  request(`/saved-searches/${id}`, { method: 'DELETE', token: t }),


// -------------------------> Inspections
// Inspector
inspectorProfile: (t) => request('/inspector/profile', { token: t }),
inspectorUpdateProfile: (t, body) => request('/inspector/profile', { method: 'PATCH', body, token: t }),
inspectorQueue: (t) => request('/inspector/queue', { token: t }),
inspectorHistory: (t) => request('/inspector/history', { token: t }),
inspectorEarnings: (t) => request('/inspector/earnings', { token: t }),
inspectorGetInspection: (t, id) => request(`/inspector/inspections/${id}`, { token: t }),
inspectorAccept: (t, id) => request(`/inspector/inspections/${id}/accept`, { method: 'POST', token: t }),
inspectorStart: (t, id, body) => request(`/inspector/inspections/${id}/start`, { method: 'POST', body, token: t }),
inspectorUploadPhoto: (t, id, fd) => request(`/inspector/inspections/${id}/photos`, { method: 'POST', body: fd, token: t, isForm: true }),
inspectorSubmit: (t, id, body) => request(`/inspector/inspections/${id}/submit`, { method: 'POST', body, token: t }),

// Admin
adminListInspections: (t, params) =>
  request(`/admin/inspections?${new URLSearchParams(params)}`, { token: t }),
adminGetInspection: (t, id) => request(`/admin/inspections/${id}`, { token: t }),
adminApproveInspection: (t, id, body) =>
  request(`/admin/inspections/${id}/approve`, { method: 'POST', body, token: t }),
adminRejectInspection: (t, id, body) =>
  request(`/admin/inspections/${id}/reject`, { method: 'POST', body, token: t }),
adminAssignInspector: (t, id, body) =>
  request(`/admin/inspections/${id}/assign`, { method: 'POST', body, token: t }),
adminListInspectors: (t) => request('/admin/inspections/inspectors', { token: t }),
adminGrantInspector: (t, userId, body) =>
  request(`/admin/inspections/inspectors/${userId}/grant`, { method: 'POST', body, token: t }),
adminRevokeInspector: (t, userId) =>
  request(`/admin/inspections/inspectors/${userId}/revoke`, { method: 'POST', token: t }),

// Host
hostRequestInspection: (t, listingId) =>
  request(`/host/listings/${listingId}/request-inspection`, { method: 'POST', token: t }),
hostListInspections: (t, listingId) =>
  request(`/host/listings/${listingId}/inspections`, { token: t }),

// Public
publicInspectionSummary: (t, id) =>
  request(`/listings/${id}/inspection-summary`, { token: t }),

};


