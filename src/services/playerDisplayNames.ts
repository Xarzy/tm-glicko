import {
  getCachedPlayerDisplayNames,
  getAllPlayerAccountIds,
  getPlayerDisplayNameAccountIds,
  savePlayerDisplayNames,
} from '../db';
import { findUsernamesByAccountIds } from './accountLookup';

let warnedMissingTrackmaniaOAuth = false;

export interface PlayerDisplayNameCacheReport {
  totalPlayers: number;
  cachedBefore: number;
  requested: number;
  fetched: number;
  cachedAfter: number;
  missingAfter: number;
}

export interface PlayerDisplayNameBackfillOptions {
  refreshAll?: boolean;
  dryRun?: boolean;
  minDelayMs?: number;
  onStart?: (progress: { totalPlayers: number; cachedPlayers: number; requested: number; batches: number }) => void;
  onProgress?: (progress: { completed: number; total: number; found: number }) => void;
}

function hasTrackmaniaOAuth(): boolean {
  if (process.env.TRACKMANIA_OAUTH_CLIENT_ID && process.env.TRACKMANIA_OAUTH_CLIENT_SECRET) {
    return true;
  }
  if (!warnedMissingTrackmaniaOAuth) {
    console.warn('[player-names] Trackmania OAuth is not configured; display names cannot be refreshed.');
    warnedMissingTrackmaniaOAuth = true;
  }
  return false;
}

export async function backfillPlayerDisplayNameCache(
  {
    refreshAll = false,
    dryRun = false,
    minDelayMs = 0,
    onStart,
    onProgress,
  }: PlayerDisplayNameBackfillOptions = {},
): Promise<PlayerDisplayNameCacheReport> {
  if (!dryRun && !hasTrackmaniaOAuth()) {
    throw new Error('Set TRACKMANIA_OAUTH_CLIENT_ID and TRACKMANIA_OAUTH_CLIENT_SECRET to backfill player names.');
  }

  const [accountIds, cachedAccountIds] = await Promise.all([
    getAllPlayerAccountIds(),
    getPlayerDisplayNameAccountIds(),
  ]);
  const targets = refreshAll
    ? accountIds
    : accountIds.filter(accountId => !cachedAccountIds.has(accountId));
  onStart?.({
    totalPlayers: accountIds.length,
    cachedPlayers: accountIds.filter(accountId => cachedAccountIds.has(accountId)).length,
    requested: targets.length,
    batches: Math.ceil(targets.length / 50),
  });
  const fetchedNames = dryRun
    ? new Map<string, string>()
    : await refreshPlayerDisplayNames(targets, { minDelayMs, onProgress, throwOnError: true });
  const cachedAfter = dryRun ? cachedAccountIds : await getPlayerDisplayNameAccountIds();
  const cachedPlayers = accountIds.filter(accountId => cachedAfter.has(accountId)).length;

  return {
    totalPlayers: accountIds.length,
    cachedBefore: accountIds.filter(accountId => cachedAccountIds.has(accountId)).length,
    requested: targets.length,
    fetched: fetchedNames.size,
    cachedAfter: cachedPlayers,
    missingAfter: accountIds.length - cachedPlayers,
  };
}

export async function getDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
  const uniqueAccountIds = [...new Set(accountIds)];
  const names = await getCachedPlayerDisplayNames(uniqueAccountIds);
  const missingAccountIds = uniqueAccountIds.filter(accountId => !names.has(accountId));
  if (missingAccountIds.length === 0 || !hasTrackmaniaOAuth()) return names;

  const fetchedNames = await refreshPlayerDisplayNames(missingAccountIds);
  for (const [accountId, name] of fetchedNames) names.set(accountId, name);
  return names;
}

export async function refreshPlayerDisplayNames(
  accountIds: string[],
  {
    minDelayMs = 0,
    onProgress,
    throwOnError = false,
  }: {
    minDelayMs?: number;
    onProgress?: (progress: { completed: number; total: number; found: number }) => void;
    throwOnError?: boolean;
  } = {},
): Promise<Map<string, string>> {
  const uniqueAccountIds = [...new Set(accountIds)];
  if (uniqueAccountIds.length === 0 || !hasTrackmaniaOAuth()) return new Map();

  try {
    const names = await findUsernamesByAccountIds(uniqueAccountIds, {
      minDelayMs,
      onBatchComplete: onProgress,
      onBatchResults: async batchNames => {
        await savePlayerDisplayNames(
          [...batchNames].map(([accountId, displayName]) => ({ accountId, displayName })),
        );
      },
    });
    if (names.size < uniqueAccountIds.length) {
      console.warn(
        `[player-names] refreshed ${names.size} of ${uniqueAccountIds.length} requested display names; existing names were retained.`,
      );
    }
    return names;
  } catch (error) {
    console.error('[player-names] display-name refresh failed; existing names were retained:', error);
    if (throwOnError) throw error;
    return new Map();
  }
}

export async function syncMissingPlayerDisplayNames(): Promise<void> {
  if (!hasTrackmaniaOAuth()) return;

  const report = await backfillPlayerDisplayNameCache();
  if (report.requested === 0) {
    console.log(`[player-names] all ${report.totalPlayers} player names are already cached.`);
    return;
  }

  console.log(
    `[player-names] backfill fetched ${report.fetched} of ${report.requested} names; ` +
    `${report.cachedAfter}/${report.totalPlayers} cached, ${report.missingAfter} missing.`,
  );
}
