import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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

export function Layout({
  title,
  children,
  initialLoad = false,
}: {
  title: string;
  children: ReactNode;
  initialLoad?: boolean;
}) {
  return <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#10151e" />
      <title>{`${title} · TM Glicko`}</title>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.classList.add('document-loading');window.__initialLoaderFallback=window.setTimeout(()=>document.documentElement.classList.remove('document-loading'),5000);` }} />
      <link rel="stylesheet" href="/assets/site.css" />
      <script src="/assets/site.js" defer />
    </head>
    <body className="m-0 min-h-screen bg-[#10151e] font-sans leading-6 text-[#edf2f7]">
      <header className="border-b border-[#28313d] bg-[#151b25]">
        <nav className="mx-auto flex min-h-16 w-[min(1100px,calc(100%-32px))] items-center gap-6 max-[560px]:gap-3">
          <strong className="mr-auto text-lg text-white"><a href="/">TM Glicko</a></strong>
          <a href="/leaderboard">Leaderboard</a><a href="/cotd">COTDs</a>
        </nav>
      </header>
      <main id="main-content" data-initial-load={initialLoad ? 'true' : undefined} className="mx-auto w-[min(1100px,calc(100%-32px))] py-8 pb-14 max-[560px]:pt-6">
        <div id="initial-loader" className="loading-page" role="status" aria-label="Loading page">
          <span className="sr-only">Loading page…</span>
          <span className="skeleton skeleton-heading" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-table" />
        </div>
        <div id="page-content" className="page-enter">{children}</div>
      </main>
      <footer className="border-t border-[#28313d] p-5 text-center text-sm text-[#8290a1]">
        Trackmania COTD ratings · Ranked after {MIN_RANKED_COTDS} completed COTDs ·{' '}
        <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a>
      </footer>
    </body>
  </html>;
}

export function htmlResponse(title: string, content: ReactNode, status = 200): Response {
  const markup = '<!doctype html>' + renderToStaticMarkup(<Layout title={title}>{content}</Layout>);
  return new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function htmlLoadingResponse(title: string): Response {
  const markup = '<!doctype html>' + renderToStaticMarkup(
    <Layout title={title} initialLoad>{null}</Layout>,
  );
  return new Response(markup, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function formatRating(rating: number): string {
  return Math.round(rating).toLocaleString('en-US');
}
