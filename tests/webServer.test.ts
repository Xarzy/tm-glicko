// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import type { SelectCotdDay, SelectPlayerRatingState } from '../src/db/schema';
import {
  escapeHtml,
  renderRatingChart,
  startWebServer,
} from '../src/services/website/server';
import type {
  WebsiteDataSource,
  WebsiteDuelCupResult,
  WebsiteLeaderboardEntry,
  WebsitePlayerHistoryPoint,
  WebsitePlayerProfile,
} from '../src/services/website/data';

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
    getLatestProcessedCotdAt: async () => cotdDay.processedAt,
    getDailyUpdateStatus: async () => ({
      latestRun: {
        id: 1,
        status: 'succeeded',
        startedAt: cotdDay.processedAt!,
        completedAt: cotdDay.processedAt!,
      },
      lastSuccessfulRun: {
        id: 1,
        status: 'succeeded',
        startedAt: cotdDay.processedAt!,
        completedAt: cotdDay.processedAt!,
      },
    }),
    findAccountIdByUsername: async username => username === 'Player' ? accountId : null,
    searchPlayerSuggestions: async (query, limit) => 'Player'.toLowerCase().includes(query.toLowerCase())
      ? [{ accountId, username: 'Player', rating: 2600, rank: 1 }].slice(0, limit)
      : [],
    getDisplayNames: async () => new Map(),
    getLeaderboardPage: async () => ({ entries: [leaderboardEntry], total: 1 }),
    getRecentProcessedCotdDays: async () => [cotdDay],
    getPlayerProfile: async () => rankedProfile,
    getPlayerCotdResults: async (_accountId, page, limit) => ({
      results: history.slice().reverse()
        .slice((page - 1) * limit, page * limit)
        .map(({ cupId, cotdDate, name, rank, rating, ratingChange }) =>
          ({ cupId, cotdDate, name, rank, rating, ratingChange })),
      total: history.length,
    }),
    getDuelCupResults: async (_firstAccountId, _secondAccountId, page, limit) => ({
      results: [],
      total: 0,
      firstWins: 0,
      secondWins: 0,
      draws: 0,
    }),
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

function fetchPage(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'TM-Glicko-Navigation');
  return fetch(url, { ...init, headers });
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
    const initialResponse = await fetch(baseUrl);
    const initialHtml = await initialResponse.text();
    expect(initialResponse.status).toBe(200);
    expect(initialHtml).toContain('data-initial-load="true"');
    expect(initialHtml).toContain('id="initial-loader"');
    expect(initialHtml).not.toContain('Glicko Leaderboard');

    const response = await fetchPage(baseUrl);
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
    expect(stylesheet.headers.get('cache-control')).toBe('no-cache');
    const css = await stylesheet.text();
    expect(css).toContain('bg-\\[\\#10151e\\]');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('skeleton-shimmer');
    expect(css).toContain('.duel-fields{');
    expect(css).toContain('.duel-submit{');

    const navigationScript = await fetch(`${baseUrl}/assets/site.js`);
    expect(navigationScript.status).toBe(200);
    expect(navigationScript.headers.get('content-type')).toContain('text/javascript');
    expect(navigationScript.headers.get('cache-control')).toBe('no-cache');
    const navigationJs = await navigationScript.text();
    expect(navigationJs).toContain('Loading page');
    expect(navigationJs).toContain('data-pagination-content');
    expect(navigationJs).toContain('link.dataset.paginationTarget');
    expect(navigationJs).toContain('link.dataset.paginationFetchUrl');
    expect(navigationJs).toContain('paginationFetchUrl: requestUrl.href');
    expect(navigationJs).toContain('navigator.clipboard.writeText(window.location.href)');
    expect(navigationJs).toContain('Profile link copied to clipboard.');
    expect(html).toContain('<script src="/assets/site.js" defer=""></script>');

    const secondPage = await fetchPage(`${baseUrl}/leaderboard?page=2&tier=master-1`);
    expect(secondPage.status).toBe(200);
    expect(requestedPage).toBe(2);
    expect(requestedTier).toBe('master-1');
  });
});

