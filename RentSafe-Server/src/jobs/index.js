import { runEscrowRelease } from './escrowRelease.job.js';

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function startJobs() {
  setInterval(() => {
    runEscrowRelease().catch((err) =>
      console.error('[job] escrow-release crashed', err)
    );
  }, INTERVAL_MS);

  console.log('[jobs] escrow release scheduler started');
}