import type { WebsiteDailyUpdateStatus } from '../data';

const STALE_AFTER_MS = 36 * 60 * 60 * 1_000;

const utcDateTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function DataFreshness({
  lastProcessedAt,
  dailyUpdateStatus,
}: {
  lastProcessedAt: Date | null;
  dailyUpdateStatus: WebsiteDailyUpdateStatus;
}) {
  const lastSuccess = dailyUpdateStatus.lastSuccessfulRun;
  const lastAttempt = dailyUpdateStatus.latestRun;
  const lastSuccessAt = lastSuccess?.completedAt ?? null;
  const now = Date.now();
  const isSuccessStale = !lastSuccessAt || now - lastSuccessAt.getTime() > STALE_AFTER_MS;
  const isAttemptStuck = lastAttempt?.status === 'running'
    && now - lastAttempt.startedAt.getTime() > STALE_AFTER_MS;
  const attemptMessage = lastAttempt?.status === 'failed'
    ? 'The last daily update failed.'
    : lastAttempt?.status === 'running'
      ? isAttemptStuck
        ? 'A daily update has been running for over 36 hours.'
        : 'A daily update is currently running.'
      : lastAttempt
        ? 'The last daily update succeeded.'
        : 'No daily update has been recorded.';
  const attemptIsWarning = lastAttempt?.status === 'failed' || isAttemptStuck || !lastAttempt;
  const lastProcessedMessage = lastProcessedAt
    ? <>Latest processed COTD · <time dateTime={lastProcessedAt.toISOString()}>{utcDateTime.format(lastProcessedAt)} UTC</time></>
    : 'No processed COTD data is available yet.';

  return <section className="data-freshness" aria-label="Data freshness">
    <p>{lastProcessedMessage}</p>
    <p className={attemptIsWarning ? 'data-freshness-warning' : ''} role="status">
      {attemptMessage}
      {lastAttempt && <> · <time dateTime={(lastAttempt.completedAt ?? lastAttempt.startedAt).toISOString()}>
        {utcDateTime.format(lastAttempt.completedAt ?? lastAttempt.startedAt)} UTC
      </time></>}
    </p>
    <p className={!lastSuccessAt || isSuccessStale ? 'data-freshness-warning' : ''}>
      {lastSuccessAt ? <>{isSuccessStale ? 'Last successful update is over 36 hours old · ' : 'Last successful update · '}
        <time dateTime={lastSuccessAt.toISOString()}>
        {utcDateTime.format(lastSuccessAt)} UTC
      </time></> : 'No successful daily update has been recorded.'}
    </p>
  </section>;
}
