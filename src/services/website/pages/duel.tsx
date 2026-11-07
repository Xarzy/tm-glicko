import type { WebsiteDataSource } from '../data';
import { htmlResponse } from '../html';
import { timeWebStage } from '../timing';
import { Pagination, parsePaginationPage } from '../components/pagination';

export const DUEL_PAGE_SIZE = 20;

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
