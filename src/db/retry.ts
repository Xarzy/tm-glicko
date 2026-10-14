const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 1000;

export async function retryDatabaseCall<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= MAX_RETRIES) {
        console.error(`[database] ${operationName} failed after ${attempt + 1} attempts.`, error);
        throw error;
      }

      const delayMs = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
      console.warn(
        `[database] ${operationName} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}); retrying in ${delayMs}ms.`,
        error,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
