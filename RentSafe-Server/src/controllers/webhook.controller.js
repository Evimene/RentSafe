import { query, withTransaction } from '../db.js';
import { verifyWebhookSignature } from '../services/paystack.service.js';
import { markChargeSuccessful } from '../services/escrow.service.js';

export async function paystackWebhook(req, res) {
  const signature = req.headers['x-paystack-signature'];
  const rawBody = req.rawBody;

  // 1. Verify signature FIRST
  const valid = verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    console.warn('[webhook] invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event.event;
  const data = event.data || {};

  // 2. Idempotency: dedupe on event_type + reference
  const reference =
    data.reference || data.transfer_code || data.transfer?.reference || null;

  const { rows: dup } = await query(
    `SELECT id FROM paystack_webhook_events
     WHERE event_type = $1 AND reference = $2 LIMIT 1`,
    [eventType, reference]
  );
  if (dup[0]) return res.json({ status: 'duplicate_ignored' });

  // 3. Log the event
  const { rows: evRows } = await query(
    `INSERT INTO paystack_webhook_events
       (event_type, reference, payload, signature_valid, processed)
     VALUES ($1, $2, $3, TRUE, FALSE)
     RETURNING *`,
    [eventType, reference, event]
  );
  const eventRow = evRows[0];

  // 4. Respond to Paystack immediately (it expects 200 within ~10s)
  res.json({ status: 'received' });

  // 5. Process asynchronously
  processEvent(eventType, data, eventRow.id).catch((err) =>
    console.error('[webhook] process error', err)
  );
}

async function processEvent(eventType, data, eventRowId) {
  try {
    switch (eventType) {
      case 'charge.success':
        await handleChargeSuccess(data);
        break;
      case 'transfer.success':
        await handleTransferSuccess(data);
        break;
      case 'transfer.failed':
      case 'transfer.reversed':
        await handleTransferFailure(data);
        break;
      case 'refund.processed':
        await handleRefundProcessed(data);
        break;
      default:
        console.log('[webhook] unhandled event', eventType);
    }

    await query(
      `UPDATE paystack_webhook_events
       SET processed = TRUE, processed_at = NOW()
       WHERE id = $1`,
      [eventRowId]
    );
  } catch (err) {
    await query(
      `UPDATE paystack_webhook_events SET error = $1 WHERE id = $2`,
      [err.message, eventRowId]
    );
    throw err;
  }
}

async function handleChargeSuccess(data) {
  const reference = data.reference;

  // ALWAYS re-verify with Paystack — never trust the webhook alone
  const { verifyCharge } = await import('../services/paystack.service.js');
  const verified = await verifyCharge(reference);
  if (verified.status !== 'success') {
    console.warn('[webhook] charge not actually successful', reference);
    return;
  }

  // Verify amount matches what we expected (prevents partial-amount fraud)
  const { rows } = await query(
    `SELECT amount_kobo FROM escrow_holds WHERE paystack_reference = $1`,
    [reference]
  );
  if (!rows[0]) {
    console.warn('[webhook] no escrow for reference', reference);
    return;
  }
  if (Number(verified.amount) !== Number(rows[0].amount_kobo)) {
    console.error('[webhook] amount mismatch', {
      expected: rows[0].amount_kobo,
      received: verified.amount,
    });
    return;
  }

  await markChargeSuccessful({ reference, paystackData: verified });
}

async function handleTransferSuccess(data) {
  const reference = data.reference || data.transfer_code;
  await query(
    `UPDATE payouts
     SET status = 'success',
         completed_at = NOW(),
         webhook_payload = $1,
         updated_at = NOW()
     WHERE transfer_reference = $2 AND status IN ('pending','processing')`,
    [data, reference]
  );
}

async function handleTransferFailure(data) {
  const reference = data.reference || data.transfer_code;
  await query(
    `UPDATE payouts
     SET status = 'failed',
         failure_reason = $1,
         webhook_payload = $2,
         updated_at = NOW()
     WHERE transfer_reference = $3 AND status IN ('pending','processing')`,
    [data.message || 'Transfer failed', data, reference]
  );
  // TODO: notify host; optionally re-queue retry
}

async function handleRefundProcessed(data) {
  const reference = data.transaction?.reference || data.reference;
  await query(
    `UPDATE escrow_holds
     SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
     WHERE paystack_reference = $1 AND status = 'holding'`,
    [reference]
  );
}