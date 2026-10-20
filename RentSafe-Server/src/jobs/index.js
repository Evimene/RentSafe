import { runEscrowRelease } from './escrowRelease.job.js';
import { runInspectionExpiry } from './inspectionExpiry.job.js';

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function startJobs() {
  setInterval(() => {
    runEscrowRelease().catch((err) =>
      console.error('[job] escrow-release crashed', err)
    );
  }, INTERVAL_MS);

  console.log('[jobs] escrow release scheduler started');
}

// Run daily
setInterval(() => {
  runInspectionExpiry().catch((err) => console.error('[job] inspection-expiry crashed', err));
}, 24 * 60 * 60 * 1000);