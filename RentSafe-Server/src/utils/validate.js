export const isPhone = (v) =>
  /^\+?[0-9]{10,15}$/.test(String(v || '').replace(/[\s-]/g, ''));

export const isEmail = (v) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));

export const isStrongPassword = (v) =>
  typeof v === 'string' && v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);