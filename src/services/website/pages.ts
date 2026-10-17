import { MIN_RANKED_COTDS } from '../../db/schema';
import type { SelectCotdDay } from '../../db/schema';
import type {
  WebsiteCotdResult,
  WebsiteDataSource,
  WebsitePlayerHistoryPoint,
  WebsitePlayerProfile,
} from '../websiteData';
import type { RankThresholdBand } from '../rankService';
import { escapeHtml, formatRating, htmlResponse } from './html';

const PAGE_SIZE = 25;

function renderSearchForm(
  rankOptions: WebsiteDataSource['rankOptions'],
  value = '',
  selectedTier = '',
): string {
  return `<form class="my-5 flex max-w-2xl gap-2 max-[560px]:flex-wrap" action="/leaderboard" method="get">
    <input class="min-w-0 flex-1 rounded-lg border border-[#374456] bg-[#10151e] px-3 py-2 text-[#edf2f7] max-[560px]:basis-full" name="q" maxlength="64" value="${escapeHtml(value)}" placeholder="Exact Trackmania username" aria-label="Trackmania username">
    <select class="rounded-lg border border-[#374456] bg-[#10151e] px-3 py-2" name="tier" aria-label="Filter competitive rank">
      <option value="">All ranks</option>
      ${rankOptions.map(rank => `<option value="${escapeHtml(rank.code)}"${rank.code === selectedTier ? ' selected' : ''}>${escapeHtml(rank.label)}</option>`).join('')}
    </select>
    <button class="cursor-pointer rounded-lg bg-[#45c9b5] px-3 py-2 font-bold text-[#081512]" type="submit">Search / filter</button>
  </form>`;
}

export async function renderLeaderboard(
  url: URL,
  showRecentCotds: boolean,
  data: WebsiteDataSource,
): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim();
  const selectedTier = (url.searchParams.get('tier') ?? '').trim();
  if (query.length > 64) return htmlResponse('Leaderboard', '<h1>Search is too long</h1>', 400);
  if (selectedTier && !data.rankOptions.some(rank => rank.code === selectedTier)) {
    return htmlResponse('Leaderboard', '<h1>Invalid rank filter</h1><p>Select a rank from the leaderboard filters.</p>', 400);
  }

  if (query) {
    const accountId = await data.findAccountIdByUsername(query);
    if (!accountId) {
      return htmlResponse('Leaderboard', `<h1>Player not found</h1>
        ${renderSearchForm(data.rankOptions, query, selectedTier)}
        <p class="muted">No exact Trackmania username match for “${escapeHtml(query)}”.</p>`);
    }
    return Response.redirect(new URL(`/players/${encodeURIComponent(accountId)}`, url), 302);
  }

  const page = Number(url.searchParams.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
    return htmlResponse('Leaderboard', '<h1>Invalid page</h1><p>Page must be a positive integer.</p>', 400);
  }
  const { entries, total } = await data.getLeaderboardPage(page, PAGE_SIZE, selectedTier || undefined);
  const rows = entries.map(entry => {
    const delta = entry.previousRating === null
      ? '—'
      : `${entry.rating - entry.previousRating >= 0 ? '+' : ''}${(entry.rating - entry.previousRating).toFixed(1)}`;
    const color = `#${entry.tier.rank.tierColor.toString(16).padStart(6, '0')}`;
    return `<tr>
      <td class="text-right">#${entry.rank}</td>
      <td><a href="/players/${encodeURIComponent(entry.accountId)}">${escapeHtml(entry.username)}</a></td>
      <td class="text-right">${formatRating(entry.rating)}</td>
      <td><span class="badge" style="border-color:${escapeHtml(color)}">${escapeHtml(entry.tier.fullName)}</span></td>
      <td class="text-right">${escapeHtml(delta)}</td>
    </tr>`;
  }).join('');
  const pagination = total > 0
    ? `<div class="mt-4 flex items-center justify-between">
      <span class="muted">Page ${page} · ${total.toLocaleString('en-US')} eligible players${selectedTier ? ` in ${escapeHtml(data.rankOptions.find(rank => rank.code === selectedTier)!.label)}` : ''}</span>
      <span>
        ${page > 1 ? `<a href="/leaderboard?page=${page - 1}${selectedTier ? `&amp;tier=${encodeURIComponent(selectedTier)}` : ''}">← Previous</a>` : ''}
        ${page * PAGE_SIZE < total ? `<a class="ml-4" href="/leaderboard?page=${page + 1}${selectedTier ? `&amp;tier=${encodeURIComponent(selectedTier)}` : ''}">Next →</a>` : ''}
      </span>
    </div>`
    : '';
  const recentCotds = showRecentCotds
    ? renderCotdList(await data.getRecentProcessedCotdDays(10), true)
    : '';
  const content = `<h1>Glicko Leaderboard</h1>
    <p class="intro">COTD qualifying ratings for eligible players, ordered by rating.</p>
    ${renderSearchForm(data.rankOptions, '', selectedTier)}
    <section class="table-wrap"><table><thead><tr>
      <th class="text-right">Rank</th><th>Player</th><th class="text-right">Rating</th><th>Competitive rank</th><th class="text-right">Change</th>
    </tr></thead><tbody>
      ${rows || '<tr><td colspan="5" class="empty">No eligible players found.</td></tr>'}
    </tbody></table></section>
    ${pagination}
    ${recentCotds}`;
  return htmlResponse('Leaderboard', content);
}

