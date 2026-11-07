import { getOAuthToken } from './trackmaniaOAuth';

interface FindUsernamesOptions {
  minDelayMs?: number;
  onBatchComplete?: (progress: { completed: number; total: number; found: number }) => void;
  onBatchResults?: (names: Map<string, string>) => Promise<void>;
}

function getRetryAfterMs(value: string | null, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? fallbackMs : Math.max(0, retryAt - Date.now());
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

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
export async function findUsernamesByAccountIds(
  accountIds: string[],
  { minDelayMs = 0, onBatchComplete, onBatchResults }: FindUsernamesOptions = {},
): Promise<Map<string, string>> {
  if (accountIds.length === 0) return new Map();
  const token = await getOAuthToken();
  const map = new Map<string, string>();

  const CHUNK = 50;
  const totalBatches = Math.ceil(accountIds.length / CHUNK);
  let retries = 0;
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    if (i > 0 && minDelayMs > 0) await delay(minDelayMs);
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
        await onBatchResults?.(new Map(Object.entries(data)));
        retries = 0;
      } else {
        if (res.status !== 429 || retries >= 4) {
          throw new Error(
            `Trackmania display-name batch ${Math.floor(i / CHUNK) + 1}/${totalBatches} failed with HTTP ${res.status}.`,
          );
        }
        const retryDelayMs = getRetryAfterMs(res.headers.get('Retry-After'), 60_000 * 2 ** retries);
        retries++;
        console.warn(
          `[accountLookup] display-name batch ${Math.floor(i / CHUNK) + 1}/${totalBatches} received HTTP 429; retrying in ${Math.ceil(retryDelayMs / 1000)}s (retry ${retries}/4).`,
        );
        await delay(retryDelayMs);
        i -= CHUNK;
        continue;
      }
    } catch (err) {
      throw err;
    }
    onBatchComplete?.({
      completed: Math.floor(i / CHUNK) + 1,
      total: totalBatches,
      found: map.size,
    });
  }

  return map;
}

export async function findUsernameByAccountId(accountId: string): Promise<string | null> {
  const map = await findUsernamesByAccountIds([accountId]);
  return map.get(accountId) ?? null;
}