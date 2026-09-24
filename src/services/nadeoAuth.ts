interface NadeoTokenResponse {
  accessToken: string;
  refreshToken: string;
}

const nadeoAuthEndpoint: string = "https://prod.trackmania.core.nadeo.online/v2/authentication/token/basic";

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchNadeoToken(): Promise<string> {
  const login = process.env.NADEO_SERVER_LOGIN!;
  const password = process.env.NADEO_SERVER_PASSWORD!;
  const basicAuth = Buffer.from(`${login}:${password}`).toString('base64');

  const res = await fetch(nadeoAuthEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
      'User-Agent': 'TM-Glicko Bot (contact: test@gmail.com)',
    },
    body: JSON.stringify({ audience: 'NadeoLiveServices' }),
  });

  if (!res.ok) throw new Error(`Nadeo auth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as NadeoTokenResponse;
  return data.accessToken;
}

export async function getNadeoToken(): Promise<string> {
  // Tokens are typically valid ~1hr — refresh proactively with margin rather than
  // waiting for a 401, since re-authing is cheap and this avoids losing a request mid-batch.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const token = await fetchNadeoToken();
  cachedToken = { value: token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

export function invalidateNadeoToken() {
  cachedToken = null;
}