export function renderCotdList(days: SelectCotdDay[], compact = false): string {
  const items = days.map(day => `<li><a href="/cotd/${day.cupId}">${escapeHtml(day.name)}</a>
    <span class="muted"> · ${escapeHtml(day.cotdDate)} · ${(day.cardinal ?? 0).toLocaleString('en-US')} players</span></li>`).join('');
  return `<section class="panel"><h2>${compact ? 'Recent COTDs' : 'Recent Cup of the Day results'}</h2>
    ${items ? `<ul class="list">${items}</ul>` : '<p class="muted">No processed COTD results are available yet.</p>'}</section>`;
}

function formatRatingChange(change: number | null): string {
  if (change === null) return '—';
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}`;
}

export function renderRatingChart(
  history: WebsitePlayerHistoryPoint[],
  bands: RankThresholdBand[] = [],
): string {
  if (history.length === 0) return '<p class="muted">No eligible rating history is available yet.</p>';
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
  const rankZones = bands.map(band => {
    const bandMinimum = Math.max(minimum, band.minRating);
    const bandMaximum = Math.min(maximum, band.maxRating);
    if (bandMaximum <= bandMinimum) return '';
    const y = yAt(bandMaximum);
    const bandHeight = yAt(bandMinimum) - y;
    if (bandHeight < 1) return '';
    const color = escapeHtml(band.rank.svgColor);
    return `<g>
      <rect x="${margin.left}" y="${y}" width="${plotWidth}" height="${bandHeight}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.45"/>
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${color}" stroke-opacity="0.9" stroke-width="1.5"/>
      ${bandHeight >= 17 ? `<text x="${margin.left + 7}" y="${y + 13}" fill="${color}" font-size="11" font-weight="700">${escapeHtml(band.rank.shortName)}</text>` : ''}
    </g>`;
  }).join('');
  const grid = Array.from({ length: Math.floor((maximum - minimum) / 100) + 1 }, (_, index) => {
    const rating = minimum + index * 100;
    const y = yAt(rating);
    return `<g>
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#26303c" stroke-dasharray="3 4"/>
      <text x="${margin.left - 10}" y="${y + 4}" fill="#9aa4b2" font-size="12" text-anchor="end">${formatRating(rating)}</text>
    </g>`;
  }).join('');
  const path = history.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point.rating).toFixed(1)}`
  ).join(' ');
  const hoverTargets = history.map((point, index) => `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(point.rating).toFixed(1)}" r="5" fill="transparent" pointer-events="all">
    <title>${escapeHtml(point.cotdDate)} · ${escapeHtml(point.name)} · rating ${formatRating(point.rating)} · change ${escapeHtml(formatRatingChange(point.ratingChange))}</title>
  </circle>`).join('');

  return `<div class="chart-wrap"><svg class="block h-auto w-full rounded-xl bg-[#111720]" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rating history from ${escapeHtml(history[0].cotdDate)} to ${escapeHtml(history[history.length - 1].cotdDate)}">
    ${rankZones}
    ${grid}
    <path d="${path}" fill="none" stroke="#45c9b5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${hoverTargets}
    <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="#354151"/>
    <text x="${margin.left}" y="${height - 10}" fill="#a4afbd" font-size="12">${escapeHtml(history[0].cotdDate)}</text>
    <text x="${width - margin.right}" y="${height - 10}" fill="#a4afbd" font-size="12" text-anchor="end">${escapeHtml(history[history.length - 1].cotdDate)}</text>
  </svg></div>`;
}