test('shows latest COTD processing time and warns when data may be stale', async () => {
  const recentUpdate = new Date(Date.now() - 60 * 60 * 1_000);
  const staleUpdate = new Date(Date.now() - 48 * 60 * 60 * 1_000);

  await withServer(createDataSource({
    getLatestProcessedCotdAt: async () => recentUpdate,
    getDailyUpdateStatus: async () => ({
      latestRun: { id: 1, status: 'succeeded', startedAt: recentUpdate, completedAt: recentUpdate },
      lastSuccessfulRun: { id: 1, status: 'succeeded', startedAt: recentUpdate, completedAt: recentUpdate },
    }),
  }), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard`);
    const html = await response.text();
    expect(html).toContain('Latest processed COTD');
    expect(html).toContain(recentUpdate.toISOString());
    expect(html).toContain('UTC');
    expect(html).toContain('The last daily update succeeded.');
    expect(html).toContain('Last successful update');
    expect(html).not.toContain('No successful daily update');
  });

  await withServer(createDataSource({
    getLatestProcessedCotdAt: async () => staleUpdate,
    getDailyUpdateStatus: async () => ({
      latestRun: { id: 2, status: 'succeeded', startedAt: staleUpdate, completedAt: staleUpdate },
      lastSuccessfulRun: { id: 2, status: 'succeeded', startedAt: staleUpdate, completedAt: staleUpdate },
    }),
  }), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard`);
    expect(await response.text()).toContain('Last successful update is over 36 hours old');
  });

  await withServer(createDataSource({
    getLatestProcessedCotdAt: async () => recentUpdate,
    getDailyUpdateStatus: async () => ({
      latestRun: { id: 2, status: 'running', startedAt: recentUpdate, completedAt: null },
      lastSuccessfulRun: { id: 1, status: 'succeeded', startedAt: recentUpdate, completedAt: recentUpdate },
    }),
  }), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard`);
    expect(await response.text()).toContain('A daily update is currently running.');
  });

  await withServer(createDataSource({
    getLatestProcessedCotdAt: async () => staleUpdate,
    getDailyUpdateStatus: async () => ({
      latestRun: { id: 2, status: 'running', startedAt: staleUpdate, completedAt: null },
      lastSuccessfulRun: { id: 1, status: 'succeeded', startedAt: staleUpdate, completedAt: staleUpdate },
    }),
  }), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard`);
    const html = await response.text();
    expect(html).toContain('A daily update has been running for over 36 hours.');
    expect(html).toContain('Last successful update is over 36 hours old');
  });

  await withServer(createDataSource({
    getLatestProcessedCotdAt: async () => staleUpdate,
    getDailyUpdateStatus: async () => ({
      latestRun: { id: 2, status: 'failed', startedAt: staleUpdate, completedAt: staleUpdate },
      lastSuccessfulRun: { id: 1, status: 'succeeded', startedAt: recentUpdate, completedAt: recentUpdate },
    }),
  }), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard`);
    const html = await response.text();
    expect(html).toContain('The last daily update failed.');
    expect(html).toContain('Last successful update ·');
    expect(html).toContain(recentUpdate.toISOString());
  });

  await withServer(createDataSource({
    getLatestProcessedCotdAt: async () => null,
    getDailyUpdateStatus: async () => ({ latestRun: null, lastSuccessfulRun: null }),
  }), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard`);
    const html = await response.text();
    expect(html).toContain('No processed COTD data is available yet.');
    expect(html).toContain('No daily update has been recorded.');
    expect(html).toContain('No successful daily update has been recorded.');
  });
});

test('serves the page shell before waiting for leaderboard data', async () => {
  let releaseLeaderboard!: () => void;
  let startLeaderboard!: () => void;
  let dataCalls = 0;
  const leaderboardStarted = new Promise<void>(resolve => {
    startLeaderboard = resolve;
  });
  const data = createDataSource({
    getLeaderboardPage: async () => {
      dataCalls += 1;
      startLeaderboard();
      await new Promise<void>(resolve => {
        releaseLeaderboard = resolve;
      });
      return { entries: [leaderboardEntry], total: 1 };
    },
    getRecentProcessedCotdDays: async () => {
      dataCalls += 1;
      return [cotdDay];
    },
    getPlayerProfile: async () => {
      dataCalls += 1;
      return rankedProfile;
    },
    getCotdDetail: async () => {
      dataCalls += 1;
      return { day: cotdDay, results: [] };
    },
  });

  await withServer(data, async baseUrl => {
    for (const path of ['/', '/leaderboard', '/duel', '/cotd', `/players/${accountId}`, `/cotd/${cotdDay.cupId}`]) {
      const initial = await fetch(`${baseUrl}${path}`);
      const initialHtml = await initial.text();
      expect(initial.status).toBe(200);
      expect(initialHtml).toContain('data-initial-load="true"');
    }
    expect(dataCalls).toBe(0);

    let responseReady = false;
    const pageContent = fetchPage(baseUrl)
      .then(response => response.text())
      .then(html => {
        responseReady = true;
        return html;
      });
    await leaderboardStarted;
    expect(responseReady).toBe(false);

    releaseLeaderboard();
    expect(await pageContent).toContain('Glicko Leaderboard');
  });
});

