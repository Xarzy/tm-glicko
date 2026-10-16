import { MIN_RANKED_COTDS } from '../db/schema';
import type { SelectCotdDay } from '../db/schema';
import type {
  WebsiteCotdResult,
  WebsiteDataSource,
  WebsitePlayerHistoryPoint,
  WebsitePlayerProfile,
} from './websiteData';

const PAGE_SIZE = 50;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#10151e">
  <title>${escapeHtml(title)} · TM Glicko</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#10151e;color:#edf2f7}
    *{box-sizing:border-box}body{margin:0;line-height:1.5}a{color:#75d8ca;text-decoration:none}a:hover{text-decoration:underline}
    header{border-bottom:1px solid #28313d;background:#151b25}nav,main{width:min(1100px,calc(100% - 32px));margin:auto}
    nav{display:flex;gap:24px;align-items:center;min-height:64px}nav strong{font-size:1.1rem;margin-right:auto;color:#fff}
    main{padding:32px 0 56px}h1{font-size:clamp(1.8rem,4vw,2.5rem);line-height:1.15;margin:0 0 8px}
    h2{font-size:1.2rem;margin:28px 0 12px}.muted{color:#a4afbd}.intro{margin:0 0 24px;color:#a4afbd}
    .panel{background:#171e29;border:1px solid #293442;border-radius:14px;padding:20px;margin:18px 0}
    form.search{display:flex;gap:8px;max-width:620px;margin:22px 0}input,button{font:inherit;border-radius:8px;padding:10px 12px}
    input{min-width:0;flex:1;color:#edf2f7;background:#10151e;border:1px solid #374456}button{border:0;background:#45c9b5;color:#081512;font-weight:700;cursor:pointer}
    .table-wrap{overflow-x:auto;border:1px solid #293442;border-radius:12px}table{width:100%;border-collapse:collapse;min-width:620px;background:#171e29}
    th,td{text-align:left;padding:11px 14px;border-bottom:1px solid #293442;white-space:nowrap}th{color:#a4afbd;font-size:.83rem;text-transform:uppercase;letter-spacing:.04em}
    tr:last-child td{border-bottom:0}.right{text-align:right}.badge{display:inline-block;border:1px solid #3b4655;border-radius:99px;padding:2px 9px;font-size:.83rem}
    .pagination{display:flex;justify-content:space-between;align-items:center;margin-top:16px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0}
    .stat{background:#171e29;border:1px solid #293442;border-radius:12px;padding:14px}.stat span{display:block;color:#a4afbd;font-size:.85rem}.stat strong{font-size:1.2rem}
    .list{padding:0;list-style:none}.list li{padding:12px 0;border-bottom:1px solid #293442}.list li:last-child{border:0}
    .chart{width:100%;height:auto;display:block;background:#111720;border-radius:12px}.empty{padding:22px;text-align:center;color:#a4afbd}
    footer{color:#8290a1;border-top:1px solid #28313d;padding:20px;text-align:center;font-size:.85rem}
    @media(max-width:560px){nav{gap:14px;font-size:.9rem}main{padding-top:24px}.panel{padding:15px}form.search{flex-wrap:wrap}form.search input{flex-basis:100%}}
  </style>
</head>
<body>
  <header><nav><strong><a href="/">TM Glicko</a></strong><a href="/leaderboard">Leaderboard</a><a href="/cotd">COTDs</a></nav></header>
  <main>${content}</main>
  <footer>Trackmania COTD ratings · Ranked after ${MIN_RANKED_COTDS} completed COTDs</footer>
</body>
</html>`;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function formatRating(rating: number): string {
  return Math.round(rating).toLocaleString('en-US');
}

function renderSearchForm(
  rankOptions: WebsiteDataSource['rankOptions'],
  value = '',
  selectedTier = '',
): string {
  return `<form class="search" action="/leaderboard" method="get">
    <input name="q" maxlength="64" value="${escapeHtml(value)}" placeholder="Exact Trackmania username" aria-label="Trackmania username">
    <select name="tier" aria-label="Filter competitive rank">
      <option value="">All ranks</option>
      ${rankOptions.map(rank => `<option value="${escapeHtml(rank.code)}"${rank.code === selectedTier ? ' selected' : ''}>${escapeHtml(rank.label)}</option>`).join('')}
    </select>
    <button type="submit">Search / filter</button>
  </form>`;
}

async function renderLeaderboard(url: URL, showRecentCotds: boolean, data: WebsiteDataSource): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim();
  const selectedTier = (url.searchParams.get('tier') ?? '').trim();
  if (query.length > 64) return htmlResponse(layout('Leaderboard', '<h1>Search is too long</h1>'), 400);
  if (selectedTier && !data.rankOptions.some(rank => rank.code === selectedTier)) {
    return htmlResponse(layout('Leaderboard', '<h1>Invalid rank filter</h1><p>Select a rank from the leaderboard filters.</p>'), 400);
  }

  if (query) {
    const accountId = await data.findAccountIdByUsername(query);
    if (!accountId) {
      return htmlResponse(layout(
        'Leaderboard',
        `<h1>Player not found</h1>${renderSearchForm(data.rankOptions, query, selectedTier)}<p class="muted">No exact Trackmania username match for “${escapeHtml(query)}”.</p>`,
      ));
    }
    return Response.redirect(new URL(`/players/${encodeURIComponent(accountId)}`, url), 302);
  }

  const page = Number(url.searchParams.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
    return htmlResponse(layout('Leaderboard', '<h1>Invalid page</h1><p>Page must be a positive integer.</p>'), 400);
  }
  const from = (page - 1) * PAGE_SIZE + 1;
  const { entries, total } = await data.getLeaderboardPage(page, PAGE_SIZE, selectedTier || undefined);
  const rows = entries.map(entry => {
    const delta = entry.previousRating === null
      ? '—'
      : `${entry.rating - entry.previousRating >= 0 ? '+' : ''}${(entry.rating - entry.previousRating).toFixed(1)}`;
    const color = `#${entry.tier.rank.tierColor.toString(16).padStart(6, '0')}`;
    return `<tr>
      <td class="right">#${entry.rank}</td>
      <td><a href="/players/${encodeURIComponent(entry.accountId)}">${escapeHtml(entry.username)}</a></td>
      <td class="right">${formatRating(entry.rating)}</td>
      <td><span class="badge" style="border-color:${color}">${escapeHtml(entry.tier.fullName)}</span></td>
      <td class="right">${escapeHtml(delta)}</td>
    </tr>`;
  });
  const content = [
    '<h1>Glicko Leaderboard</h1>',
    '<p class="intro">COTD qualifying ratings for eligible players, ordered by rating.</p>',
    renderSearchForm(data.rankOptions, '', selectedTier),
    `<section class="table-wrap"><table><thead><tr><th class="right">Rank</th><th>Player</th><th class="right">Rating</th><th>Competitive rank</th><th class="right">Change</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="5" class="empty">No eligible players found.</td></tr>'}</tbody></table></section>`,
    total > 0
      ? `<div class="pagination"><span class="muted">Page ${page} · ${total.toLocaleString('en-US')} eligible players${selectedTier ? ` in ${escapeHtml(data.rankOptions.find(rank => rank.code === selectedTier)!.label)}` : ''}</span><span>${page > 1 ? `<a href="/leaderboard?page=${page - 1}${selectedTier ? `&amp;tier=${encodeURIComponent(selectedTier)}` : ''}">← Previous</a>` : ''}${page * PAGE_SIZE < total ? `　<a href="/leaderboard?page=${page + 1}${selectedTier ? `&amp;tier=${encodeURIComponent(selectedTier)}` : ''}">Next →</a>` : ''}</span></div>`
      : '',
  ];

  if (showRecentCotds) {
    content.push(renderCotdList(await data.getRecentProcessedCotdDays(10), true));
  }
  return htmlResponse(layout('Leaderboard', content.join('')));
}

function renderCotdList(days: SelectCotdDay[], compact = false): string {
  const items = days.map(day => `<li><a href="/cotd/${day.cupId}">${escapeHtml(day.name)}</a>
    <span class="muted"> · ${escapeHtml(day.cotdDate)} · ${(day.cardinal ?? 0).toLocaleString('en-US')} players</span></li>`);
  return `<section class="panel"><h2>${compact ? 'Recent COTDs' : 'Recent Cup of the Day results'}</h2>
    ${items.length ? `<ul class="list">${items.join('')}</ul>` : '<p class="muted">No processed COTD results are available yet.</p>'}</section>`;
}

export function renderRatingChart(history: { cotdDate: string; rating: number }[]): string {
  if (history.length === 0) return '<p class="muted">No eligible rating history is available yet.</p>';
  const width = 900;
  const height = 240;
  const padding = 28;
  const values = history.map(point => point.rating);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const points = history.map((point, index) => {
    const x = padding + (index / Math.max(1, history.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.rating - minimum) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rating history from ${escapeHtml(history[0].cotdDate)} to ${escapeHtml(history[history.length - 1].cotdDate)}">
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#354151"/>
    <polyline points="${points}" fill="none" stroke="#45c9b5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${padding}" y="20" fill="#a4afbd" font-size="13">${formatRating(maximum)}</text>
    <text x="${padding}" y="${height - 6}" fill="#a4afbd" font-size="13">${formatRating(minimum)}</text>
    <text x="${width - padding}" y="${height - 6}" fill="#a4afbd" font-size="13" text-anchor="end">${escapeHtml(history[history.length - 1].cotdDate)}</text>
  </svg>`;
}

function renderPlayerCotdResults(history: WebsitePlayerHistoryPoint[]): string {
  if (history.length === 0) return '<p class="muted">No recent results available.</p>';
  const items = history.slice(-10).reverse().map(result =>
    `<li><a href="/cotd/${result.cupId}">${escapeHtml(result.name)}</a>
      <span class="muted"> · ${escapeHtml(result.cotdDate)} · placement ${result.rank === null ? 'unavailable' : `#${result.rank}`}
      · rating ${formatRating(result.rating)}${result.cardinal ? ` / ${result.cardinal.toLocaleString('en-US')}` : ''}</span></li>`
  );
  return `<ul class="list">${items.join('')}</ul>`;
}

function renderPlayerProfile(profile: WebsitePlayerProfile | null, accountId: string): Response {
  if (!profile) {
    return htmlResponse(layout('Player not found', '<h1>Player not found</h1><p><a href="/leaderboard">Browse the leaderboard</a></p>'), 404);
  }
  if (profile.status === 'unranked') {
    return htmlResponse(layout(
      `${profile.username} profile`,
      `<h1>${escapeHtml(profile.username)}</h1><p class="intro">This player is not ranked yet. Stats and leaderboard placement are available after completing ${MIN_RANKED_COTDS} COTDs.</p><p class="muted">Completed COTDs: ${profile.matchCount}</p><p><a href="/leaderboard">← Back to leaderboard</a></p>`,
    ), 404);
  }

  const {
    username,
    state,
    rank,
    total,
    tier,
    topPercentageText,
    peakRating,
    divisionEstimate,
    history,
  } = profile;
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
      ${renderRatingChart(history)}
    </section>
    <section class="panel"><h2>Recent COTD results</h2>${renderPlayerCotdResults(history)}</section>`;
  return htmlResponse(layout(`${username} profile`, content));
}

function renderCotdDetail(cotd: { day: SelectCotdDay; results: WebsiteCotdResult[] } | null): Response {
  if (!cotd) {
    return htmlResponse(layout('COTD not found', '<h1>COTD results not found</h1><p><a href="/cotd">Browse recent COTDs</a></p>'), 404);
  }
  const { day, results } = cotd;
  const rows = results.map(result => `<tr>
    <td class="right">#${result.rank}</td>
    <td><a href="/players/${encodeURIComponent(result.player)}">${escapeHtml(result.username)}</a></td>
    <td class="right">${result.score === null ? '—' : result.score.toLocaleString('en-US')}</td>
  </tr>`);
  const content = `<p class="muted"><a href="/cotd">← Recent COTDs</a></p>
    <h1>${escapeHtml(day.name)}</h1><p class="intro">${escapeHtml(day.cotdDate)} · ${(day.cardinal ?? 0).toLocaleString('en-US')} players</p>
    <section class="table-wrap"><table><thead><tr><th class="right">Placement</th><th>Player</th><th class="right">Score</th></tr></thead><tbody>
      ${rows.join('') || '<tr><td colspan="3" class="empty">Placement data is unavailable for this COTD.</td></tr>'}
    </tbody></table></section>
    <p class="muted">Showing the top ${results.length} placements.</p>`;
  return htmlResponse(layout(`${day.name} results`, content));
}

async function handleRequest(request: Request, data?: WebsiteDataSource): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === '/health') return Response.json({ status: 'ok' });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  try {
    if (pathname === '/' || pathname === '/leaderboard') {
      const query = (url.searchParams.get('q') ?? '').trim();
      const page = Number(url.searchParams.get('page') ?? '1');
      if (query.length > 64) return htmlResponse(layout('Leaderboard', '<h1>Search is too long</h1>'), 400);
      if (!query && (!Number.isInteger(page) || page < 1 || page > 1_000_000)) {
        return htmlResponse(layout('Leaderboard', '<h1>Invalid page</h1><p>Page must be a positive integer.</p>'), 400);
      }
      const source = data ?? (await import('./websiteData')).websiteData;
      return await renderLeaderboard(url, pathname === '/', source);
    }
    if (pathname === '/cotd') {
      const source = data ?? (await import('./websiteData')).websiteData;
      return htmlResponse(layout('Recent COTDs', renderCotdList(await source.getRecentProcessedCotdDays(50))));
    }
    const playerMatch = /^\/players\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
    if (playerMatch) {
      const source = data ?? (await import('./websiteData')).websiteData;
      return renderPlayerProfile(await source.getPlayerProfile(playerMatch[1]), playerMatch[1]);
    }
    const cotdMatch = /^\/cotd\/(\d+)$/.exec(pathname);
    if (cotdMatch) {
      const cupId = Number(cotdMatch[1]);
      if (!Number.isSafeInteger(cupId) || cupId < 1) {
        return htmlResponse(layout('Invalid COTD', '<h1>Invalid COTD ID</h1>'), 400);
      }
      const source = data ?? (await import('./websiteData')).websiteData;
      return renderCotdDetail(await source.getCotdDetail(cupId));
    }
    return htmlResponse(layout('Not found', '<h1>Page not found</h1><p><a href="/">Go to the leaderboard</a></p>'), 404);
  } catch (error) {
    console.error(`[web] request failed for ${pathname}:`, error);
    return new Response('The website could not load this page. Please try again shortly.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}

export function startWebServer(port: number, data?: WebsiteDataSource) {
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    fetch: request => handleRequest(request, data),
  });
  console.log(`[web] listening on 0.0.0.0:${server.port}`);
  return server;
}
