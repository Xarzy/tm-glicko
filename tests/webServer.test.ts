// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { expect, test } from 'bun:test';
import { startWebServer } from '../src/services/webServer';

test('web server answers the hosting proxy on its bound port', async () => {
  const server = startWebServer(0);

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('TM Glicko');
  } finally {
    server.stop(true);
  }
});

test('web server exposes a health endpoint and returns 404 for unknown paths', async () => {
  const server = startWebServer(0);

  try {
    const healthResponse = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(await healthResponse.json()).toEqual({ status: 'ok' });

    const missingResponse = await fetch(`http://127.0.0.1:${server.port}/missing`);
    expect(missingResponse.status).toBe(404);
  } finally {
    server.stop(true);
  }
});
