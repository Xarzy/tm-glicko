import { fetchMissingLeaderboards } from '../src/services/cotdIngestion';

let stopRequested = false;
process.on('SIGINT', () => {
  if (stopRequested) {
    console.log('\n[leaderboards] force exiting now...');
    process.exit(1);
  }
  console.log('\n[leaderboards] stop requested — finishing current challenge, then exiting...');
  stopRequested = true;
});

async function main() {
  console.log('[leaderboards] Starting challenge leaderboard fetch...');
  await fetchMissingLeaderboards(() => stopRequested);
  if (stopRequested) {
    console.log('[leaderboards] Exited cleanly.');
  } else {
    console.log('[leaderboards] Done fetching missing challenge leaderboards.');
  }
}

main();
