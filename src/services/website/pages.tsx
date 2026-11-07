import { renderToStaticMarkup } from 'react-dom/server';
import { MIN_RANKED_COTDS } from '../../db/schema';
import type { SelectCotdDay } from '../../db/schema';
import type {
  WebsiteCotdResult,
  WebsiteDataSource,
  WebsitePlayerCotdResult,
  WebsitePlayerHistoryPoint,
  WebsitePlayerCotdPage,
  WebsitePlayerProfile,
} from '../websiteData';
import { TRACKMANIA_RANKS, type RankThresholdBand } from '../rankService';
import { formatRating, htmlResponse } from './html';
import { timeWebStage } from './timing';

const PAGE_SIZE = 25;
export const DUEL_PAGE_SIZE = 20;
export const PLAYER_COTD_PAGE_SIZE = 10;

export function parsePaginationPage(url: URL): number | null {
  const rawPage = url.searchParams.get('page') ?? '1';
  if (!/^\d+$/.test(rawPage)) return null;
  const page = Number(rawPage);
  return Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : null;
}

function Pagination({
  page,
  total,
  pageSize,
  target,
  href,
  fetchHref,
}: {
  page: number;
  total: number;
  pageSize: number;
  target: string;
  href(page: number): string;
  fetchHref?(page: number): string;
}) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  return <nav className="pagination" aria-label="Pagination" data-pagination-target={target}
    data-pagination-fetch-current={fetchHref?.(page)}>
    {page > 1
      ? <a rel="prev" href={href(page - 1)} data-pagination-target={target}
        data-pagination-fetch-url={fetchHref?.(page - 1)}>← Previous</a>
      : <span />}
    <span className="muted">Page {page} of {pageCount}</span>
    {page < pageCount
      ? <a rel="next" href={href(page + 1)} data-pagination-target={target}
        data-pagination-fetch-url={fetchHref?.(page + 1)}>Next →</a>
      : <span />}
  </nav>;
}

function SearchForm({
  rankOptions,
  value = '',
  selectedTier = '',
}: {
  rankOptions: WebsiteDataSource['rankOptions'];
  value?: string;
  selectedTier?: string;
}) {
  return <form className="my-5 flex max-w-2xl gap-2 max-[560px]:flex-wrap" action="/leaderboard" method="get">
    <input className="min-w-0 flex-1 rounded-lg border border-[#374456] bg-[#10151e] px-3 py-2 text-[#edf2f7] max-[560px]:basis-full" name="q" maxLength={64} defaultValue={value} placeholder="Exact Trackmania username" aria-label="Trackmania username" />
    <select className="rounded-lg border border-[#374456] bg-[#10151e] px-3 py-2" name="tier" aria-label="Filter competitive rank" defaultValue={selectedTier}>
      <option value="">All ranks</option>
      {rankOptions.map(rank => <option key={rank.code} value={rank.code}>{rank.label}</option>)}
    </select>
    <button className="cursor-pointer rounded-lg bg-[#45c9b5] px-3 py-2 font-bold text-[#081512]" type="submit">Search / filter</button>
  </form>;
}

