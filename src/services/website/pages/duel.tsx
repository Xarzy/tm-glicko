import type { WebsiteDataSource, WebsiteDuelDateRange } from '../data';
import { htmlResponse } from '../html';
import { timeWebStage } from '../timing';
import { Pagination, parsePaginationPage } from '../components/pagination';
import { RatingChart } from '../components/rating-chart';

export const DUEL_PAGE_SIZE = 20;
const DURATION_UNITS = ['days', 'weeks', 'months', 'years'] as const;
type DurationUnit = typeof DURATION_UNITS[number];
const MAX_CUSTOM_DURATION = 1_000;

function getDateRange(
  duration: number,
  durationUnit: DurationUnit,
): WebsiteDuelDateRange {
  const today = new Date();
  const start = new Date(today);
  if (durationUnit === 'days' || durationUnit === 'weeks') {
    const days = duration * (durationUnit === 'weeks' ? 7 : 1);
    start.setUTCDate(start.getUTCDate() - days + 1);
  } else {
    const months = duration * (durationUnit === 'years' ? 12 : 1);
    const targetMonth = start.getUTCMonth() - months;
    start.setUTCDate(1);
    start.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(today.getUTCDate(), lastDay));
  }
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
  };
}

function formatWinRate(wins: number, sharedCups: number): string {
  return sharedCups === 0 ? '—' : `${(wins / sharedCups * 100).toFixed(1)}%`;
}

export async function renderDuel(url: URL, data: WebsiteDataSource): Promise<Response> {
  const firstName = (url.searchParams.get('player1') ?? '').trim();
  const secondName = (url.searchParams.get('player2') ?? '').trim();
  const rawDuration = url.searchParams.get('duration') ?? '30';
  const duration = Number(rawDuration);
  const rawDurationUnit = url.searchParams.get('durationUnit') ?? 'days';
  if (
    !/^\d+$/.test(rawDuration)
    || !Number.isSafeInteger(duration)
    || duration < 1
    || duration > MAX_CUSTOM_DURATION
    || !DURATION_UNITS.includes(rawDurationUnit as DurationUnit)
  ) {
    return htmlResponse('Player duel', <><h1>Invalid comparison duration</h1><p>Choose between 1 and {MAX_CUSTOM_DURATION} days, weeks, months, or years.</p></>, 400);
  }
  const durationUnit = rawDurationUnit as DurationUnit;
  const dateRange = getDateRange(duration, durationUnit);
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
      data.getDuelCupResults(firstAccountId, secondAccountId, page, DUEL_PAGE_SIZE, dateRange)),
    data.getDisplayNames([firstAccountId, secondAccountId]),
  ]);
  const [firstTrend, secondTrend] = await Promise.all([
    data.getPlayerRatingTrend(firstAccountId, dateRange),
    data.getPlayerRatingTrend(secondAccountId, dateRange),
  ]);
  const firstUsername = names.get(firstAccountId) ?? firstName;
  const secondUsername = names.get(secondAccountId) ?? secondName;
  const periodLabel = `Last ${duration} ${duration === 1 ? durationUnit.slice(0, -1) : durationUnit}`;
  const pageCount = Math.ceil(duel.total / DUEL_PAGE_SIZE);
  if (pageCount > 0 && page > pageCount) {
    const redirectUrl = new URL(url);
    redirectUrl.searchParams.set('page', String(pageCount));
    return Response.redirect(redirectUrl, 302);
  }
  return htmlResponse(`${firstUsername} vs ${secondUsername}`, <>
    <p className="muted mb-4"><a href="/duel">← New matchup</a></p>
    <div className="duel-hero duel-result-hero">
      <span className="duel-eyebrow">HEAD-TO-HEAD</span>
      <h1>{firstUsername} <span className="duel-title-vs">vs</span> {secondUsername}</h1>
      <p className="intro">Who took the most shared Cups of the Day?</p>
    </div>
      <div className="duel-share player-share">
        <button className="player-share-button" type="button" data-copy-page-link
          data-copy-page-label="Share comparison"
          data-copy-success="Comparison link copied to clipboard."
          aria-label="Copy link to this head-to-head comparison">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="M8.25 11.75a3.5 3.5 0 0 0 4.95 0l3-3a3.5 3.5 0 0 0-4.95-4.95l-1.72 1.72" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M11.75 8.25a3.5 3.5 0 0 0-4.95 0l-3 3a3.5 3.5 0 0 0 4.95 4.95l1.72-1.72" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span data-copy-page-label>Share comparison</span>
        </button>
        <span className="player-share-status" data-copy-page-status aria-live="polite" />
      </div>
      <form className="duel-period-form panel" action="/duel" method="get">
        <input type="hidden" name="player1" value={firstName} />
        <input type="hidden" name="player2" value={secondName} />
        <div className="duel-duration-control">
          <span>Last</span>
          <input id="duel-duration" name="duration" type="number" min="1" max={MAX_CUSTOM_DURATION}
            defaultValue={duration} aria-label="Duration number" />
          <select id="duel-duration-unit" name="durationUnit" defaultValue={durationUnit}
            aria-label="Duration unit">
            {DURATION_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </div>
        <button type="submit">Update comparison</button>
      </form>
      <section className="duel-scoreboard" aria-label="Head-to-head record">
      <div className="duel-contender duel-contender-first">
        <span className="duel-contender-label">PLAYER 1</span>
        <strong>{firstUsername}</strong>
        <span className="duel-win-count">{duel.firstWins} wins <span>· {formatWinRate(duel.firstWins, duel.total)} win rate</span></span>
      </div>
      <div className="duel-score-center">
        <span className="duel-score">{duel.firstWins} <span>–</span> {duel.secondWins}</span>
        <span className="duel-score-caption">CUP WINS</span>
      </div>
      <div className="duel-contender duel-contender-second">
        <span className="duel-contender-label">PLAYER 2</span>
        <strong>{secondUsername}</strong>
        <span className="duel-win-count">{duel.secondWins} wins <span>· {formatWinRate(duel.secondWins, duel.total)} win rate</span></span>
      </div>
      <div className="duel-summary">
        <span>{duel.total.toLocaleString('en-US')} shared {duel.total === 1 ? 'cup' : 'cups'} · {periodLabel}</span>
        {duel.draws > 0 && <span>{duel.draws} tied {duel.draws === 1 ? 'cup' : 'cups'}</span>}
      </div>
    </section>
    <section className="duel-trends" aria-label="Rating trends">
      <div className="duel-results-heading">
        <div><h2>Rating trends</h2><p>{`${periodLabel} rating history`}</p></div>
      </div>
      <div className="duel-trend-grid">
        <section className="panel"><h3>{firstUsername}</h3><RatingChart history={firstTrend} bands={[]} /></section>
        <section className="panel"><h3>{secondUsername}</h3><RatingChart history={secondTrend} bands={[]} /></section>
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
