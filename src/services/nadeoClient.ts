import { getNadeoToken, invalidateNadeoToken } from './nadeoAuth';

type QueuedRequest<T> = { run: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

const queue: QueuedRequest<any>[] = [];
let processing = false;
let cooldownUntil = 0;

// Deliberately conservative — no confirmed rate limit for this API/account type,
// so err toward "slow but safe" given the account-ban risk. Tune down only after
// watching real logs for a while with no 429s.
const MIN_DELAY_MS = 400;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const now = Date.now();
    if (now < cooldownUntil) await new Promise(r => setTimeout(r, cooldownUntil - now));
    const job = queue.shift()!;
    try {
      job.resolve(await job.run());
    } catch (error) {
      job.reject(error);
    }
    await new Promise(r => setTimeout(r, MIN_DELAY_MS));
  }
  processing = false;
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    processQueue();
  });
}

export async function nadeoGet<T>(url: string): Promise<T | null> {
  return enqueue(async () => {
    let token = await getNadeoToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      let res = await fetch(url, {
        headers: { Authorization: `nadeo_v1 t=${token}`, 'User-Agent': 'your-bot-name (contact: you@example.com)' },
        signal: controller.signal,
      });

      if (res.status === 401) {
        invalidateNadeoToken();
        token = await getNadeoToken();
        res = await fetch(url, {
          headers: { Authorization: `nadeo_v1 t=${token}`, 'User-Agent': 'your-bot-name (contact: you@example.com)' },
          signal: controller.signal,
        });
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        cooldownUntil = Date.now() + (retryAfter ? Number(retryAfter) * 1000 : 30_000);
        console.warn(`[nadeo] 429 on ${url}, cooling down`);
        return null;
      }

      if (res.status === 403) {
        // Worth surfacing loudly — 403 on an endpoint you expected to work could mean
        // dedicated-server tokens can't access it, distinct from a rate-limit issue.
        console.error(`[nadeo] 403 FORBIDDEN on ${url} — dedicated server token may lack access to this endpoint`);
        return null;
      }

      if (!res.ok) {
        console.error(`[nadeo] ${res.status} on ${url}`);
        return null;
      }

      return (await res.json()) as T;
    } catch (error) {
      console.error(`[nadeo] request failed for ${url}:`, error);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
}