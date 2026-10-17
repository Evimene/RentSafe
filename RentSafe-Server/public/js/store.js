import { createStore } from './mini.js';

export const store = createStore({
  route: 'register',        // register | verify | login | dashboard | kyc
  loading: false,
  error: null,
  flash: null,
  user: null,
  accessToken: null,
  refreshToken: null,
  pendingPhone: null,
  devOtp: null,
  kyc: { overall: null, records: [] },

  // Admin
  admin: {
    view: 'kyc_list',        // 'kyc_list' | 'kyc_detail' | 'audit'
    stats: null,
    list: {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      filters: { status: 'submitted', type: '', search: '' },
      loading: false,
    },
    detail: {
      id: null,
      data: null,
      loading: false,
      revealedFields: {},    // { verified_data: true, selfie_url: true, ... }
    },
    rejectionReasons: [],
    reviewModal: {
      open: false,
      action: null,          // 'approve' | 'reject'
      reason: '',
      notes: '',
      submitting: false,
    },
    audit: {
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      loading: false,
    },
  },
});

export const setState = (patch) => store.set(patch);
export const getState = () => store.get();