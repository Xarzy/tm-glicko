interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getOAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const res = await fetch('https://api.trackmania.com/api/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TRACKMANIA_OAUTH_CLIENT_ID!,
      client_secret: process.env.TRACKMANIA_OAUTH_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status}`);

  const data = (await res.json()) as OAuthTokenResponse;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}