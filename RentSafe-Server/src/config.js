import 'dotenv/config';

function readPositiveInteger(value, fallback, name) {
  const text = value == null ? '' : String(value).trim();
  const number = text === '' ? fallback : Number(text);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function readPort(value, fallback, name) {
  const port = readPositiveInteger(value, fallback, name);
  if (port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export const config = {
  // Express/API port. Defaults to 4000, not PostgreSQL's port.
  port: readPort(process.env.PORT, 4000, 'PORT'),
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    url: process.env.DATABASE_URL,
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    name: process.env.DB_NAME || 'Dwellvibes',
    password: process.env.DB_PASS,
    // PostgreSQL's usual port is independent from the Express API port.
    port: readPort(process.env.DB_PORT, 5432, 'DB_PORT'),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS || 30),
  },
  otp: {
    ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
    length: 6,
    maxAttempts: 5,
    devReturn: process.env.OTP_DEV_RETURN === 'true',
  },
  termii: {
    apiKey: process.env.TERMII_API_KEY,
    senderId: process.env.TERMII_SENDER_ID || 'RentSafe',
    baseUrl: process.env.TERMII_BASE_URL || 'https://api.ng.termii.com',
  },
  kyc: {
    provider: process.env.KYC_PROVIDER || 'mock',
    dojah: {
      appId: process.env.DOJAH_APP_ID,
      apiKey: process.env.DOJAH_APP_KEY,
      baseUrl: process.env.DOJAH_BASE_URL || 'https://api.dojah.io',
    },
    prembly: {
      appId: process.env.PREMBLY_APP_ID,
      apiKey: process.env.PREMBLY_API_KEY,
      baseUrl: process.env.PREMBLY_BASE_URL || 'https://api.prembly.com',
    },
  },
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    baseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxBytes: readPositiveInteger(process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024, 'UPLOAD_MAX_BYTES'),
  },


  bookings: {
    paymentWindowMinutes: Number(process.env.BOOKING_PAYMENT_WINDOW_MIN || 30),
    checkinReminderHours: [24, 1],           // reminder offsets
    releaseDelayHours: 24,                   // after check_in_date
    platformFeePercent: 15.5,
    cancellationPolicies: {
      flexible: { refundBeforeHours: 24, refundPct: 100 },
      moderate: { refundBeforeHours: 120, refundPct: 100 },
      strict:   { refundBeforeHours: 168, refundPct: 50 },
    },
  },
};