export async function renderLeaderboard(
  url: URL,
  showRecentCotds: boolean,
  data: WebsiteDataSource,
): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim();
  const selectedTier = (url.searchParams.get('tier') ?? '').trim();
  if (query.length > 64) return htmlResponse('Leaderboard', <h1>Search is too long</h1>, 400);
  if (selectedTier && !data.rankOptions.some(rank => rank.code === selectedTier)) {
    return htmlResponse('Leaderboard', <><h1>Invalid rank filter</h1><p>Select a rank from the leaderboard filters.</p></>, 400);
  }

  if (query) {
    const accountId = await timeWebStage(
      'leaderboard username search',
      () => data.findAccountIdByUsername(query),
    );
    if (!accountId) {
      return htmlResponse('Leaderboard', <>
        <h1>Player not found</h1>
        <SearchForm rankOptions={data.rankOptions} value={query} selectedTier={selectedTier} />
        <p className="muted">No exact Trackmania username match for “{query}”.</p>
      </>);
    }
    return Response.redirect(new URL(`/players/${encodeURIComponent(accountId)}`, url), 302);
  }

  const page = Number(url.searchParams.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
    return htmlResponse('Leaderboard', <><h1>Invalid page</h1><p>Page must be a positive integer.</p></>, 400);
  }
  const { entries, total } = await timeWebStage(
    'leaderboard data load',
    () => data.getLeaderboardPage(page, PAGE_SIZE, selectedTier || undefined),
  );
  const recentCotds = showRecentCotds
    ? await timeWebStage('recent COTD query', () => data.getRecentProcessedCotdDays(10))
    : null;
  const content = <>
    <h1>Glicko Leaderboard</h1>
    <p className="intro">COTD qualifying ratings for eligible players, ordered by rating.</p>
    <SearchForm rankOptions={data.rankOptions} selectedTier={selectedTier} />
    <section className="table-wrap"><table><thead><tr>
      <th className="text-right">Rank</th><th>Player</th><th className="text-right">Rating</th><th>Competitive rank</th><th className="text-right">Change</th>
    </tr></thead><tbody>
      {entries.map(entry => {
        const delta = entry.previousRating === null
          ? '—'
          : `${entry.rating - entry.previousRating >= 0 ? '+' : ''}${(entry.rating - entry.previousRating).toFixed(1)}`;
        const color = `#${entry.tier.rank.tierColor.toString(16).padStart(6, '0')}`;
        return <tr key={entry.accountId}>
          <td className="text-right">#{entry.rank}</td>
          <td><a href={`/players/${encodeURIComponent(entry.accountId)}`}>{entry.username}</a></td>
          <td className="text-right">{formatRating(entry.rating)}</td>
          <td><span className="badge" style={{ borderColor: color }}>{entry.tier.fullName}</span></td>
          <td className="text-right">{delta}</td>
        </tr>;
      })}
      {entries.length === 0 && <tr><td colSpan={5} className="empty">No eligible players found.</td></tr>}
    </tbody></table></section>
    {total > 0 && <div className="mt-4 flex items-center justify-between">
      <span className="muted">Page {page} · {total.toLocaleString('en-US')} eligible players{selectedTier ? ` in ${data.rankOptions.find(rank => rank.code === selectedTier)!.label}` : ''}</span>
      <span>
        {page > 1 && <a href={`/leaderboard?page=${page - 1}${selectedTier ? `&tier=${encodeURIComponent(selectedTier)}` : ''}`}>← Previous</a>}
        {page * PAGE_SIZE < total && <a className="ml-4" href={`/leaderboard?page=${page + 1}${selectedTier ? `&tier=${encodeURIComponent(selectedTier)}` : ''}`}>Next →</a>}
      </span>
    </div>}
    {recentCotds && <CotdList days={recentCotds} compact />}
  </>;
  return htmlResponse('Leaderboard', content);
}

