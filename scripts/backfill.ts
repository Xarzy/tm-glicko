import { discoverAllCotdDays, processPendingDays } from '../src/services/cotdIngestion';

let stopRequested = false;
process.on('SIGINT', () => {
  if (stopRequested) {
    console.log('\n[backfill] force exiting now...');
    process.exit(1);
  }
  console.log('\n[backfill] stop requested — finishing current cup, then exiting...');
  stopRequested = true;
});

async function main() {
  const mode = process.argv[2]; // "discover" | "process"

  if (mode === 'discover') {
    await discoverAllCotdDays();
    return;
  }

  if (mode === 'process') {
    let totalProcessed = 0;
    console.log("starting process")
    while (!stopRequested) {
      const { processed } = await processPendingDays(20, () => stopRequested);
      totalProcessed += processed;
      console.log(`[backfill] running total: ${totalProcessed} days processed`);
      if (stopRequested) {
        console.log('[backfill] exited cleanly after current cup.');
        break;
      }
      if (processed === 0) {
        console.log('[backfill] no pending days left — done');
        break;
      }
    }
    return;
  }

  console.log('Usage: bun run scripts/backfill.ts discover | process');
}

main();