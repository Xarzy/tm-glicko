import { discoverNewCotdDays, processPendingDays } from '../services/cotdIngestion';

export async function runDailyUpdate() {
  const newDays = await discoverNewCotdDays();
  console.log(`[daily] discovered ${newDays} new day(s)`);

  let total = 0;
  while (true) {
    const { processed } = await processPendingDays(20);
    total += processed;
    if (processed === 0) break;
  }
  console.log(`[daily] processed ${total} day(s)`);
}