test('compares exact-match players using their shared COTD placements', async () => {
  const sharedResults: WebsiteDuelCupResult[] = [
    { cupId: 3, cotdDate: '2026-10-17', name: 'Cup 3', firstRank: 4, secondRank: 10 },
    { cupId: 2, cotdDate: '2026-10-16', name: 'Cup 2', firstRank: 12, secondRank: 7 },
    { cupId: 1, cotdDate: '2026-10-15', name: 'Cup 1', firstRank: 1, secondRank: 1 },
  ];
  const data = createDataSource({
    findAccountIdByUsername: async username => username === 'First'
      ? 'first-account'
      : username === 'Second' ? 'second-account' : null,
    getDisplayNames: async ids => new Map(ids.map(id => [
      id,
      id === 'first-account' ? 'First Player' : 'Second Player',
    ])),
    getDuelCupResults: async (_firstAccountId, _secondAccountId, page, limit) => ({
      results: sharedResults.slice((page - 1) * limit, page * limit),
      total: sharedResults.length,
      firstWins: 1,
      secondWins: 1,
      draws: 1,
    }),
  });

  await withServer(data, async baseUrl => {
    const form = await fetchPage(`${baseUrl}/duel`);
    const formHtml = await form.text();
    expect(form.status).toBe(200);
    expect(formHtml).toContain('name="player1"');
    expect(formHtml).toContain('name="player2"');
    expect(formHtml).toContain('class="duel-form panel"');
    expect(formHtml).toContain('class="duel-form-vs"');

    const response = await fetchPage(`${baseUrl}/duel?player1=First&player2=Second`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('First Player vs Second Player');
    expect(html).toContain('class="duel-hero duel-result-hero"');
    expect(html).toContain('class="duel-score">1 <span>–</span> 1</span>');
    expect(html).toContain('>1 tied cup</span>');
    expect(html).toContain('3 shared cups');
    expect(html).toContain('Cup 3');
    expect(html).toContain('First Player');
    expect(html).toContain('Second Player');
  });
});

test('paginates duel COTDs while keeping the overall record and player names', async () => {
  const allResults: WebsiteDuelCupResult[] = Array.from({ length: 21 }, (_, index) => ({
    cupId: 300 - index,
    cotdDate: `2026-10-${String(21 - index).padStart(2, '0')}`,
    name: `Cup ${21 - index}`,
    firstRank: index < 12 ? 1 : 2,
    secondRank: index < 12 ? 2 : 1,
  }));
  const data = createDataSource({
    findAccountIdByUsername: async username => username === 'First'
      ? 'first-account'
      : username === 'Second' ? 'second-account' : null,
    getDuelCupResults: async (_firstAccountId, _secondAccountId, page, limit) => ({
      results: allResults.slice((page - 1) * limit, page * limit),
      total: allResults.length,
      firstWins: 12,
      secondWins: 9,
      draws: 0,
    }),
  });

  await withServer(data, async baseUrl => {
    const firstPage = await fetchPage(`${baseUrl}/duel?player1=First&player2=Second`);
    const firstHtml = await firstPage.text();
    expect(firstHtml).toContain('>12 <span>–</span> 9</span>');
    expect(firstHtml).toContain('Page 1 of 2');
    expect(firstHtml).toContain('page=2');
    expect(firstHtml).toContain('Cup 21');
    expect(firstHtml).not.toContain('Cup 1</a>');

    const secondPage = await fetchPage(`${baseUrl}/duel?player1=First&player2=Second&page=2`);
    const secondHtml = await secondPage.text();
    expect(secondHtml).toContain('>12 <span>–</span> 9</span>');
    expect(secondHtml).toContain('Page 2 of 2');
    expect(secondHtml).toContain('page=1');
    expect(secondHtml).toContain('Cup 1</a>');
  });
});

test('handles invalid and unmatched duel players and redirects out-of-range pages', async () => {
  const data = createDataSource({
    findAccountIdByUsername: async username => {
      if (username === 'Missing first' || username === 'Missing second') return null;
      if (username === 'Same first' || username === 'Same second') return 'same-account';
      if (username === 'First') return 'first-account';
      if (username === 'Second') return 'second-account';
      return null;
    },
    getDuelCupResults: async () => ({
      results: [],
      total: 21,
      firstWins: 0,
      secondWins: 0,
      draws: 0,
    }),
  });

  await withServer(data, async baseUrl => {
    const tooLong = await fetchPage(`${baseUrl}/duel?player1=${'a'.repeat(65)}&player2=Second`);
    expect(tooLong.status).toBe(400);
    expect(await tooLong.text()).toContain('Player name is too long');

    const missingFirst = await fetchPage(`${baseUrl}/duel?player1=Missing%20first&player2=Second`);
    expect(missingFirst.status).toBe(200);
    expect(await missingFirst.text()).toContain('No exact Trackmania username match for “Missing first”');

    const missingSecond = await fetchPage(`${baseUrl}/duel?player1=First&player2=Missing%20second`);
    expect(missingSecond.status).toBe(200);
    expect(await missingSecond.text()).toContain('No exact Trackmania username match for “Missing second”');

    const samePlayer = await fetchPage(`${baseUrl}/duel?player1=Same%20first&player2=Same%20second`);
    expect(samePlayer.status).toBe(200);
    expect(await samePlayer.text()).toContain('Choose two different players to start a duel.');

    const outOfRange = await fetchPage(
      `${baseUrl}/duel?player1=First&player2=Second&page=99`,
      { redirect: 'manual' },
    );
    expect(outOfRange.status).toBe(302);
    expect(outOfRange.headers.get('location')).toContain('page=2');
  });
});

test('search redirects exact matches to shareable profiles and escapes misses', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const found = await fetchPage(`${baseUrl}/leaderboard?q=Player`, { redirect: 'manual' });
    expect(found.status).toBe(302);
    expect(found.headers.get('location')).toBe(`/players/${accountId}`);

    const missing = await fetchPage(`${baseUrl}/leaderboard?q=%3Cscript%3E`);
    const html = await missing.text();
    expect(missing.status).toBe(200);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

test('suggests partial player-name matches after exact lookup misses', async () => {
  let suggestionQuery = '';
  let suggestionCalls = 0;
  const data = createDataSource({
    searchPlayerSuggestions: async (query, limit) => {
      suggestionCalls += 1;
      suggestionQuery = query;
      return [{ accountId, username: 'Player Name', rating: 2_600, rank: 12 }].slice(0, limit);
    },
  });

  await withServer(data, async baseUrl => {
    const response = await fetchPage(`${baseUrl}/leaderboard?q=lay`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(suggestionQuery).toBe('lay');
    expect(html).toContain('aria-label="Player search suggestions"');
    expect(html).toContain('Player Name');
    expect(html).toContain('#12');
    expect(html).toContain('href="/players/player-123"');
    expect(html).toContain('cached names first');
    expect(html).toContain('250 highest-rated eligible players');

    const shortQuery = await fetchPage(`${baseUrl}/leaderboard?q=p`);
    expect(await shortQuery.text()).toContain('No exact Trackmania username match for “p”.');
    expect(suggestionCalls).toBe(1);
  });
});

test('rejects excessive search and invalid pagination before data access', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const tooLong = await fetchPage(`${baseUrl}/leaderboard?q=${'a'.repeat(65)}`);
    expect(tooLong.status).toBe(400);

    const invalidPage = await fetchPage(`${baseUrl}/leaderboard?page=0`);
    expect(invalidPage.status).toBe(400);
    expect(await invalidPage.text()).toContain('Invalid page');

    const invalidTier = await fetchPage(`${baseUrl}/leaderboard?tier=unknown`);
    expect(invalidTier.status).toBe(400);
    expect(await invalidTier.text()).toContain('Invalid rank filter');

    const invalidDuelPage = await fetchPage(`${baseUrl}/duel?player1=First&player2=Second&page=0`);
    expect(invalidDuelPage.status).toBe(400);
    expect(await invalidDuelPage.text()).toContain('Invalid page');

    const invalidProfilePage = await fetchPage(`${baseUrl}/players/${accountId}?page=1.5`);
    expect(invalidProfilePage.status).toBe(400);
    expect(await invalidProfilePage.text()).toContain('Invalid page');
  });
});

