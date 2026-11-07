import { finishDailyUpdateRun, startDailyUpdateRun } from '../db';

export async function runTrackedDailyUpdate(operation: () => Promise<void>): Promise<void> {
  const runId = await startDailyUpdateRun();
  try {
    await operation();
    await finishDailyUpdateRun(runId, 'succeeded');
  } catch (error) {
    try {
      await finishDailyUpdateRun(runId, 'failed');
    } catch (statusError) {
      console.error(`[daily] could not record failure for run ${runId}:`, statusError);
    }
    throw error;
  }
}
