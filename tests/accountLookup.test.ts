// @ts-ignore @types/bun 1.1.14 does not declare bun:test in the editor.
import { afterAll, expect, mock, test } from 'bun:test';

mock.module('../src/services/trackmaniaOAuth', () => ({
  getOAuthToken: async () => 'test-token',
}));

const originalFetch = globalThis.fetch;
let responses: Response[] = [];
const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  responses.shift() ?? new Response(null, { status: 500 })
);
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: fetchMock,
});

const {
  findAccountIdByUsername,
  findAccountIdsByUsernames,
  findUsernameByAccountId,
  findUsernamesByAccountIds,
} = await import('../src/services/accountLookup');

afterAll(() => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

test('display-name lookup respects Retry-After and persists each successful batch', async () => {
  responses = [
    new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
    new Response(JSON.stringify({ player: 'Player Name' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ];
  fetchMock.mockClear();
  const savedBatches: Map<string, string>[] = [];
  const progress: { completed: number; total: number; found: number }[] = [];

  const names = await findUsernamesByAccountIds(['player'], {
    onBatchResults: async batch => {
      savedBatches.push(batch);
    },
    onBatchComplete: batchProgress => {
      progress.push(batchProgress);
    },
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(names).toEqual(new Map([['player', 'Player Name']]));
  expect(savedBatches).toEqual([new Map([['player', 'Player Name']])]);
  expect(progress).toEqual([{ completed: 1, total: 1, found: 1 }]);
});

test('display-name lookup fails explicitly for non-rate-limit HTTP errors', async () => {
  responses = [new Response(null, { status: 500 })];
  fetchMock.mockClear();

  await expect(findUsernamesByAccountIds(['player'])).rejects.toThrow('failed with HTTP 500');
});

test('username lookups normalize names and return null for missing results', async () => {
  responses = [
    new Response(JSON.stringify({ 'Player Name': 'player-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response(JSON.stringify({ 'player-id': 'Player Name' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ];

  expect(await findAccountIdsByUsernames([])).toEqual(new Map());
  expect(await findAccountIdByUsername('Player Name')).toBe('player-id');
  expect(await findUsernameByAccountId('player-id')).toBe('Player Name');
});

test('display-name lookup retries date-form Retry-After values and delays between batches', async () => {
  responses = [
    new Response(null, { status: 429, headers: { 'Retry-After': new Date(0).toUTCString() } }),
    new Response(JSON.stringify({ player: 'Player Name' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response(JSON.stringify({ 'player-51': 'Another Player' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ];
  fetchMock.mockClear();

  const names = await findUsernamesByAccountIds(
    Array.from({ length: 51 }, (_, index) => `player-${index + 1}`),
    { minDelayMs: 1 },
  );

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(names.get('player')).toBe('Player Name');
  expect(names.get('player-51')).toBe('Another Player');
});

test('display-name lookup stops after repeated rate limits', async () => {
  responses = Array.from({ length: 5 }, () =>
    new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
  );
  fetchMock.mockClear();

  await expect(findUsernamesByAccountIds(['player'])).rejects.toThrow('failed with HTTP 429');
  expect(fetchMock).toHaveBeenCalledTimes(5);
});