export async function renderDuel(url: URL, data: WebsiteDataSource): Promise<Response> {
  const firstName = (url.searchParams.get('player1') ?? '').trim();
  const secondName = (url.searchParams.get('player2') ?? '').trim();
  const page = parsePaginationPage(url);
  if (page === null) {
    return htmlResponse('Player duel', <><h1>Invalid page</h1><p>Page must be a positive integer.</p></>, 400);
  }
  if (firstName.length > 64 || secondName.length > 64) {
    return htmlResponse('Player duel', <><h1>Player name is too long</h1><p>Names must be 64 characters or fewer.</p></>, 400);
  }

  const form = <form className="duel-form panel" action="/duel" method="get">
    <div className="duel-form-heading">
      <span className="duel-eyebrow">SET UP A MATCHUP</span>
      <h2>Choose your players</h2>
      <p>Enter both Trackmania usernames to see who leads on shared Cups of the Day.</p>
    </div>
    <div className="duel-fields">
      <label className="duel-field" htmlFor="duel-player1">
        <span><span className="duel-player-dot duel-player-dot-first" />First player</span>
        <input id="duel-player1" name="player1" type="text" autoComplete="off" maxLength={64}
          required defaultValue={firstName} placeholder="Exact Trackmania username" />
      </label>
      <span className="duel-form-vs" aria-hidden="true">VS</span>
      <label className="duel-field" htmlFor="duel-player2">
        <span><span className="duel-player-dot duel-player-dot-second" />Second player</span>
        <input id="duel-player2" name="player2" type="text" autoComplete="off" maxLength={64}
          required defaultValue={secondName} placeholder="Exact Trackmania username" />
      </label>
    </div>
    <button className="duel-submit" type="submit">Compare players <span aria-hidden="true">→</span></button>
  </form>;

  if (!firstName || !secondName) {
    return htmlResponse('Player duel', <>
      <div className="duel-hero">
        <span className="duel-eyebrow">TRACKMANIA · HEAD-TO-HEAD</span>
        <h1>Settle it on the track.</h1>
        <p className="intro">Compare two players and see who comes out ahead on the Cups of the Day they raced together.</p>
      </div>
      {form}
    </>);
  }

  const [firstAccountId, secondAccountId] = await Promise.all([
    data.findAccountIdByUsername(firstName),
    data.findAccountIdByUsername(secondName),
  ]);
  if (!firstAccountId || !secondAccountId) {
    const missingName = !firstAccountId ? firstName : secondName;
    return htmlResponse('Player duel', <>
      <div className="duel-hero">
        <span className="duel-eyebrow">TRACKMANIA · HEAD-TO-HEAD</span>
        <h1>Settle it on the track.</h1>
        <p className="intro">Compare two players and see who comes out ahead on the Cups of the Day they raced together.</p>
      </div>
      {form}
      <p className="duel-error" role="status">No exact Trackmania username match for “{missingName}”. Check the spelling and try again.</p>
    </>);
  }
  if (firstAccountId === secondAccountId) {
    return htmlResponse('Player duel', <>
      <div className="duel-hero">
        <span className="duel-eyebrow">TRACKMANIA · HEAD-TO-HEAD</span>
        <h1>Settle it on the track.</h1>
        <p className="intro">Compare two players and see who comes out ahead on the Cups of the Day they raced together.</p>
      </div>
      {form}
      <p className="duel-error" role="status">Choose two different players to start a duel.</p>
    </>);
  }

  const [duel, names] = await Promise.all([
    timeWebStage('player duel shared COTD results', () =>
      data.getDuelCupResults(firstAccountId, secondAccountId, page, DUEL_PAGE_SIZE)),
    data.getDisplayNames([firstAccountId, secondAccountId]),
  ]);
  const firstUsername = names.get(firstAccountId) ?? firstName;
  const secondUsername = names.get(secondAccountId) ?? secondName;
  const pageCount = Math.ceil(duel.total / DUEL_PAGE_SIZE);
  if (pageCount > 0 && page > pageCount) {
    const redirectUrl = new URL(url);
    redirectUrl.searchParams.set('page', String(pageCount));
    return Response.redirect(redirectUrl, 302);
  }
  return htmlResponse(`${firstUsername} vs ${secondUsername}`, <>
    <p className="muted"><a href="/duel">← New matchup</a></p>
    <div className="duel-hero">
      <span className="duel-eyebrow">HEAD-TO-HEAD</span>
      <h1>{firstUsername} <span className="duel-title-vs">vs</span> {secondUsername}</h1>
      <p className="intro">Who took the most shared Cups of the Day?</p>
    </div>
    <section className="duel-scoreboard" aria-label="Head-to-head record">
      <div className="duel-contender duel-contender-first">
        <span className="duel-contender-label">PLAYER 1</span>
        <strong>{firstUsername}</strong>
        <span className="duel-win-count">{duel.firstWins} <span>wins</span></span>
      </div>
      <div className="duel-score-center">
        <span className="duel-score">{duel.firstWins} <span>–</span> {duel.secondWins}</span>
        <span className="duel-score-caption">CUP WINS</span>
      </div>
      <div className="duel-contender duel-contender-second">
        <span className="duel-contender-label">PLAYER 2</span>
        <strong>{secondUsername}</strong>
        <span className="duel-win-count">{duel.secondWins} <span>wins</span></span>
      </div>
      <div className="duel-summary">
        <span>{duel.total.toLocaleString('en-US')} shared {duel.total === 1 ? 'cup' : 'cups'}</span>
        {duel.draws > 0 && <span>{duel.draws} tied {duel.draws === 1 ? 'cup' : 'cups'}</span>}
      </div>
    </section>
    {duel.total === 0
      ? <p className="muted">These players have no Cups of the Day with recorded placements for both of them.</p>
      : <section className="duel-results" data-pagination-content="duel-results">
        <div className="duel-results-heading">
          <div><h2>Cup-by-cup results</h2><p>Head-to-head placements on the same COTDs</p></div>
          <span>{duel.total.toLocaleString('en-US')} shared cups</span>
        </div>
        <div className="table-wrap"><table><thead><tr>
        <th>Cup</th><th>Date</th><th className="text-right">{firstUsername}</th><th className="text-right">{secondUsername}</th><th>Winner</th>
      </tr></thead><tbody>
        {duel.results.map(result => <tr key={result.cupId}>
          <td><a href={`/cotd/${result.cupId}`}>{result.name}</a></td>
          <td>{result.cotdDate}</td>
          <td className="text-right">#{result.firstRank}</td>
          <td className="text-right">#{result.secondRank}</td>
          <td>{result.firstRank === result.secondRank
            ? 'Tie'
            : result.firstRank < result.secondRank ? firstUsername : secondUsername}</td>
        </tr>)}
      </tbody></table></div>
      <Pagination page={page} total={duel.total} pageSize={DUEL_PAGE_SIZE}
        target="duel-results"
        href={nextPage => {
          const nextUrl = new URL(url);
          nextUrl.searchParams.set('page', String(nextPage));
          return `${nextUrl.pathname}${nextUrl.search}`;
        }} />
      </section>}
  </>);
}

