// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import type { SelectCotdDay, SelectPlayerRatingState } from '../src/db/schema';
import {
  escapeHtml,
  renderRatingChart,
  startWebServer,
} from '../src/services/webServer';
import type {
  WebsiteDataSource,
  WebsiteLeaderboardEntry,
  WebsitePlayerHistoryPoint,
  WebsitePlayerProfile,
} from '../src/services/websiteData';

const accountId = 'player-123';
const cotdDay: SelectCotdDay = {
  cupId: 20261015,
  cotdDate: '2026-10-15',
  competitionId: 42,
  name: 'Cup of the Day',
  startDate: new Date('2026-10-15T16:00:00Z'),
  qualifierChallengeId: 1001,
  cardinal: 128,
  processedAt: new Date('2026-10-15T18:00:00Z'),
};
const tier = {
  rank: {
    code: 'master-1',
    name: 'Master 1',
    shortName: 'M1',
    tierColor: 0x0099ff,
    svgColor: '#039be5',
    topPercent: 4 / 13,
    iconFile: 'm1.png',
  },
  division: 3,
  divisionRoman: 'III',
  topPercentage: 0.5,
  fullName: 'Master 1 Division III',
  iconPath: 'images/m1.png',
};
const state: SelectPlayerRatingState = {
  accountId,
  mode: 'qualifying',
  rating: 2600,
  rd: 50,
  vol: 0.06,
  matchCount: 20,
  peakRating: 2650,
  previousRating: 2590,
  lastProcessedCupId: cotdDay.cupId,
  lastRatedAt: new Date('2026-10-15T16:00:00Z'),
  lastFetchedAt: null,
  updatedAt: new Date('2026-10-15T18:00:00Z'),
};
const history: WebsitePlayerHistoryPoint[] = [{
  cupId: cotdDay.cupId,
  cotdDate: cotdDay.cotdDate,
  name: cotdDay.name,
  cardinal: cotdDay.cardinal,
  rank: 12,
  rating: 2600,
  ratingChange: 25.5,
}];
const rankedProfile: WebsitePlayerProfile = {
  status: 'ranked',
  username: 'Player <script>alert(1)</script>',
  state,
  rank: 1,
  total: 1,
  tier,
  topPercentageText: '0.1',
  peakRating: 2650,
  divisionEstimate: 2,
  history,
  rankBands: [{ rank: tier.rank, minRating: 0, maxRating: 5000 }],
};

const leaderboardEntry: WebsiteLeaderboardEntry = {
  accountId,
  username: 'Player <script>alert(1)</script>',
  rating: 2600,
  rank: 1,
  tier,
  previousRating: 2590,
};

function createDataSource(overrides: Partial<WebsiteDataSource> = {}): WebsiteDataSource {
  return {
    rankOptions: [{ code: 'master-1', label: 'Master 1' }],
    findAccountIdByUsername: async username => username === 'Player' ? accountId : null,
    getDisplayNames: async () => new Map(),
    getLeaderboardPage: async () => ({ entries: [leaderboardEntry], total: 1 }),
    getRecentProcessedCotdDays: async () => [cotdDay],
    getPlayerProfile: async () => rankedProfile,
    getCotdDetail: async () => ({
      day: cotdDay,
      results: [{ player: accountId, username: 'Player', rank: 12, score: 6000 }],
    }),
    ...overrides,
  };
}

async function withServer(
  data: WebsiteDataSource,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = startWebServer(0, data);
  try {
    await run(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}

test('serves a searchable, paginated leaderboard and recent COTDs', async () => {
  let requestedPage = 0;
  let requestedTier = '';
  const data = createDataSource({
    getLeaderboardPage: async (page, _limit, tierCode) => {
      requestedPage = page;
      requestedTier = tierCode ?? '';
      return { entries: [leaderboardEntry], total: 75 };
    },
  });

  await withServer(data, async baseUrl => {
    const response = await fetch(baseUrl);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Glicko Leaderboard');
    expect(html).toContain('Recent COTDs');
    expect(html).toContain('Cup of the Day');
    expect(html).toContain('Player &lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Filter competitive rank');
    expect(html).toContain('Next →');
    expect(html).toContain('id="initial-loader"');
    expect(html).toContain('id="page-content"');
    expect(html).toContain("classList.add('document-loading')");

    const stylesheet = await fetch(`${baseUrl}/assets/site.css`);
    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get('content-type')).toContain('text/css');
    const css = await stylesheet.text();
    expect(css).toContain('bg-\\[\\#10151e\\]');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('skeleton-shimmer');

    const navigationScript = await fetch(`${baseUrl}/assets/site.js`);
    expect(navigationScript.status).toBe(200);
    expect(navigationScript.headers.get('content-type')).toContain('text/javascript');
    expect(await navigationScript.text()).toContain('Loading page');
    expect(html).toContain('<script src="/assets/site.js" defer=""></script>');

    const secondPage = await fetch(`${baseUrl}/leaderboard?page=2&tier=master-1`);
    expect(secondPage.status).toBe(200);
    expect(requestedPage).toBe(2);
    expect(requestedTier).toBe('master-1');
  });
});

test('search redirects exact matches to shareable profiles and escapes misses', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const found = await fetch(`${baseUrl}/leaderboard?q=Player`, { redirect: 'manual' });
    expect(found.status).toBe(302);
    expect(found.headers.get('location')).toContain(`/players/${accountId}`);

    const missing = await fetch(`${baseUrl}/leaderboard?q=%3Cscript%3E`);
    const html = await missing.text();
    expect(missing.status).toBe(200);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

test('rejects excessive search and invalid pagination before data access', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const tooLong = await fetch(`${baseUrl}/leaderboard?q=${'a'.repeat(65)}`);
    expect(tooLong.status).toBe(400);

    const invalidPage = await fetch(`${baseUrl}/leaderboard?page=0`);
    expect(invalidPage.status).toBe(400);
    expect(await invalidPage.text()).toContain('Invalid page');

    const invalidTier = await fetch(`${baseUrl}/leaderboard?tier=unknown`);
    expect(invalidTier.status).toBe(400);
    expect(await invalidTier.text()).toContain('Invalid rank filter');
  });
});

