import { discoverAllCotdDays, processPendingDays } from '../src/services/cotdIngestion';

let stopRequested = false;
process.on('SIGINT', () => {
  console.log('\n[backfill] stop requested — finishing current batch, then exiting...');
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
      const count = await processPendingDays(20);
      totalProcessed += count;
      console.log(`[backfill] running total: ${totalProcessed} days processed`);
      if (count === 0) {
        console.log('[backfill] no pending days left — done');
        break;
      }
    }
    return;
  }

  console.log('Usage: bun run scripts/backfill.ts discover | process');
}

main();