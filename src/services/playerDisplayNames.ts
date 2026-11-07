import {
  getCachedPlayerDisplayNames,
  getAllPlayerAccountIds,
  getPlayerDisplayNameAccountIds,
  savePlayerDisplayNames,
} from '../db';
import { findUsernamesByAccountIds } from './accountLookup';

let warnedMissingTrackmaniaOAuth = false;

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

export async function getDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
  const uniqueAccountIds = [...new Set(accountIds)];
  const names = await getCachedPlayerDisplayNames(uniqueAccountIds);
  const missingAccountIds = uniqueAccountIds.filter(accountId => !names.has(accountId));
  if (missingAccountIds.length === 0 || !hasTrackmaniaOAuth()) return names;

  const fetchedNames = await refreshPlayerDisplayNames(missingAccountIds);
  for (const [accountId, name] of fetchedNames) names.set(accountId, name);
  return names;
}

export async function refreshPlayerDisplayNames(accountIds: string[]): Promise<Map<string, string>> {
  const uniqueAccountIds = [...new Set(accountIds)];
  if (uniqueAccountIds.length === 0 || !hasTrackmaniaOAuth()) return new Map();

  try {
    const names = await findUsernamesByAccountIds(uniqueAccountIds);
    await savePlayerDisplayNames([...names].map(([accountId, displayName]) => ({ accountId, displayName })));
    if (names.size < uniqueAccountIds.length) {
      console.warn(
        `[player-names] refreshed ${names.size} of ${uniqueAccountIds.length} requested display names; existing names were retained.`,
      );
    }
    return names;
  } catch (error) {
    console.error('[player-names] display-name refresh failed; existing names were retained:', error);
    return new Map();
  }
}

export async function syncMissingPlayerDisplayNames(): Promise<void> {
  if (!hasTrackmaniaOAuth()) return;

  const [accountIds, cachedAccountIds] = await Promise.all([
    getAllPlayerAccountIds(),
    getPlayerDisplayNameAccountIds(),
  ]);
  const missingAccountIds = accountIds.filter(accountId => !cachedAccountIds.has(accountId));
  if (missingAccountIds.length === 0) {
    console.log(`[player-names] all ${accountIds.length} player names are already cached.`);
    return;
  }

  console.log(`[player-names] backfilling display names for ${missingAccountIds.length} players.`);
  const names = await refreshPlayerDisplayNames(missingAccountIds);
  console.log(`[player-names] backfill fetched ${names.size} of ${missingAccountIds.length} display names.`);
}
