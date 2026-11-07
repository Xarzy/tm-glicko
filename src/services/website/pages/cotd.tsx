import type { SelectCotdDay } from '../../../db/schema';
import type { WebsiteCotdResult } from '../data';
import { htmlResponse } from '../html';

export function renderCotdDetail(cotd: { day: SelectCotdDay; results: WebsiteCotdResult[] } | null): Response {
  if (!cotd) {
    return htmlResponse('COTD not found', <><h1>COTD results not found</h1><p><a href="/cotd">Browse recent COTDs</a></p></>, 404);
  }
  const { day, results } = cotd;
  return htmlResponse(`${day.name} results`, <>
    <p className="muted">
      <a href="/cotd">← Recent COTDs</a>
    </p>
    <h1>{day.name}</h1>
    <p className="intro">{day.cotdDate} · {(day.cardinal ?? 0).toLocaleString('en-US')} players</p>
    <section className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="text-right">Placement</th>
            <th>Player</th>
            <th className="text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {results.map(result => 
            <tr key={result.player}>
              <td className="text-right">#{result.rank}</td>
              <td><a href={`/players/${encodeURIComponent(result.player)}`}>{result.username}</a></td>
              <td className="text-right">{result.score === null ? '—' : result.score.toLocaleString('en-US')}</td>
            </tr>
          )}
        {results.length === 0 && <tr><td colSpan={3} className="empty">Placement data is unavailable for this COTD.</td></tr>}
        </tbody>
      </table>
    </section>
    <p className="muted">Showing the top {results.length} placements.</p>
  </>);
}
