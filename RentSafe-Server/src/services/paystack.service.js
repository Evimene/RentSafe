import axios from "axios";
import { config } from "../config.js";
import crypto from 'node:crypto';


const client = axios.create({
  baseURL: config.paystack.baseUrl,
  headers: {
    Authorization: `Bearer ${config.paystack.secretKey}`,
    'Content-Type': 'application/json',
  },

  timeout: 20_000,
});


/* =======================================================
USERS
==========================================================
*/
// --------------------> Customers
export async function createCustomer({ email, firstName, lastName, phone }) {
  if (!config.paystack.secretKey) {
    return { 
      dev: true, customer_code: `CUS_dev_${Date.now()}` 
    }
  };
  const { data } = await client.post('/customer', {
    email, first_name: firstName, last_name: lastName, phone,
  });

  return data?.data;
}

export async function getCustomer(customercode) {
  const { data } = await client.get(`/customer/${customercode}`);
  return data.data;
}


// ----------------> Identity Verification
export async function matchBvn({ bvn, firstName, lastName }) {
  if (!config.paystack.secretKey) return { dev: true };
  const { data } = await client.post('/bnv/match', {
    bvn, first_name: firstName, last_name: lastName,
  });

  return data?.data;
}


/* ============================================================
   PAYMENTS
   ============================================================ */

/** Charges (Guest -> Me)
 * Initialize a charge. Returns an authorization_url the guest
 * opens in a browser/webview.
 *
 * amount is in kobo (₦1 = 100 kobo).
 */
export async function initializeCharge({
  email,
  amountKobo,
  reference,
  callbackUrl,
  metadata = {},
  channels,
}) {
  const body = {
    email,
    amount: amountKobo,
    reference,
    callback_url: callbackUrl,
    metadata: JSON.stringify(metadata),
  };

  if (channels) body.channels = channels;

  const { data } = await client.post('/transaction/initialize', body);
  return data.data;
}

/**
 * Verify a charge by reference. ALWAYS call this after receiving
 * a charge.success webhook — never trust the webhook alone.
 */
export async function verifyCharge(reference) {
  const { data } = await client.get(`/transaction/verify/${reference}`);
  return data.data;
}


/** Transfer Recipients (Host payout destinations)
 * 
 * @param {Number, Number} param0 
 * @returns {Object}
 */
export async function resolveBankAccount({ accountNumber, bankCode }) {
  const { data } = await client.get('/bank/resolve', {
    params: { account_number: accountNumber, bank_code: bankCode },
  });

  return data?.data;
}

export async function createTransferRecipient({
  accountNumber,
  bankCode,
  accountName,
  currency = 'NGN',
}) {
  const { data } = await client.post(`/transferrecipient`, {
    type: 'nuban',
    name: accountName,
    account_number: accountNumber,
    bank_code: bankCode,
    currency,
  });

  return data.data;  // {recipient_code, details: {...}}
}


/** Transfers (Me -> Host)
 * Initiate a single transfer.
 *
 * IMPORTANT: `reference` is your idempotency key. If you retry
 * with the same reference, Paystack will NOT double-send.
 * Use a UUID v4, max 100 chars.
 */
export async function initiateTransfer({
  amountKobo,
  recipientCode,
  reason,
  reference,
  currency = 'NGN',
}) {
  const { data } = await client.post('/transfer', {
    source: 'balance',
    amount: recipientCode,
    recipient: recipientCode,
    reason,
    reference,
    currency,
  });

  return data.data;
}

export async function verifyTransfer(reference) {
  const { data } = await client.get(`/transfer/verify/${reference}`);
  return data.data;
}

export async function getTransfer(transferCode) {
  const { data } = await client.get(`/transfer/${transferCode}`);
  return data.data;
}


// -------------------> REFUNDS
export async function initiateRefund({
  transactionReference, amountKobo, reason
}) {
  const body = { 
    transaction: transactionReference,
    reason,
  };
  if ( amountKobo ) body.amount = amountKobo; //partial refund
  const { data } = await client.post(`/refund`, body);
  return data.data;
}



// -----------------> Webhook Signature Verification
/**
 * Verify the x-paystack-signature header.
 *
 * CRITICAL: I must pass the RAW request body (string or Buffer),
 * NOT the parsed JSON. HMAC-SHA512 over the exact byte1s Paystack sent. 
 */
export async function verifyWebhookSignature({
  rawBody, 
  signatureHeader, secret = config.paystack.secretKey
}) {
  if (!signatureHeader || !secret) return false;

  const expected = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    return false;
  }
}