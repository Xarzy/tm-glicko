import { renderToStaticMarkup } from 'react-dom/server';
import { MIN_RANKED_COTDS } from '../../db/schema';
import type { SelectCotdDay } from '../../db/schema';
import type {
  WebsiteCotdResult,
  WebsiteDataSource,
  WebsitePlayerHistoryPoint,
  WebsitePlayerProfile,
} from '../websiteData';
import type { RankThresholdBand } from '../rankService';
import { formatRating, htmlResponse } from './html';

const PAGE_SIZE = 25;

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
    const accountId = await data.findAccountIdByUsername(query);
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
  const { entries, total } = await data.getLeaderboardPage(page, PAGE_SIZE, selectedTier || undefined);
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
    {showRecentCotds && <CotdList days={await data.getRecentProcessedCotdDays(10)} compact />}
  </>;
  return htmlResponse('Leaderboard', content);
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

function PlayerCotdResults({ history }: { history: WebsitePlayerHistoryPoint[] }) {
  if (history.length === 0) return <p className="muted">No recent results available.</p>;
  return <ul className="list">{history.slice(-10).reverse().map(result =>
    <li key={result.cupId}><a href={`/cotd/${result.cupId}`}>{result.name}</a>
      <span className="muted"> · {result.cotdDate} · placement {result.rank === null ? 'unavailable ' : `#${result.rank} `} 
      · rating {formatRating(result.rating)} {result.ratingChange !== null ? `(${result.ratingChange > 0 ? '+' : ''}${result.ratingChange.toFixed(1)})` : ''}</span>
    </li>
  )}</ul>;
}

export function renderPlayerProfile(profile: WebsitePlayerProfile | null, accountId: string): Response {
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
  return htmlResponse(`${username} profile`, <>
    <p className="muted"><a href="/leaderboard">← Leaderboard</a></p>
    <h1>{username}</h1>
    <p className="intro">Trackmania player profile · <a href={`/players/${encodeURIComponent(accountId)}`}>share this page</a></p>
    <div className="stats">
      <div className="stat"><span>Leaderboard rank</span><strong>#{rank} of {total.toLocaleString('en-US')}</strong></div>
      <div className="stat"><span>Rating</span><strong>{formatRating(state.rating)}</strong></div>
      <div className="stat"><span>Competitive rank</span><strong>{tier.fullName}</strong><span>Top {topPercentageText}%</span></div>
      <div className="stat"><span>COTD division estimate</span><strong>{divisionEstimate === null ? 'Unavailable' : `Division ${divisionEstimate}`}</strong></div>
      <div className="stat"><span>Eligible-era peak</span><strong>{peakRating === null ? 'Unavailable' : formatRating(peakRating)}</strong></div>
      <div className="stat"><span>Completed COTDs</span><strong>{state.matchCount.toLocaleString('en-US')}</strong></div>
    </div>
    <section className="panel"><h2>Rating history</h2>
      <p className="muted">Showing up to the latest {history.length} eligible results · {firstHistoryDate} to {lastHistoryDate}</p>
      <RatingChart history={history} bands={rankBands} />
    </section>
    <section className="panel"><h2>Recent COTD results</h2><PlayerCotdResults history={history} /></section>
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
