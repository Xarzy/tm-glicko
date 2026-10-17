import type { WebsiteDataSource } from './websiteData';
import { createWebsiteApp } from './website/routes';

export { escapeHtml } from './website/html';
export { renderRatingChart } from './website/pages';

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
