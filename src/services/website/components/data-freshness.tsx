const STALE_AFTER_MS = 36 * 60 * 60 * 1_000;

const utcDateTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function DataFreshness({ lastProcessedAt }: { lastProcessedAt: Date | null }) {
  if (!lastProcessedAt) {
    return <p className="data-freshness data-freshness-unavailable" role="status">
      No processed COTD data is available yet.
    </p>;
  }

  const isStale = Date.now() - lastProcessedAt.getTime() > STALE_AFTER_MS;
  return <p className={`data-freshness${isStale ? ' data-freshness-stale' : ''}`} role="status">
    {isStale ? 'Data may be stale · ' : 'Latest processed COTD · '}
    <time dateTime={lastProcessedAt.toISOString()}>{utcDateTime.format(lastProcessedAt)} UTC</time>
  </p>;
}