export function CotdList({ days, compact = false }: { days: SelectCotdDay[]; compact?: boolean }) {
  return <section className="panel">
    <h2>{compact ? 'Recent COTDs' : 'Recent Cup of the Day results'}</h2>
    {days.length
      ? <ul className="list">{days.map(day => <li key={day.cupId}>
        <a href={`/cotd/${day.cupId}`}>{day.name}</a>
        <span className="muted"> · {day.cotdDate} · {(day.cardinal ?? 0).toLocaleString('en-US')} players</span>
      </li>)}</ul>
      : <p className="muted">No processed COTD results are available yet.</p>}
  </section>;
}

function formatRatingChange(change: number | null): string {
  if (change === null) return '—';
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}`;
}

export function renderRatingChart(
  history: WebsitePlayerHistoryPoint[],
  bands: RankThresholdBand[] = [],
): string {
  return renderToStaticMarkup(<RatingChart history={history} bands={bands} />);
}

function RatingChart({ history, bands }: { history: WebsitePlayerHistoryPoint[]; bands: RankThresholdBand[] }) {
  if (history.length === 0) return <p className="muted">No eligible rating history is available yet.</p>;
  const width = 900;
  const height = 360;
  const margin = { top: 24, right: 18, bottom: 38, left: 74 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = history.map(point => point.rating);
  const minimum = Math.max(0, Math.floor((Math.min(...values) - 40) / 100) * 100);
  const maximum = Math.ceil((Math.max(...values) + 40) / 100) * 100;
  const ratingRange = Math.max(1, maximum - minimum);
  const xAt = (index: number) => margin.left + (index / Math.max(1, history.length - 1)) * plotWidth;
  const yAt = (rating: number) => margin.top + plotHeight - ((rating - minimum) / ratingRange) * plotHeight;

  return <div className="chart-wrap"><svg className="block h-auto w-full rounded-xl bg-[#111720]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Rating history from ${history[0].cotdDate} to ${history[history.length - 1].cotdDate}`}>
    {bands.map(band => {
      const bandMinimum = Math.max(minimum, band.minRating);
      const bandMaximum = Math.min(maximum, band.maxRating);
      if (bandMaximum <= bandMinimum) return null;
      const y = yAt(bandMaximum);
      const bandHeight = yAt(bandMinimum) - y;
      if (bandHeight < 1) return null;
      return <g key={band.rank.code}>
        <rect x={margin.left} y={y} width={plotWidth} height={bandHeight} fill={band.rank.svgColor} fillOpacity="0.18" stroke={band.rank.svgColor} strokeOpacity="0.45" />
        <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={band.rank.svgColor} strokeOpacity="0.9" strokeWidth="1.5" />
        {bandHeight >= 17 && <text x={margin.left + 7} y={y + 13} fill={band.rank.svgColor} fontSize="11" fontWeight="700">{band.rank.shortName}</text>}
      </g>;
    })}
    {Array.from({ length: Math.floor((maximum - minimum) / 100) + 1 }, (_, index) => {
      const rating = minimum + index * 100;
      const y = yAt(rating);
      return <g key={rating}>
        <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke="#26303c" strokeDasharray="3 4" />
        <text x={margin.left - 10} y={y + 4} fill="#9aa4b2" fontSize="12" textAnchor="end">{formatRating(rating)}</text>
      </g>;
    })}
    <path d={history.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point.rating).toFixed(1)}`
    ).join(' ')} fill="none" stroke="#45c9b5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {history.map((point, index) => <circle key={`${point.cupId}-${index}`} cx={xAt(index).toFixed(1)} cy={yAt(point.rating).toFixed(1)} r="5" fill="transparent" pointerEvents="all">
      <title>{`${point.cotdDate} · ${point.name} · rating ${formatRating(point.rating)} · change ${formatRatingChange(point.ratingChange)}`}</title>
    </circle>)}
    <line x1={margin.left} y1={margin.top + plotHeight} x2={width - margin.right} y2={margin.top + plotHeight} stroke="#354151" />
    <text x={margin.left} y={height - 10} fill="#a4afbd" fontSize="12">{history[0].cotdDate}</text>
    <text x={width - margin.right} y={height - 10} fill="#a4afbd" fontSize="12" textAnchor="end">{history[history.length - 1].cotdDate}</text>
  </svg></div>;
}

function PlayerCotdResults({
  results,
  page,
  total,
  accountId,
  fetchHref,
}: {
  results: WebsitePlayerCotdResult[];
  page: number;
  total: number;
  accountId: string;
  fetchHref?(page: number): string;
}) {
  if (total === 0) return <p className="muted">No recent results available.</p>;
  return <>
    <ul className="list">{results.map(result =>
      <li key={result.cupId}><a href={`/cotd/${result.cupId}`}>{result.name}</a>
        <span className="muted"> · {result.cotdDate} · placement {result.rank === null ? 'unavailable' : `#${result.rank}`}
          {' · rating '}{formatRating(result.rating)}{result.ratingChange === null ? '' : ` (${formatRatingChange(result.ratingChange)})`}</span>
      </li>
    )}</ul>
    <Pagination page={page} total={total} pageSize={PLAYER_COTD_PAGE_SIZE} target="player-cotd-results"
      href={nextPage => `/players/${encodeURIComponent(accountId)}?page=${nextPage}`}
      fetchHref={fetchHref} />
  </>;
}

