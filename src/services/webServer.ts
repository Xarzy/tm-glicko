function handleRequest(request: Request): Response {
  const { pathname } = new URL(request.url);

  if (pathname === '/health') {
    return Response.json({ status: 'ok' });
  }

  if (pathname !== '/') {
    return new Response('Not found', { status: 404 });
  }

  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>TM Glicko</title>'
      + '<body><main><h1>TM Glicko</h1><p>The bot is online.</p></main></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export function startWebServer(port: number) {
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    fetch: handleRequest,
  });
  console.log(`[web] listening on 0.0.0.0:${server.port}`);
  return server;
}
