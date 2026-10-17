import { MIN_RANKED_COTDS } from '../../db/schema';

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
  <script>document.documentElement.classList.add('document-loading');window.__initialLoaderFallback=window.setTimeout(()=>document.documentElement.classList.remove('document-loading'),5000);</script>
  <link rel="stylesheet" href="/assets/site.css">
  <script src="/assets/site.js" defer=""></script>
</head>
<body class="m-0 min-h-screen bg-[#10151e] font-sans leading-6 text-[#edf2f7]">
  <header class="border-b border-[#28313d] bg-[#151b25]">
    <nav class="mx-auto flex min-h-16 w-[min(1100px,calc(100%-32px))] items-center gap-6 max-[560px]:gap-3">
      <strong class="mr-auto text-lg text-white"><a href="/">TM Glicko</a></strong>
      <a href="/leaderboard">Leaderboard</a><a href="/cotd">COTDs</a>
    </nav>
  </header>
  <main id="main-content" class="mx-auto w-[min(1100px,calc(100%-32px))] py-8 pb-14 max-[560px]:pt-6">
    <div id="initial-loader" class="loading-page" role="status" aria-label="Loading page">
      <span class="sr-only">Loading page…</span>
      <span class="skeleton skeleton-heading"></span>
      <span class="skeleton skeleton-line"></span>
      <span class="skeleton skeleton-table"></span>
    </div>
    <div id="page-content" class="page-enter">${content}</div>
  </main>
  <footer class="border-t border-[#28313d] p-5 text-center text-sm text-[#8290a1]">
    Trackmania COTD ratings · Ranked after ${MIN_RANKED_COTDS} completed COTDs ·
    <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a>
  </footer>
</body>
</html>`;
}

export function htmlResponse(title: string, content: string, status = 200): Response {
  return new Response(layout(title, content), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function formatRating(rating: number): string {
  return Math.round(rating).toLocaleString('en-US');
}
