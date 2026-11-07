import type { WebsiteDataSource } from './data';
import { createWebsiteApp } from './routes';

export { escapeHtml } from './html';
export { renderRatingChart } from './components/rating-chart';

export function startWebServer(port: number, data?: WebsiteDataSource) {
  const app = createWebsiteApp(data);
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    fetch: app.fetch,
  });
  console.log(`[web] listening on 0.0.0.0:${server.port}`);
  return server;
}