function PlayerCotdResultsSection({
  pageData,
  page,
  accountId,
  fetchHref,
}: {
  pageData: WebsitePlayerCotdPage;
  page: number;
  accountId: string;
  fetchHref?(page: number): string;
}) {
  return <section className="panel" data-pagination-content="player-cotd-results">
    <h2>Recent COTD results</h2>
    <PlayerCotdResults
      results={pageData.results}
      page={page}
      total={pageData.total}
      accountId={accountId}
      fetchHref={fetchHref}
    />
  </section>;
}

export function renderPlayerCotdResultsFragment(
  pageData: WebsitePlayerCotdPage,
  accountId: string,
  page: number,
): Response {
  const profilePath = `/players/${encodeURIComponent(accountId)}`;
  const fragmentPath = `${profilePath}/cotd-results`;
  return htmlResponse('Player COTD results', <PlayerCotdResultsSection
    pageData={pageData}
    page={page}
    accountId={accountId}
    fetchHref={nextPage => `${fragmentPath}?page=${nextPage}`}
  />);
}

function getPlayerDivisionProgress(
  rank: number,
  total: number,
  tier: Extract<WebsitePlayerProfile, { status: 'ranked' }>['tier'],
): number {
  if (tier.rank.code === 'trackmaster') {
    const lastTrackmasterRank = Math.max(1, Math.floor(tier.rank.topPercent * total) + 1);
    return lastTrackmasterRank === 1
      ? 1
      : Math.max(0, Math.min(1, (lastTrackmasterRank - rank) / (lastTrackmasterRank - 1)));
  }

  const rankIndex = TRACKMANIA_RANKS.findIndex(rankDefinition => rankDefinition.code === tier.rank.code);
  if (rankIndex < 0) throw new Error(`Unknown competitive rank: ${tier.rank.code}`);

  const lowerPercent = tier.rank.topPercent;
  const upperPercent = rankIndex === 0 ? 0 : TRACKMANIA_RANKS[rankIndex - 1].topPercent;
  const rankProgress = (lowerPercent - tier.topPercentage / 100) / (lowerPercent - upperPercent);
  const divisionProgress = rankProgress * 4 - (tier.division - 1);
  return Math.max(0, Math.min(1, divisionProgress));
}

