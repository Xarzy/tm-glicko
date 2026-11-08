// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { afterAll, expect, test } from 'bun:test';

const originalWebsiteBaseUrl = process.env.WEBSITE_BASE_URL;
const { getCotdUrl, getPlayerProfileUrl } = await import('../src/services/discordWebLinks');

afterAll(() => {
  if (originalWebsiteBaseUrl === undefined) delete process.env.WEBSITE_BASE_URL;
  else process.env.WEBSITE_BASE_URL = originalWebsiteBaseUrl;
});

test('Discord links use the configured public website origin and encode account IDs', () => {
  process.env.WEBSITE_BASE_URL = 'https://ratings.example/some/path';

  expect(getPlayerProfileUrl('player/id')).toBe('https://ratings.example/players/player%2Fid');
  expect(getCotdUrl(12345)).toBe('https://ratings.example/cotd/12345');
});

test('Discord links are omitted when no public website is configured', () => {
  delete process.env.WEBSITE_BASE_URL;
  expect(getPlayerProfileUrl('player')).toBeNull();
  expect(getCotdUrl(12345)).toBeNull();
});

test('Discord link configuration must use HTTP or HTTPS', () => {
  process.env.WEBSITE_BASE_URL = 'javascript:alert(1)';
  expect(() => getPlayerProfileUrl('player')).toThrow('must use HTTP or HTTPS');
});
