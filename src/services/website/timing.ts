export async function timeWebStage<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    console.info(`[web-timing] ${label}: ${(performance.now() - started).toFixed(1)}ms`);
  }
}

export function timeWebStageSync<T>(label: string, operation: () => T): T {
  const started = performance.now();
  try {
    return operation();
  } finally {
    console.info(`[web-timing] ${label}: ${(performance.now() - started).toFixed(1)}ms`);
  }
}
