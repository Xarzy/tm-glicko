function getWebsiteBaseUrl(): URL | null {
  const configuredUrl = process.env.WEBSITE_BASE_URL;
  if (!configuredUrl) return null;

  const url = new URL(configuredUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('WEBSITE_BASE_URL must use HTTP or HTTPS.');
  }
  return new URL(url.origin);
}

export function getPlayerProfileUrl(accountId: string): string | null {
  const baseUrl = getWebsiteBaseUrl();
  return baseUrl ? new URL(`/players/${encodeURIComponent(accountId)}`, baseUrl).toString() : null;
}

export function getCotdUrl(cupId: number): string | null {
  const baseUrl = getWebsiteBaseUrl();
  return baseUrl ? new URL(`/cotd/${cupId}`, baseUrl).toString() : null;
}
