import { Hono } from 'hono';
import { join } from 'node:path';
import type { WebsiteDataSource } from '../websiteData';
import { htmlLoadingResponse, htmlResponse, Layout } from './html';
import { renderLegalPage } from './legalPages';
import { CotdList, renderCotdDetail, renderLeaderboard, renderPlayerProfile } from './pages';

async function getDataSource(data?: WebsiteDataSource): Promise<WebsiteDataSource> {
  return data ?? (await import('../websiteData')).websiteData;
}

function initialPageResponse(request: Request, title: string): Response | null {
  return request.headers.get('X-Requested-With') === 'TM-Glicko-Navigation'
    ? null
    : htmlLoadingResponse(title);
}

export function createWebsiteApp(data?: WebsiteDataSource) {
  const app = new Hono();

  app.use('*', async (context, next) => {
    if (context.req.path !== '/health' && context.req.method !== 'GET' && context.req.method !== 'HEAD') {
      return context.text('Method not allowed', 405, { allow: 'GET, HEAD' });
    }
    await next();
  });

  app.all('/health', context => context.json({ status: 'ok' }));
  app.get('/assets/site.css', async context => {
    const stylesheet = Bun.file(join(import.meta.dir, '../../../public/site.css'));
    if (!(await stylesheet.exists())) {
      console.error('[web] Tailwind stylesheet is missing; run `bun run build:css`.');
      return context.text('Website stylesheet is unavailable.', 500);
    }
    return new Response(stylesheet, {
      headers: {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    });
  });
  app.get('/assets/site.js', async context => {
    const script = Bun.file(join(import.meta.dir, '../../../public/site.js'));
    if (!(await script.exists())) {
      console.error('[web] website navigation script is missing.');
      return context.text('Website navigation is unavailable.', 500);
    }
    return new Response(script, {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    });
  });
  app.on(['GET', 'HEAD'], '/', async context =>
    initialPageResponse(context.req.raw, 'Leaderboard')
      ?? renderLeaderboard(new URL(context.req.url), true, await getDataSource(data))
  );
  app.on(['GET', 'HEAD'], '/leaderboard', async context =>
    initialPageResponse(context.req.raw, 'Leaderboard')
      ?? renderLeaderboard(new URL(context.req.url), false, await getDataSource(data))
  );
  app.on(['GET', 'HEAD'], '/cotd', async context => {
    const initialResponse = initialPageResponse(context.req.raw, 'Recent COTDs');
    if (initialResponse) return initialResponse;
    const source = await getDataSource(data);
    return htmlResponse('Recent COTDs', <CotdList days={await source.getRecentProcessedCotdDays(50)} />);
  });
  app.on(['GET', 'HEAD'], '/terms', () => renderLegalPage('terms'));
  app.on(['GET', 'HEAD'], '/privacy', () => renderLegalPage('privacy'));
  app.on(['GET', 'HEAD'], '/players/:accountId', async context => {
    const accountId = context.req.param('accountId');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
      return htmlResponse('Not found', <><h1>Page not found</h1><p><a href="/">Go to the leaderboard</a></p></>, 404);
    }
    const initialResponse = initialPageResponse(context.req.raw, 'Player profile');
    if (initialResponse) return initialResponse;
    const source = await getDataSource(data);
    return renderPlayerProfile(await source.getPlayerProfile(accountId), accountId);
  });
  app.on(['GET', 'HEAD'], '/cotd/:cupId', async context => {
    const rawCupId = context.req.param('cupId');
    if (!/^\d+$/.test(rawCupId)) {
      return htmlResponse('Invalid COTD', <h1>Invalid COTD ID</h1>, 400);
    }
    const cupId = Number(rawCupId);
    if (!Number.isSafeInteger(cupId) || cupId < 1) {
      return htmlResponse('Invalid COTD', <h1>Invalid COTD ID</h1>, 400);
    }
    const initialResponse = initialPageResponse(context.req.raw, 'COTD results');
    if (initialResponse) return initialResponse;
    const source = await getDataSource(data);
    return renderCotdDetail(await source.getCotdDetail(cupId));
  });

  app.onError((error, context) => {
    console.error(`[web] request failed for ${context.req.path}:`, error);
    return context.text('The website could not load this page. Please try again shortly.', 500, {
      'cache-control': 'no-store',
    });
  });
  app.notFound(() => htmlResponse(
    'Not found',
    <><h1>Page not found</h1><p><a href="/">Go to the leaderboard</a></p></>,
    404,
  ));

  return app;
}