export function renderPlayerProfile(
  profile: WebsitePlayerProfile | null,
  accountId: string,
  cotdPage: WebsitePlayerCotdPage = { results: [], total: 0 },
  page = 1,
): Response {
  if (!profile) {
    return htmlResponse('Player not found', <><h1>Player not found</h1><p><a href="/leaderboard">Browse the leaderboard</a></p></>, 404);
  }
  if (profile.status === 'unranked') {
    return htmlResponse(`${profile.username} profile`, <>
      <h1>{profile.username}</h1>
      <p className="intro">This player is not ranked yet. Stats and leaderboard placement are available after completing {MIN_RANKED_COTDS} COTDs.</p>
      <p className="muted">Completed COTDs: {profile.matchCount}</p>
      <p><a href="/leaderboard">← Back to leaderboard</a></p>
    </>, 404);
  }

  const { username, state, rank, total, tier, topPercentageText, peakRating, divisionEstimate, history, rankBands } = profile;
  const firstHistoryDate = history[0]?.cotdDate ?? '—';
  const lastHistoryDate = history[history.length - 1]?.cotdDate ?? '—';
  const recentPace = history.slice(-5).reduce<number | null>((totalChange, point) =>
    point.ratingChange === null
      ? totalChange
      : (totalChange ?? 0) + point.ratingChange, null);
  const divisionProgress = getPlayerDivisionProgress(rank, total, tier);
  const progressLabel = tier.rank.code === 'trackmaster'
    ? 'Progress toward rank #1'
    : `Division ${tier.divisionRoman} progress`;
  return htmlResponse(`${username} profile`, <>
    <p className="muted"><a href="/leaderboard">← Leaderboard</a></p>
    <div className="player-profile-intro">
      <p className="intro">Trackmania player profile</p>
      <div className="player-share">
        <button className="player-share-button" type="button" data-copy-page-link aria-label="Copy link to this player profile">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="M8.25 11.75a3.5 3.5 0 0 0 4.95 0l3-3a3.5 3.5 0 0 0-4.95-4.95l-1.72 1.72" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M11.75 8.25a3.5 3.5 0 0 0-4.95 0l-3 3a3.5 3.5 0 0 0 4.95 4.95l1.72-1.72" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span data-copy-page-label>Share profile</span>
        </button>
        <span className="player-share-status" data-copy-page-status aria-live="polite" />
      </div>
    </div>
    <section className="player-card" aria-labelledby="player-card-title">
      <div className="player-card-heading">
        <div>
          <h1 id="player-card-title">{username}</h1>
          <span className="player-card-rank" style={{
            color: tier.rank.svgColor,
            borderColor: tier.rank.svgColor,
          }}>{tier.fullName}</span>
        </div>
        <div className="player-card-rating">
          <strong>{formatRating(state.rating)}</strong>
          <span>RATING</span>
        </div>
      </div>
      <div className="player-progress">
        <div className="player-progress-label">
          <span>{progressLabel}</span>
          <strong>{Math.round(divisionProgress * 100)}%</strong>
        </div>
        <div className="player-progress-track" role="progressbar"
          aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(divisionProgress * 100)}>
          <span className="player-progress-fill" style={{
            width: `${divisionProgress * 100}%`,
            backgroundColor: tier.rank.svgColor,
          }} />
        </div>
      </div>
      <div className="player-card-stats">
        <div className="player-card-stat"><span>Leaderboard rank</span><strong>#{rank} of {total.toLocaleString('en-US')}</strong></div>
        <div className="player-card-stat"><span>Top percentile</span><strong>Top {topPercentageText}%</strong></div>
        <div className="player-card-stat"><span>COTD division estimate</span><strong>{divisionEstimate === null ? 'Unavailable' : `Division ${divisionEstimate}`}</strong></div>
        <div className="player-card-stat"><span>Eligible-era peak</span><strong>{peakRating === null ? 'Unavailable' : formatRating(peakRating)}</strong></div>
        <div className="player-card-stat"><span>Recent pace <span className="player-card-stat-note">last 5 COTDs</span></span>
          <strong className={recentPace === null ? '' : recentPace > 0 ? 'player-pace-positive' : recentPace < 0 ? 'player-pace-negative' : ''}>
            {recentPace === null
              ? 'Unavailable'
              : <>{formatRatingChange(recentPace)}{recentPace === 0 ? null
                : <> <span aria-hidden="true">{recentPace > 0 ? '▲' : '▼'}</span></>}</>}
          </strong>
        </div>
        <div className="player-card-stat"><span>Completed COTDs</span><strong>{state.matchCount.toLocaleString('en-US')}</strong></div>
      </div>
    </section>
    <section className="panel"><h2>Rating history</h2>
      <p className="muted">Showing up to the latest {history.length} eligible results · {firstHistoryDate} to {lastHistoryDate}</p>
      <RatingChart history={history} bands={rankBands} />
    </section>
    <PlayerCotdResultsSection pageData={cotdPage} page={page} accountId={accountId}
      fetchHref={nextPage => `/players/${encodeURIComponent(accountId)}/cotd-results?page=${nextPage}`} />
  </>);
}