function renderPlayerCotdResults(history: WebsitePlayerHistoryPoint[]): string {
  if (history.length === 0) return '<p class="muted">No recent results available.</p>';
  const items = history.slice(-10).reverse().map(result =>
    `<li><a href="/cotd/${result.cupId}">${escapeHtml(result.name)}</a>
      <span class="muted"> · ${escapeHtml(result.cotdDate)} · placement ${result.rank === null ? 'unavailable' : `#${result.rank}`}
      · rating ${formatRating(result.rating)} ${result.ratingChange !== null ? `(${result.ratingChange > 0 ? '+' : ''}${result.ratingChange.toFixed(1)})` : ''}</span></li>`
  ).join('');
  return `<ul class="list">${items}</ul>`;
}

export function renderPlayerProfile(profile: WebsitePlayerProfile | null, accountId: string): Response {
  if (!profile) {
    return htmlResponse('Player not found', '<h1>Player not found</h1><p><a href="/leaderboard">Browse the leaderboard</a></p>', 404);
  }
  if (profile.status === 'unranked') {
    return htmlResponse(`${profile.username} profile`, `<h1>${escapeHtml(profile.username)}</h1>
      <p class="intro">This player is not ranked yet. Stats and leaderboard placement are available after completing ${MIN_RANKED_COTDS} COTDs.</p>
      <p class="muted">Completed COTDs: ${profile.matchCount}</p>
      <p><a href="/leaderboard">← Back to leaderboard</a></p>`, 404);
  }

  const { username, state, rank, total, tier, topPercentageText, peakRating, divisionEstimate, history, rankBands } = profile;
  const firstHistoryDate = history[0]?.cotdDate ?? '—';
  const lastHistoryDate = history[history.length - 1]?.cotdDate ?? '—';
  const content = `<p class="muted"><a href="/leaderboard">← Leaderboard</a></p>
    <h1>${escapeHtml(username)}</h1>
    <p class="intro">Trackmania player profile · <a href="/players/${encodeURIComponent(accountId)}">share this page</a></p>
    <div class="stats">
      <div class="stat"><span>Leaderboard rank</span><strong>#${rank} of ${total.toLocaleString('en-US')}</strong></div>
      <div class="stat"><span>Rating</span><strong>${formatRating(state.rating)}</strong></div>
      <div class="stat"><span>Competitive rank</span><strong>${escapeHtml(tier.fullName)}</strong><span>Top ${escapeHtml(topPercentageText)}%</span></div>
      <div class="stat"><span>COTD division estimate</span><strong>${divisionEstimate === null ? 'Unavailable' : `Division ${divisionEstimate}`}</strong></div>
      <div class="stat"><span>Eligible-era peak</span><strong>${peakRating === null ? 'Unavailable' : formatRating(peakRating)}</strong></div>
      <div class="stat"><span>Completed COTDs</span><strong>${state.matchCount.toLocaleString('en-US')}</strong></div>
    </div>
    <section class="panel"><h2>Rating history</h2>
      <p class="muted">Showing up to the latest ${history.length} eligible results · ${escapeHtml(firstHistoryDate)} to ${escapeHtml(lastHistoryDate)}</p>
      ${renderRatingChart(history, rankBands)}
    </section>
    <section class="panel"><h2>Recent COTD results</h2>${renderPlayerCotdResults(history)}</section>`;
  return htmlResponse(`${username} profile`, content);
}

export function renderCotdDetail(cotd: { day: SelectCotdDay; results: WebsiteCotdResult[] } | null): Response {
  if (!cotd) {
    return htmlResponse('COTD not found', '<h1>COTD results not found</h1><p><a href="/cotd">Browse recent COTDs</a></p>', 404);
  }
  const { day, results } = cotd;
  const rows = results.map(result => `<tr>
    <td class="text-right">#${result.rank}</td>
    <td><a href="/players/${encodeURIComponent(result.player)}">${escapeHtml(result.username)}</a></td>
    <td class="text-right">${result.score === null ? '—' : result.score.toLocaleString('en-US')}</td>
  </tr>`).join('');
  const content = `<p class="muted"><a href="/cotd">← Recent COTDs</a></p>
    <h1>${escapeHtml(day.name)}</h1>
    <p class="intro">${escapeHtml(day.cotdDate)} · ${(day.cardinal ?? 0).toLocaleString('en-US')} players</p>
    <section class="table-wrap"><table><thead><tr><th class="text-right">Placement</th><th>Player</th><th class="text-right">Score</th></tr></thead><tbody>
      ${rows || '<tr><td colspan="3" class="empty">Placement data is unavailable for this COTD.</td></tr>'}
    </tbody></table></section>
    <p class="muted">Showing the top ${results.length} placements.</p>`;
  return htmlResponse(`${day.name} results`, content);
}
