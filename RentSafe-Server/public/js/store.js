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


  browse: {
    view: 'list',        // 'list' | 'detail'
    filters: {
      city: 'Lagos',
      checkIn: '', checkOut: '', guests: '1',
    },
    results: [],
    current: null,
    currentId: null,
    page: 1,
    pageSize: 12,
    loading: false,
    error: null,
  },
  host: {
    listings: [],
    wizard: { open: false, step: 1, listingId: null, data: {}, photos: [], uploading: false },
    error: null,
    flash: null,
  },
});

export const setState = (patch) => store.set(patch);
export const getState = () => store.get();