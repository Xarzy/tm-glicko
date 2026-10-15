import { describe, expect, test } from 'bun:test';
import { retryDatabaseCall } from '../src/db/retry';

describe('retryDatabaseCall', () => {
  test('retries failed calls and returns the successful result', async () => {
    let attempts = 0;

    const result = await retryDatabaseCall('test query', async () => {
      attempts++;
      if (attempts < 3) throw new Error('temporary failure');
      return 'success';
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  test('gives up after ten retries and rethrows the last error', async () => {
    let attempts = 0;
    const failure = new Error('database unavailable');

    await expect(
      retryDatabaseCall('test query', async () => {
        attempts++;
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(attempts).toBe(11);
  });
});