test('renders ranked shareable profiles with rating history and placements', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const response = await fetch(`${baseUrl}/players/${accountId}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Leaderboard rank');
    expect(html).toContain('Eligible-era peak');
    expect(html).toContain('Rating history');
    expect(html).toContain('>M1</text>');
    expect(html).toContain('+25.5');
    expect(html).toContain('Division 2');
    expect(html).toContain('placement #12');
    expect(html).toContain('Player &lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

test('explains ineligible players and reports unknown player profiles', async () => {
  const data = createDataSource({
    getPlayerProfile: async id => id === 'unranked'
      ? { status: 'unranked', username: 'New Player', matchCount: 4 }
      : null,
  });
  await withServer(data, async baseUrl => {
    const unranked = await fetch(`${baseUrl}/players/unranked`);
    expect(unranked.status).toBe(404);
    expect(await unranked.text()).toContain('completing 10 COTDs');

    const missing = await fetch(`${baseUrl}/players/unknown`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('Player not found');
  });
});

test('lists recent COTDs and renders their placements', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const list = await fetch(`${baseUrl}/cotd`);
    expect(await list.text()).toContain(`/cotd/${cotdDay.cupId}`);

    const detail = await fetch(`${baseUrl}/cotd/${cotdDay.cupId}`);
    const html = await detail.text();
    expect(detail.status).toBe(200);
    expect(html).toContain('Placement');
    expect(html).toContain('Player');
    expect(html).toContain('6,000');
    expect(html).toContain('#12');
  });
});

test('displays when a COTD has no stored placement data', async () => {
  await withServer(createDataSource({
    getCotdDetail: async () => ({ day: cotdDay, results: [] }),
  }), async baseUrl => {
    const response = await fetch(`${baseUrl}/cotd/${cotdDay.cupId}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Placement data is unavailable');
  });
});

test('handles missing COTDs, invalid IDs, health checks, and unsupported methods', async () => {
  await withServer(createDataSource({
    getCotdDetail: async () => null,
  }), async baseUrl => {
    const missing = await fetch(`${baseUrl}/cotd/20261015`);
    expect(missing.status).toBe(404);

    const invalid = await fetch(`${baseUrl}/cotd/0`);
    expect(invalid.status).toBe(400);

    const health = await fetch(`${baseUrl}/health`);
    expect(await health.json()).toEqual({ status: 'ok' });

    const head = await fetch(baseUrl, { method: 'HEAD' });
    expect(head.status).toBe(200);

    const method = await fetch(baseUrl, { method: 'POST' });
    expect(method.status).toBe(405);

    const notFound = await fetch(`${baseUrl}/missing`);
    expect(notFound.status).toBe(404);
  });
});

test('serves linked terms of service and privacy policy pages', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const home = await fetch(baseUrl);
    const homeHtml = await home.text();
    expect(homeHtml).toContain('href="/terms">Terms of Service</a>');
    expect(homeHtml).toContain('href="/privacy">Privacy Policy</a>');

    const terms = await fetch(`${baseUrl}/terms`);
    const termsHtml = await terms.text();
    expect(terms.status).toBe(200);
    expect(termsHtml).toContain('>Terms of Service</h1>');
    expect(termsHtml).toContain('laws of Spain');
    expect(termsHtml).toContain('mailto:');

    const privacy = await fetch(`${baseUrl}/privacy`);
    const privacyHtml = await privacy.text();
    expect(privacy.status).toBe(200);
    expect(privacyHtml).toContain('>Privacy Policy</h1>');
    expect(privacyHtml).toContain('Discord account identifiers');
    expect(privacyHtml).toContain('Spanish Data Protection Agency (AEPD)');
    expect(privacyHtml).toContain('mailto:');
  });
});

test('escapes HTML and shows rating changes on hover without adding visible point markers', () => {
  expect(escapeHtml(`<img src=x onerror="bad">&`)).toBe('&lt;img src=x onerror=&quot;bad&quot;&gt;&amp;');
  expect(renderRatingChart([])).toContain('No eligible rating history');

  const chart = renderRatingChart([
    { ...history[0], cotdDate: '2026-01-01', rating: 1400, ratingChange: null },
    { ...history[0], cupId: 20260102, name: 'Final & <unsafe>', cotdDate: '2026-01-02', rating: 1500, ratingChange: 100 },
  ], [{
    rank: tier.rank,
    minRating: 1400,
    maxRating: 1500,
  }]);
  expect(chart).toContain('<svg');
  expect(chart).toContain('1,400');
  expect(chart).toContain('1,500');
  expect(chart).toContain('<title>2026-01-02 · Final &amp; &lt;unsafe&gt; · rating 1,500 · change +100.0</title>');
  expect(chart).toContain('fill="transparent" pointer-events="all"');
  expect(chart).toContain('>M1</text>');
  expect(chart).not.toContain('fill="#45c9b5" stroke="#10151e"');
  expect(chart).not.toContain('Every result');
  expect(chart).not.toContain('<script>');
});

test('web server binds to an ephemeral port and answers requests', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
  });
});