test('renders ranked shareable profiles with rating history and placements', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const response = await fetchPage(`${baseUrl}/players/${accountId}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Leaderboard rank');
    expect(html).toContain('class="player-card"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Division III progress"');
    expect(html).toContain('Top percentile');
    expect(html).toContain('Eligible-era peak');
    expect(html).toContain('Rating history');
    expect(html).toContain('data-copy-page-link');
    expect(html).toContain('Share profile');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('share this page');
    expect(html).toContain('>M1</text>');
    expect(html).toContain('+25.5');
    expect(html).toContain('Division 2');
    expect(html).toContain('placement #12');
    expect(html).toContain('Player &lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

test('shows rating pace across the five most recent eligible COTDs on the player card', async () => {
  const paceHistory = [100, 5, -2, 10, 1, -3].map((ratingChange, index) => ({
    ...history[0],
    cupId: history[0].cupId - 5 + index,
    rating: 2500 + index,
    ratingChange,
  }));
  const data = createDataSource({
    getPlayerProfile: async () => ({ ...rankedProfile, history: paceHistory }),
  });

  await withServer(data, async baseUrl => {
    const response = await fetchPage(`${baseUrl}/players/${accountId}`);
    const html = await response.text();

    expect(html).toContain('Recent pace');
    expect(html).toContain('last 5 COTDs');
    expect(html).toContain('player-pace-positive');
    expect(html).toContain('+11.0');
    expect(html).toContain('▲');
  });
});

test('paginates recent COTD results independently on player profiles', async () => {
  let profileCalls = 0;
  const results = Array.from({ length: 11 }, (_, index) => ({
    cupId: 500 - index,
    cotdDate: `2026-10-${String(20 - index).padStart(2, '0')}`,
    name: `Profile Cup ${11 - index}`,
    rank: index + 1,
    rating: 2_996 - index,
    ratingChange: index === 10 ? null : 2.4,
  }));
  const data = createDataSource({
    getPlayerProfile: async () => {
      profileCalls += 1;
      return rankedProfile;
    },
    getPlayerCotdResults: async (_accountId, page, limit) => ({
      results: results.slice((page - 1) * limit, page * limit),
      total: results.length,
    }),
  });

  await withServer(data, async baseUrl => {
    const firstPage = await fetchPage(`${baseUrl}/players/${accountId}`);
    const firstHtml = await firstPage.text();
    expect(profileCalls).toBe(1);
    expect(firstHtml).toContain('Page 1 of 2');
    expect(firstHtml).toContain('?page=2');
    expect(firstHtml).toContain(`/players/${accountId}/cotd-results?page=2`);
    expect(firstHtml).toContain('Profile Cup 11');
    expect(firstHtml).toContain('rating 2,996');
    expect(firstHtml).toContain('(+2.4)');
    expect(firstHtml).not.toContain('Profile Cup 1</a>');

    const secondPage = await fetchPage(`${baseUrl}/players/${accountId}/cotd-results?page=2`);
    const secondHtml = await secondPage.text();
    expect(profileCalls).toBe(1);
    expect(secondHtml).toContain('Page 2 of 2');
    expect(secondHtml).toContain('?page=1');
    expect(secondHtml).toContain('Profile Cup 1</a>');
    expect(secondHtml).not.toContain('Rating history');
  });
});

test('explains ineligible players and reports unknown player profiles', async () => {
  const data = createDataSource({
    getPlayerProfile: async id => id === 'unranked'
      ? { status: 'unranked', username: 'New Player', matchCount: 4 }
      : null,
  });
  await withServer(data, async baseUrl => {
    const unranked = await fetchPage(`${baseUrl}/players/unranked`);
    expect(unranked.status).toBe(404);
    expect(await unranked.text()).toContain('completing 10 COTDs');

    const missing = await fetchPage(`${baseUrl}/players/unknown`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('Player not found');
  });
});

test('lists recent COTDs and renders their placements', async () => {
  await withServer(createDataSource(), async baseUrl => {
    const list = await fetchPage(`${baseUrl}/cotd`);
    expect(await list.text()).toContain(`/cotd/${cotdDay.cupId}`);

    const detail = await fetchPage(`${baseUrl}/cotd/${cotdDay.cupId}`);
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
    const response = await fetchPage(`${baseUrl}/cotd/${cotdDay.cupId}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Placement data is unavailable');
  });
});

test('handles missing COTDs, invalid IDs, health checks, and unsupported methods', async () => {
  await withServer(createDataSource({
    getCotdDetail: async () => null,
  }), async baseUrl => {
    const missing = await fetchPage(`${baseUrl}/cotd/20261015`);
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
    const home = await fetchPage(baseUrl);
    const homeHtml = await home.text();
    expect(homeHtml).toContain('href="/terms">Terms of Service</a>');
    expect(homeHtml).toContain('href="/privacy">Privacy Policy</a>');
    expect(homeHtml).toContain('href="/ratings">How ratings work</a>');

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

    const ratings = await fetch(`${baseUrl}/ratings`);
    const ratingsHtml = await ratings.text();
    expect(ratings.status).toBe(200);
    expect(ratingsHtml).toContain('>How ratings work</h1>');
    expect(ratingsHtml).toContain('at least 10 processed COTDs');
    expect(ratingsHtml).toContain('calibrated Glicko-2 model');
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
    const response = await fetchPage(baseUrl);
    expect(response.status).toBe(200);
  });
});