export function renderCotdDetail(cotd: { day: SelectCotdDay; results: WebsiteCotdResult[] } | null): Response {
  if (!cotd) {
    return htmlResponse('COTD not found', <><h1>COTD results not found</h1><p><a href="/cotd">Browse recent COTDs</a></p></>, 404);
  }
  const { day, results } = cotd;
  return htmlResponse(`${day.name} results`, <>
    <p className="muted"><a href="/cotd">← Recent COTDs</a></p>
    <h1>{day.name}</h1><p className="intro">{day.cotdDate} · {(day.cardinal ?? 0).toLocaleString('en-US')} players</p>
    <section className="table-wrap"><table><thead><tr><th className="text-right">Placement</th><th>Player</th><th className="text-right">Score</th></tr></thead><tbody>
      {results.map(result => <tr key={result.player}>
        <td className="text-right">#{result.rank}</td>
        <td><a href={`/players/${encodeURIComponent(result.player)}`}>{result.username}</a></td>
        <td className="text-right">{result.score === null ? '—' : result.score.toLocaleString('en-US')}</td>
      </tr>)}
      {results.length === 0 && <tr><td colSpan={3} className="empty">Placement data is unavailable for this COTD.</td></tr>}
    </tbody></table></section>
    <p className="muted">Showing the top {results.length} placements.</p>
  </>);
}
