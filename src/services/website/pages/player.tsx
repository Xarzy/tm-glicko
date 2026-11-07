import { MIN_RANKED_COTDS } from '../../../db/schema';
import type { WebsitePlayerCotdPage, WebsitePlayerCotdResult, WebsitePlayerProfile } from '../data';
import { TRACKMANIA_RANKS } from '../../rankService';
import { formatRating, htmlResponse } from '../html';
import { Pagination, parsePaginationPage } from '../components/pagination';
import { formatRatingChange, RatingChart } from '../components/rating-chart';

export const PLAYER_COTD_PAGE_SIZE = 10;

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
