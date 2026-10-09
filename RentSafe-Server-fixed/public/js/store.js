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
});

export const setState = (patch) => store.set(patch);
export const getState = () => store.get();