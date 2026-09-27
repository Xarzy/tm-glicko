import { getOAuthToken } from './trackmaniaOAuth';

export async function findAccountIdByUsername(username: string): Promise<string | null> {
  const map = await findAccountIdsByUsernames([username]);
  return map.get(username.toLowerCase()) ?? null;
}

export async function findAccountIdsByUsernames(usernames: string[]): Promise<Map<string, string>> {
  if (usernames.length === 0) return new Map();
  const token = await getOAuthToken();
  const map = new Map<string, string>();

  // API accepts multiple displayName[]=name1&displayName[]=name2
  // Chunk by 50 to avoid URL length limits
  const CHUNK = 50;
  for (let i = 0; i < usernames.length; i += CHUNK) {
    const chunk = usernames.slice(i, i + CHUNK);
    const query = chunk.map(u => `displayName[]=${encodeURIComponent(u)}`).join('&');
    const url = `https://api.trackmania.com/api/display-names/account-ids?${query}`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'tm-glicko (contact: admin)' },
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, string>;
        for (const [name, id] of Object.entries(data)) {
          map.set(name.toLowerCase(), id);
        }
      }
    } catch (err) {
      console.error('[accountLookup] batch failed:', err);
    }
  }
  return map;
}
export async function findUsernamesByAccountIds(accountIds: string[]): Promise<Map<string, string>> {
  if (accountIds.length === 0) return new Map();
  const token = await getOAuthToken();
  const map = new Map<string, string>();

  const CHUNK = 50;
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const chunk = accountIds.slice(i, i + CHUNK);
    const query = chunk.map(id => `accountId[]=${encodeURIComponent(id)}`).join('&');
    const url = `https://api.trackmania.com/api/display-names?${query}`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'tm-glicko (contact: admin)' },
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, string>;
        for (const [id, name] of Object.entries(data)) {
          map.set(id, name);
        }
      }
    } catch (err) {
      console.error('[accountLookup] findUsernamesByAccountIds failed:', err);
    }
  }

  return map;
}

export async function findUsernameByAccountId(accountId: string): Promise<string | null> {
  const map = await findUsernamesByAccountIds([accountId]);
  return map.get(accountId) ?? null;
}