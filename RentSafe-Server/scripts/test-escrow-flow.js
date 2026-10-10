import { query } from '../src/db.js';
import { initializeBookingCharge, markChargeSuccessful, confirmCheckIn, releaseEscrow } from '../src/services/escrow.service.js';

const guestId = process.argv[2];
const hostId  = process.argv[3];
const bookingId = process.argv[4];

// 1. Start charge
const init = await initializeBookingCharge({
  bookingId,
  guest: { id: guestId, email: 'guest@test.com', phone: '08000000001' },
});
console.log('→ open this URL:', init.authorizationUrl);

// 2. Wait for you to pay in the browser, then verify + mark successful
// (In dev, you can also call markChargeSuccessful directly with a fake reference)
const ref = init.reference;
const verified = await (await import('../src/services/paystack.service.js')).verifyCharge(ref);
if (verified.status === 'success') {
  await markChargeSuccessful({ reference: ref, paystackData: verified });
  console.log('✓ charge marked successful');
}

// 3. Simulate check-in (guest confirms)
await confirmCheckIn({ bookingId, userId: guestId, role: 'guest' });
console.log('✓ check-in confirmed');

// 4. Force release
const { rows } = await query(`SELECT id FROM escrow_holds WHERE booking_id = $1`, [bookingId]);
const result = await releaseEscrow(rows[0].id, { force: true });
console.log('✓ released:', result);

await (await import('../src/db.js')).pool.end();