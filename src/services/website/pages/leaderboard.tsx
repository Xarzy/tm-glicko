import type { WebsiteDataSource } from '../data';
import { formatRating, htmlResponse } from '../html';
import { timeWebStage } from '../timing';
import { CotdList } from '../components/cotd-list';
import { DataFreshness } from '../components/data-freshness';

const PAGE_SIZE = 25;

function SearchForm({
  rankOptions,
  value = '',
  selectedTier = '',
  searchDescription,
}: {
  rankOptions: WebsiteDataSource['rankOptions'];
  value?: string;
  selectedTier?: string;
  searchDescription?: string;
}) {
  return <>
    <form className="my-5 flex max-w-2xl gap-2 max-[560px]:flex-wrap" action="/leaderboard" method="get">
      <input className="min-w-0 flex-1 rounded-lg border border-[#374456] bg-[#10151e] px-3 py-2 text-[#edf2f7] max-[560px]:basis-full" name="q" maxLength={64} defaultValue={value} placeholder="Exact Trackmania username" aria-label="Trackmania username" />
      <select className="rounded-lg border border-[#374456] bg-[#10151e] px-3 py-2" name="tier" aria-label="Filter competitive rank" defaultValue={selectedTier}>
        <option value="">All ranks</option>
        {rankOptions.map(rank => <option key={rank.code} value={rank.code}>{rank.label}</option>)}
      </select>
      <button className="cursor-pointer rounded-lg bg-[#45c9b5] px-3 py-2 font-bold text-[#081512]" type="submit">Search / filter</button>
    </form>
    {searchDescription && <p className="search-help muted">{searchDescription}</p>}
  </>;
}

function PlayerSearchSuggestions({
  suggestions,
}: {
  suggestions: Awaited<ReturnType<WebsiteDataSource['searchPlayerSuggestions']>>;
}) {
  if (suggestions.length === 0) {
    return <p className="muted">No partial matches found in the eligible-player suggestions.</p>;
  }

  return <section className="panel" aria-label="Player search suggestions">
    <h2>Did you mean?</h2>
    <ul className="list">
      {suggestions.map(player => <li key={player.accountId}>
        <a href={`/players/${encodeURIComponent(player.accountId)}`}>{player.username}</a>
        <span className="muted"> · #{player.rank} · rating {formatRating(player.rating)}</span>
      </li>)}
    </ul>
  </section>;
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
        <SearchForm
          rankOptions={data.rankOptions}
          value={query}
          selectedTier={selectedTier}
          searchDescription="Partial-name suggestions search the cached display names of all eligible players."
        />
        {query.length >= 2 && <PlayerSearchSuggestions
          suggestions={await timeWebStage(
            'leaderboard partial player search',
            () => data.searchPlayerSuggestions(query, 5),
          )}
        />}
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
  const [latestProcessedAt, dailyUpdateStatus] = await Promise.all([
    timeWebStage('latest processed COTD timestamp', () => data.getLatestProcessedCotdAt()),
    timeWebStage('daily update status', () => data.getDailyUpdateStatus()),
  ]);
  const recentCotds = showRecentCotds
    ? await timeWebStage('recent COTD query', () => data.getRecentProcessedCotdDays(10))
    : null;
  const content = <>
    <h1>Glicko Leaderboard</h1>
    <p className="intro">COTD qualifying ratings for eligible players, ordered by rating.</p>
    <DataFreshness lastProcessedAt={latestProcessedAt} dailyUpdateStatus={dailyUpdateStatus} />
    <SearchForm rankOptions={data.rankOptions} selectedTier={selectedTier} />
    <section className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="text-right">Rank</th>
            <th>Player</th>
            <th className="text-right">Rating</th>
            <th>Competitive rank</th>
            <th className="text-right">Change</th>
          </tr>
        </thead>
      <tbody>
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
