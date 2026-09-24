import { getOAuthToken } from './trackmaniaOAuth';

export async function findAccountIdByUsername(username: string): Promise<string | null> {
  const token = await getOAuthToken();
  const url = `https://api.trackmania.com/api/display-names/account-ids?displayName[]=${encodeURIComponent(username)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'your-bot-name (contact: you@example.com)' },
    });
    if (!res.ok) return null;

    // ⚠️ Shape assumed as { [displayName]: accountId } — confirm against a real
    // response and adjust before trusting this in production.
    const data = (await res.json()) as Record<string, string>;
    return data[username] ?? null;
  } catch (error) {
    console.error(`[accountLookup] failed for "${username}":`, error);
    return null;
  }
}