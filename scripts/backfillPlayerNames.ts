import { backfillPlayerDisplayNameCache } from '../src/services/playerDisplayNames';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const refreshAll = args.includes('--refresh-all');
  const dryRun = args.includes('--dry-run');
  if (args.some(argument => argument !== '--refresh-all' && argument !== '--dry-run')) {
    throw new Error('Usage: bun run names:backfill [--dry-run] [--refresh-all]');
  }

  console.log(`[player-names] starting ${dryRun ? 'dry run' : 'backfill'}${refreshAll ? ' (refresh all)' : ''}.`);
  const report = await backfillPlayerDisplayNameCache({
    refreshAll,
    dryRun,
    minDelayMs: 1_000,
    onStart: ({ totalPlayers, cachedPlayers, requested, batches }) => {
      console.log(`[player-names] found ${totalPlayers} player IDs; ${cachedPlayers} names cached.`);
      console.log(`[player-names] ${dryRun ? 'would query' : 'querying'} ${requested} IDs in ${batches} batches of up to 50.`);
    },
    onProgress: ({ completed, total, found }) => {
      console.log(`[player-names] API batch ${completed}/${total} complete; ${found} names fetched.`);
    },
  });
  const coverage = report.totalPlayers === 0
    ? '100.00'
    : ((report.cachedAfter / report.totalPlayers) * 100).toFixed(2);

  console.log(
    `[player-names] cache coverage: ${report.cachedAfter}/${report.totalPlayers} (${coverage}%).`,
  );
  console.log(`[player-names] ${dryRun ? 'would request' : 'requested'} ${report.requested}, fetched ${report.fetched}, ${report.missingAfter} names still missing.`);

  if (!dryRun && report.missingAfter > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('[player-names] backfill failed:', error);
  process.exitCode = 1;
});
